package api

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/go-webauthn/webauthn/protocol"
	"github.com/go-webauthn/webauthn/webauthn"
	"github.com/helpdesk/backend/internal/models"
	"go.mongodb.org/mongo-driver/v2/bson"
)

// webauthnForRequest builds a *webauthn.WebAuthn whose RP ID and origin
// are derived from the incoming request so it works on any domain.
func webauthnForRequest(r *http.Request) (*webauthn.WebAuthn, error) {
	host := r.Host
	// Strip port to get the RP ID (bare hostname).
	rpID := host
	if i := strings.LastIndex(rpID, ":"); i != -1 {
		rpID = rpID[:i]
	}
	// Determine scheme.
	scheme := "https"
	if proto := r.Header.Get("X-Forwarded-Proto"); proto != "" {
		scheme = proto
	} else if r.TLS == nil {
		scheme = "http"
	}
	origin := scheme + "://" + host

	return webauthn.New(&webauthn.Config{
		RPDisplayName: "Helpdesk",
		RPID:          rpID,
		RPOrigins:     []string{origin},
	})
}

// In-memory challenge session store with TTL.
var (
	challengeStore   = make(map[string]challengeEntry)
	challengeStoreMu sync.Mutex
)

type challengeEntry struct {
	sessionData webauthn.SessionData
	expiresAt   time.Time
}

func storeSession(session *webauthn.SessionData) string {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	id := base64.RawURLEncoding.EncodeToString(b)

	challengeStoreMu.Lock()
	defer challengeStoreMu.Unlock()

	now := time.Now()
	for k, v := range challengeStore {
		if now.After(v.expiresAt) {
			delete(challengeStore, k)
		}
	}
	challengeStore[id] = challengeEntry{
		sessionData: *session,
		expiresAt:   now.Add(5 * time.Minute),
	}
	return id
}

func getSession(id string) (*webauthn.SessionData, bool) {
	challengeStoreMu.Lock()
	defer challengeStoreMu.Unlock()

	entry, ok := challengeStore[id]
	if !ok || time.Now().After(entry.expiresAt) {
		delete(challengeStore, id)
		return nil, false
	}
	delete(challengeStore, id)
	return &entry.sessionData, true
}

// webAuthnUser wraps a models.User to implement the webauthn.User interface.
type webAuthnUser struct {
	user        models.User
	credentials []webauthn.Credential
}

func (u *webAuthnUser) WebAuthnID() []byte                         { return []byte(u.user.ID) }
func (u *webAuthnUser) WebAuthnName() string                       { return u.user.Email }
func (u *webAuthnUser) WebAuthnDisplayName() string                { return u.user.Name }
func (u *webAuthnUser) WebAuthnCredentials() []webauthn.Credential { return u.credentials }

func (h *handlers) loadWebAuthnUser(ctx context.Context, user models.User) (*webAuthnUser, error) {
	var creds []models.PasskeyCredential
	cur, err := h.db.Passkeys().Find(ctx, bson.M{"user_id": user.ID})
	if err != nil {
		return nil, err
	}
	defer cur.Close(ctx)
	if err := cur.All(ctx, &creds); err != nil {
		return nil, err
	}

	wanCreds := make([]webauthn.Credential, len(creds))
	for i, c := range creds {
		transports := make([]protocol.AuthenticatorTransport, len(c.Transports))
		for j, t := range c.Transports {
			transports[j] = protocol.AuthenticatorTransport(t)
		}
		wanCreds[i] = webauthn.Credential{
			ID:              c.CredentialID,
			PublicKey:       c.PublicKey,
			AttestationType: c.AttestationType,
			Transport:       transports,
			Flags: webauthn.CredentialFlags{
				BackupEligible: c.BackupEligible,
				BackupState:    c.BackupState,
			},
			Authenticator: webauthn.Authenticator{
				AAGUID:       c.AAGUID,
				SignCount:    c.SignCount,
				CloneWarning: c.CloneWarning,
			},
		}
	}
	return &webAuthnUser{user: user, credentials: wanCreds}, nil
}

