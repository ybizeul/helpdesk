package api

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"

	coreoidc "github.com/coreos/go-oidc/v3/oidc"
	"github.com/helpdesk/backend/internal/models"
	"github.com/helpdesk/backend/internal/store"
	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"golang.org/x/oauth2"
)

type oidcDiscoveryDocument struct {
	Issuer                string `json:"issuer"`
	AuthorizationEndpoint string `json:"authorization_endpoint"`
	TokenEndpoint         string `json:"token_endpoint"`
	UserInfoEndpoint      string `json:"userinfo_endpoint"`
	JWKSURI               string `json:"jwks_uri"`
}

type oidcUserInfo struct {
	Sub               string   `json:"sub"`
	Email             string   `json:"email"`
	EmailVerified     bool     `json:"email_verified"`
	Name              string   `json:"name"`
	PreferredUsername string   `json:"preferred_username"`
	Groups            []string `json:"groups"`
}

type oidcStateEntry struct {
	RedirectTo string
	ExpiresAt  time.Time
}

var (
	oidcStateStore   = make(map[string]oidcStateEntry)
	oidcStateStoreMu sync.Mutex
)

func oidcBuildBaseURL(r *http.Request) string {
	scheme := "https"
	if proto := r.Header.Get("X-Forwarded-Proto"); proto != "" {
		scheme = proto
	} else if r.TLS == nil {
		scheme = "http"
	}
	return scheme + "://" + r.Host
}

func normalizeOIDCDiscoveryURL(endpoint string) string {
	endpoint = strings.TrimSpace(endpoint)
	if endpoint == "" {
		return ""
	}
	if strings.Contains(endpoint, "/.well-known/openid-configuration") {
		return endpoint
	}
	return strings.TrimRight(endpoint, "/") + "/.well-known/openid-configuration"
}

func randToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

func oidcPutState(redirectTo string) (string, error) {
	state, err := randToken()
	if err != nil {
		return "", err
	}

	oidcStateStoreMu.Lock()
	defer oidcStateStoreMu.Unlock()

	now := time.Now()
	for k, v := range oidcStateStore {
		if now.After(v.ExpiresAt) {
			delete(oidcStateStore, k)
		}
	}
	oidcStateStore[state] = oidcStateEntry{
		RedirectTo: redirectTo,
		ExpiresAt:  now.Add(10 * time.Minute),
	}
	return state, nil
}

func oidcTakeState(state string) (oidcStateEntry, bool) {
	oidcStateStoreMu.Lock()
	defer oidcStateStoreMu.Unlock()

	entry, ok := oidcStateStore[state]
	if !ok || time.Now().After(entry.ExpiresAt) {
		delete(oidcStateStore, state)
		return oidcStateEntry{}, false
	}
	delete(oidcStateStore, state)
	return entry, true
}

func (h *handlers) getOIDCLoginStatus(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	var s models.Settings
	if err := h.db.Settings().FindOne(ctx, bson.M{"_id": "global"}).Decode(&s); err != nil {
		writeJSON(w, http.StatusOK, map[string]bool{"enabled": false})
		return
	}

	enabled := s.Auth.OIDCEnabled && strings.TrimSpace(s.Auth.OIDCIssuer) != "" && strings.TrimSpace(s.Auth.OIDCClientID) != ""
	writeJSON(w, http.StatusOK, map[string]bool{"enabled": enabled})
}