// POST /api/v1/auth/passkeys/register/begin
func (h *handlers) beginPasskeyRegistration(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	claims := ctx.Value(claimsKey).(*jwtClaims)

	oid, err := bson.ObjectIDFromHex(claims.Sub)
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_ID", "invalid user ID")
		return
	}
	var user models.User
	if err := h.db.Users().FindOne(ctx, bson.M{"_id": oid}).Decode(&user); err != nil {
		writeError(w, http.StatusNotFound, "USER_NOT_FOUND", "user not found")
		return
	}

	wanUser, err := h.loadWebAuthnUser(ctx, user)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "DB_ERROR", err.Error())
		return
	}

	wan, err := webauthnForRequest(r)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "WEBAUTHN_ERROR", err.Error())
		return
	}

	options, session, err := wan.BeginRegistration(wanUser,
		webauthn.WithResidentKeyRequirement(protocol.ResidentKeyRequirementRequired),
	)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "WEBAUTHN_ERROR", err.Error())
		return
	}

	sessionID := storeSession(session)
	writeJSON(w, http.StatusOK, map[string]any{
		"session_id": sessionID,
		"options":    options,
	})
}

// POST /api/v1/auth/passkeys/register/finish
func (h *handlers) finishPasskeyRegistration(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	claims := ctx.Value(claimsKey).(*jwtClaims)

	var body struct {
		SessionID string          `json:"session_id"`
		Name      string          `json:"name"`
		Response  json.RawMessage `json:"response"`
	}
	if err := readJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_JSON", err.Error())
		return
	}

	session, ok := getSession(body.SessionID)
	if !ok {
		writeError(w, http.StatusBadRequest, "SESSION_EXPIRED", "registration session expired")
		return
	}

	oid, err := bson.ObjectIDFromHex(claims.Sub)
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_ID", "invalid user ID")
		return
	}
	var user models.User
	if err := h.db.Users().FindOne(ctx, bson.M{"_id": oid}).Decode(&user); err != nil {
		writeError(w, http.StatusNotFound, "USER_NOT_FOUND", "user not found")
		return
	}

	wanUser, err := h.loadWebAuthnUser(ctx, user)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "DB_ERROR", err.Error())
		return
	}

	parsedResponse, err := protocol.ParseCredentialCreationResponseBody(bytes.NewReader(body.Response))
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_RESPONSE", err.Error())
		return
	}

	wan, err := webauthnForRequest(r)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "WEBAUTHN_ERROR", err.Error())
		return
	}

	credential, err := wan.CreateCredential(wanUser, *session, parsedResponse)
	if err != nil {
		writeError(w, http.StatusBadRequest, "WEBAUTHN_ERROR", err.Error())
		return
	}

	name := body.Name
	if name == "" {
		name = "Passkey"
	}

	transports := make([]string, len(credential.Transport))
	for i, t := range credential.Transport {
		transports[i] = string(t)
	}

	pk := models.PasskeyCredential{
		UserID:          user.ID,
		Name:            name,
		CredentialID:    credential.ID,
		PublicKey:       credential.PublicKey,
		AttestationType: credential.AttestationType,
		Transports:      transports,
		BackupEligible:  credential.Flags.BackupEligible,
		BackupState:     credential.Flags.BackupState,
		AAGUID:          credential.Authenticator.AAGUID,
		SignCount:       credential.Authenticator.SignCount,
		CloneWarning:    credential.Authenticator.CloneWarning,
		CreatedAt:       time.Now(),
	}

	result, err := h.db.Passkeys().InsertOne(ctx, pk)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "DB_ERROR", err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"id":         result.InsertedID,
		"name":       name,
		"created_at": pk.CreatedAt,
	})
}

// POST /api/v1/auth/passkeys/login/begin (no auth required)
func (h *handlers) beginPasskeyLogin(w http.ResponseWriter, r *http.Request) {
	wan, err := webauthnForRequest(r)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "WEBAUTHN_ERROR", err.Error())
		return
	}

	options, session, err := wan.BeginDiscoverableLogin()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "WEBAUTHN_ERROR", err.Error())
		return
	}

	sessionID := storeSession(session)
	writeJSON(w, http.StatusOK, map[string]any{
		"session_id": sessionID,
		"options":    options,
	})
}

// POST /api/v1/auth/passkeys/login/finish (no auth required)
func (h *handlers) finishPasskeyLogin(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	var body struct {
		SessionID string          `json:"session_id"`
		Response  json.RawMessage `json:"response"`
	}
	if err := readJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_JSON", err.Error())
		return
	}

	session, ok := getSession(body.SessionID)
	if !ok {
		writeError(w, http.StatusBadRequest, "SESSION_EXPIRED", "login session expired")
		return
	}

	parsedResponse, err := protocol.ParseCredentialRequestResponseBody(bytes.NewReader(body.Response))
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_RESPONSE", err.Error())
		return
	}

	wan, err := webauthnForRequest(r)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "WEBAUTHN_ERROR", err.Error())
		return
	}

	var authenticatedUser models.User
	credential, err := wan.ValidateDiscoverableLogin(
		func(rawID, userHandle []byte) (webauthn.User, error) {
			userID := string(userHandle)
			oid, err := bson.ObjectIDFromHex(userID)
			if err != nil {
				return nil, err
			}
			var user models.User
			if err := h.db.Users().FindOne(ctx, bson.M{"_id": oid}).Decode(&user); err != nil {
				return nil, err
			}
			authenticatedUser = user
			wanUser, err := h.loadWebAuthnUser(ctx, user)
			if err != nil {
				return nil, err
			}
			return wanUser, nil
		},
		*session,
		parsedResponse,
	)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "WEBAUTHN_ERROR", "passkey authentication failed")
		return
	}

	// Update sign count
	_, _ = h.db.Passkeys().UpdateOne(ctx,
		bson.M{"credential_id": credential.ID},
		bson.M{"$set": bson.M{"sign_count": credential.Authenticator.SignCount}},
	)

	token, err := generateToken(authenticatedUser.ID, authenticatedUser.Name, string(authenticatedUser.Role))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "TOKEN_ERROR", "failed to generate token")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"user":  authenticatedUser,
		"token": token,
	})
}

// GET /api/v1/auth/passkeys
func (h *handlers) listPasskeys(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	claims := ctx.Value(claimsKey).(*jwtClaims)

	var passkeys []models.PasskeyCredential
	cur, err := h.db.Passkeys().Find(ctx, bson.M{"user_id": claims.Sub})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "DB_ERROR", err.Error())
		return
	}
	defer cur.Close(ctx)
	if err := cur.All(ctx, &passkeys); err != nil {
		writeError(w, http.StatusInternalServerError, "DB_ERROR", err.Error())
		return
	}
	if passkeys == nil {
		passkeys = []models.PasskeyCredential{}
	}
	writeJSON(w, http.StatusOK, passkeys)
}

// DELETE /api/v1/auth/passkeys/{id}
func (h *handlers) deletePasskey(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	claims := ctx.Value(claimsKey).(*jwtClaims)
	id := r.PathValue("id")

	oid, err := bson.ObjectIDFromHex(id)
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_ID", "invalid passkey ID")
		return
	}

	result, err := h.db.Passkeys().DeleteOne(ctx, bson.M{"_id": oid, "user_id": claims.Sub})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "DB_ERROR", err.Error())
		return
	}
	if result.DeletedCount == 0 {
		writeError(w, http.StatusNotFound, "NOT_FOUND", "passkey not found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