func (h *handlers) oidcStart(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	var s models.Settings
	if err := h.db.Settings().FindOne(ctx, bson.M{"_id": "global"}).Decode(&s); err != nil {
		writeError(w, http.StatusBadRequest, "OIDC_DISABLED", "oidc is not configured")
		return
	}

	if !s.Auth.OIDCEnabled {
		writeError(w, http.StatusBadRequest, "OIDC_DISABLED", "oidc is disabled")
		return
	}

	discoveryURL := normalizeOIDCDiscoveryURL(s.Auth.OIDCIssuer)
	if discoveryURL == "" || s.Auth.OIDCClientID == "" {
		writeError(w, http.StatusBadRequest, "OIDC_NOT_CONFIGURED", "oidc endpoint and client id are required")
		return
	}

	doc, err := fetchOIDCDiscovery(ctx, discoveryURL)
	if err != nil {
		writeError(w, http.StatusBadGateway, "OIDC_DISCOVERY_FAILED", err.Error())
		return
	}

	redirectTo := "/"
	if v := r.URL.Query().Get("redirect"); strings.HasPrefix(v, "/") {
		redirectTo = v
	}

	state, err := oidcPutState(redirectTo)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "OIDC_STATE_ERROR", err.Error())
		return
	}

	baseURL := oidcBuildBaseURL(r)
	redirectURI := baseURL + oidcCallbackAPIEndpoint

	oauthCfg := oauth2.Config{
		ClientID:     s.Auth.OIDCClientID,
		ClientSecret: s.Auth.OIDCClientSecret,
		Endpoint: oauth2.Endpoint{
			AuthURL:  doc.AuthorizationEndpoint,
			TokenURL: doc.TokenEndpoint,
		},
		RedirectURL: redirectURI,
		Scopes:      []string{coreoidc.ScopeOpenID, "profile", "email", "groups"},
	}

	http.Redirect(w, r, oauthCfg.AuthCodeURL(state), http.StatusFound)
}

func (h *handlers) oidcCallback(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	state := r.URL.Query().Get("state")
	code := r.URL.Query().Get("code")
	if state == "" || code == "" {
		writeError(w, http.StatusBadRequest, "OIDC_CALLBACK_INVALID", "missing state or code")
		return
	}

	stateEntry, ok := oidcTakeState(state)
	if !ok {
		writeError(w, http.StatusBadRequest, "OIDC_STATE_INVALID", "invalid or expired oidc state")
		return
	}

	var s models.Settings
	if err := h.db.Settings().FindOne(ctx, bson.M{"_id": "global"}).Decode(&s); err != nil {
		writeError(w, http.StatusBadRequest, "OIDC_DISABLED", "oidc is not configured")
		return
	}

	discoveryURL := normalizeOIDCDiscoveryURL(s.Auth.OIDCIssuer)
	doc, err := fetchOIDCDiscovery(ctx, discoveryURL)
	if err != nil {
		writeError(w, http.StatusBadGateway, "OIDC_DISCOVERY_FAILED", err.Error())
		return
	}

	baseURL := oidcBuildBaseURL(r)
	redirectURI := baseURL + oidcCallbackAPIEndpoint

	oauthCfg := oauth2.Config{
		ClientID:     s.Auth.OIDCClientID,
		ClientSecret: s.Auth.OIDCClientSecret,
		Endpoint: oauth2.Endpoint{
			AuthURL:  doc.AuthorizationEndpoint,
			TokenURL: doc.TokenEndpoint,
		},
		RedirectURL: redirectURI,
	}

	token, err := oauthCfg.Exchange(ctx, code)
	if err != nil {
		writeError(w, http.StatusBadGateway, "OIDC_TOKEN_EXCHANGE_FAILED", err.Error())
		return
	}

	rawIDToken, _ := token.Extra("id_token").(string)
	if rawIDToken == "" {
		writeError(w, http.StatusBadGateway, "OIDC_ID_TOKEN_MISSING", "provider did not return id_token")
		return
	}

	verifier := coreoidc.NewVerifier(doc.Issuer, coreoidc.NewRemoteKeySet(ctx, doc.JWKSURI), &coreoidc.Config{ClientID: s.Auth.OIDCClientID})
	idToken, err := verifier.Verify(ctx, rawIDToken)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "OIDC_ID_TOKEN_INVALID", err.Error())
		return
	}

	claims := make(map[string]any)
	if err := idToken.Claims(&claims); err != nil {
		writeError(w, http.StatusBadGateway, "OIDC_CLAIMS_ERROR", err.Error())
		return
	}

	info := oidcUserInfo{}
	if err := mapClaimsToOIDCUserInfo(claims, &info); err != nil {
		writeError(w, http.StatusBadGateway, "OIDC_CLAIMS_ERROR", err.Error())
		return
	}

	if os.Getenv("DEBUG") != "" {
		slog.Info("oidc claims",
			"groups", info.Groups,
			"token_scope", token.Extra("scope"),
			"claim_scope", claims["scope"],
			"claim_scp", claims["scp"],
		)
	}

	if info.Email == "" {
		writeError(w, http.StatusBadRequest, "OIDC_EMAIL_REQUIRED", "oidc account does not provide an email claim")
		return
	}

	user, err := h.findOrCreateOIDCUser(ctx, info, s.Auth.OIDCAdminGroup)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "OIDC_USER_ERROR", err.Error())
		return
	}

	appToken, err := generateToken(user.ID, user.Name, string(user.Role))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "TOKEN_ERROR", "failed to generate token")
		return
	}

	redirectURL := stateEntry.RedirectTo
	if redirectURL == "" {
		redirectURL = "/"
	}
	q := url.Values{}
	q.Set("token", appToken)
	target := redirectURL
	if strings.Contains(target, "?") {
		target += "&" + q.Encode()
	} else {
		target += "?" + q.Encode()
	}
	http.Redirect(w, r, target, http.StatusFound)
}

func mapClaimsToOIDCUserInfo(claims map[string]any, out *oidcUserInfo) error {
	b, err := json.Marshal(claims)
	if err != nil {
		return err
	}
	if err := json.Unmarshal(b, out); err != nil {
		return err
	}
	if out.Name == "" {
		out.Name = out.PreferredUsername
	}
	if out.Name == "" {
		out.Name = out.Email
	}
	return nil
}

func mapOIDCGroupsToRole(groups []string, adminGroup string) models.UserRole {
	adminGroup = strings.ToLower(strings.TrimSpace(adminGroup))
	if adminGroup == "" {
		return models.RoleAgent
	}

	for _, g := range groups {
		if strings.ToLower(strings.TrimSpace(g)) == adminGroup {
			return models.RoleAdmin
		}
	}

	return models.RoleAgent
}

func (h *handlers) findOrCreateOIDCUser(ctx context.Context, info oidcUserInfo, adminGroup string) (models.User, error) {
	var user models.User
	err := h.db.Users().FindOne(ctx, bson.M{"email": info.Email}).Decode(&user)
	if err == nil {
		return user, nil
	}
	if !errors.Is(err, mongo.ErrNoDocuments) {
		return models.User{}, err
	}

	role := mapOIDCGroupsToRole(info.Groups, adminGroup)
	if role == "" {
		role = models.RoleAgent
	}

	generatedPwd := "oidc-" + time.Now().UTC().Format("20060102150405")
	newUser := models.User{
		Name:         info.Name,
		Email:        info.Email,
		Role:         role,
		PasswordHash: store.HashPassword(generatedPwd),
		CreatedAt:    time.Now(),
	}
	result, err := h.db.Users().InsertOne(ctx, newUser)
	if err != nil {
		return models.User{}, err
	}

	newUser.ID = result.InsertedID.(bson.ObjectID).Hex()
	return newUser, nil
}

func fetchOIDCDiscovery(ctx context.Context, endpoint string) (*oidcDiscoveryDocument, error) {
	if strings.TrimSpace(endpoint) == "" {
		return nil, fmt.Errorf("oidc endpoint is empty")
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
		return nil, fmt.Errorf("oidc discovery returned %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}

	var doc oidcDiscoveryDocument
	if err := json.NewDecoder(resp.Body).Decode(&doc); err != nil {
		return nil, err
	}

	if doc.Issuer == "" || doc.AuthorizationEndpoint == "" || doc.TokenEndpoint == "" || doc.JWKSURI == "" {
		return nil, fmt.Errorf("oidc discovery response missing required endpoints")
	}

	return &doc, nil
}
