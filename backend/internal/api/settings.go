package api

import (
	"net/http"
	"os"
	"time"

	"github.com/helpdesk/backend/internal/models"
	"github.com/helpdesk/backend/internal/store"
	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
)

const oidcCallbackAPIEndpoint = "/api/v1/auth/oidc/callback"

func (h *handlers) getSettings(w http.ResponseWriter, r *http.Request) {
	if !requireAdmin(r) {
		writeError(w, http.StatusForbidden, "FORBIDDEN", "admin role required")
		return
	}

	ctx := r.Context()

	var s models.Settings
	err := h.db.Settings().FindOne(ctx, bson.M{"_id": "global"}).Decode(&s)
	if err != nil {
		s = models.Settings{ID: "global"}
	}

	resp := map[string]any{
		"id":                 s.ID,
		"site_name":          s.SiteName,
		"website_url":        s.WebsiteURL,
		"pushover_app_token": s.PushoverAppToken,
		"llm":                s.LLM,
		"auth":               s.Auth,
		"updated_at":         s.UpdatedAt,
		"debug":              os.Getenv("DEBUG") != "",
	}
	writeJSON(w, http.StatusOK, resp)
}

func (h *handlers) updateEmailSettings(w http.ResponseWriter, r *http.Request) {
	// Deprecated: email settings are now per-mailbox. Keep for backward compat.
	writeError(w, http.StatusGone, "MOVED", "email settings are now per-mailbox; use PUT /api/v1/mailboxes/{id}")
}

func (h *handlers) updateLLMSettings(w http.ResponseWriter, r *http.Request) {
	if !requireAdmin(r) {
		writeError(w, http.StatusForbidden, "FORBIDDEN", "admin role required")
		return
	}

	ctx := r.Context()

	var llm models.LLMSettings
	if err := readJSON(r, &llm); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_JSON", err.Error())
		return
	}

	_, err := h.db.Settings().UpdateOne(ctx,
		bson.M{"_id": "global"},
		bson.M{"$set": bson.M{"llm": llm, "updated_at": time.Now()}},
		options.UpdateOne().SetUpsert(true),
	)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "DB_ERROR", err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *handlers) updateAuthSettings(w http.ResponseWriter, r *http.Request) {
	if !requireAdmin(r) {
		writeError(w, http.StatusForbidden, "FORBIDDEN", "admin role required")
		return
	}

	ctx := r.Context()

	var auth models.AuthSettings
	if err := readJSON(r, &auth); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_JSON", err.Error())
		return
	}
	if !auth.OIDCEnabled {
		auth.DisableLocalLogin = false
	}

	_, err := h.db.Settings().UpdateOne(ctx,
		bson.M{"_id": "global"},
		bson.M{"$set": bson.M{"auth": auth, "updated_at": time.Now()}},
		options.UpdateOne().SetUpsert(true),
	)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "DB_ERROR", err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *handlers) getOIDCCallbackInfo(w http.ResponseWriter, r *http.Request) {
	if !requireAdmin(r) {
		writeError(w, http.StatusForbidden, "FORBIDDEN", "admin role required")
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{
		"callback_endpoint": oidcCallbackAPIEndpoint,
	})
}

func (h *handlers) updateSignature(w http.ResponseWriter, r *http.Request) {
	// Deprecated: signature is now per-mailbox. Keep for backward compat.
	writeError(w, http.StatusGone, "MOVED", "signature is now per-mailbox; use PUT /api/v1/mailboxes/{id}")
}

func (h *handlers) getPublicSettings(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	var s models.Settings
	if err := h.db.Settings().FindOne(ctx, bson.M{"_id": "global"}).Decode(&s); err != nil {
		s = models.Settings{}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"site_name": s.SiteName,
	})
}

func (h *handlers) updateGeneralSettings(w http.ResponseWriter, r *http.Request) {
	if !requireAdmin(r) {
		writeError(w, http.StatusForbidden, "FORBIDDEN", "admin role required")
		return
	}

	ctx := r.Context()

	var body struct {
		SiteName   string `json:"site_name"`
		WebsiteURL string `json:"website_url"`
	}
	if err := readJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_JSON", err.Error())
		return
	}

	_, err := h.db.Settings().UpdateOne(ctx,
		bson.M{"_id": "global"},
		bson.M{"$set": bson.M{"site_name": body.SiteName, "website_url": body.WebsiteURL, "updated_at": time.Now()}},
		options.UpdateOne().SetUpsert(true),
	)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "DB_ERROR", err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *handlers) updateNotificationSettings(w http.ResponseWriter, r *http.Request) {
	if !requireAdmin(r) {
		writeError(w, http.StatusForbidden, "FORBIDDEN", "admin role required")
		return
	}

	ctx := r.Context()

	var body struct {
		PushoverAppToken string `json:"pushover_app_token"`
	}
	if err := readJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_JSON", err.Error())
		return
	}

	update := bson.M{"updated_at": time.Now()}
	if body.PushoverAppToken == "" {
		_, err := h.db.Settings().UpdateOne(ctx,
			bson.M{"_id": "global"},
			bson.M{"$set": update, "$unset": bson.M{"pushover_app_token": ""}},
			options.UpdateOne().SetUpsert(true),
		)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "DB_ERROR", err.Error())
			return
		}
	} else {
		update["pushover_app_token"] = body.PushoverAppToken
		_, err := h.db.Settings().UpdateOne(ctx,
			bson.M{"_id": "global"},
			bson.M{"$set": update},
			options.UpdateOne().SetUpsert(true),
		)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "DB_ERROR", err.Error())
			return
		}
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *handlers) emailStatus(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{
		"status": "not_configured",
	})
}

func (h *handlers) getStats(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	// Filter stats by user's accessible mailboxes
	ids, isAdmin := userMailboxIDs(h, r)
	filter := bson.M{}
	if !isAdmin && len(ids) > 0 {
		filter["mailbox_id"] = bson.M{"$in": ids}
	} else if !isAdmin {
		// Agent with no mailboxes sees nothing
		writeJSON(w, http.StatusOK, map[string]int64{
			"total": 0, "unassigned": 0, "active": 0,
			"waiting": 0, "closed": 0, "parked": 0,
		})
		return
	}

	statusFilter := func(status string) bson.M {
		f := bson.M{"status": status}
		for k, v := range filter {
			f[k] = v
		}
		return f
	}

	total, _ := h.db.Tickets().CountDocuments(ctx, filter)
	unassigned, _ := h.db.Tickets().CountDocuments(ctx, statusFilter("unassigned"))
	active, _ := h.db.Tickets().CountDocuments(ctx, statusFilter("active"))
	waiting, _ := h.db.Tickets().CountDocuments(ctx, statusFilter("waiting"))
	closed, _ := h.db.Tickets().CountDocuments(ctx, statusFilter("closed"))
	parked, _ := h.db.Tickets().CountDocuments(ctx, statusFilter("parked"))

	writeJSON(w, http.StatusOK, map[string]int64{
		"total":      total,
		"unassigned": unassigned,
		"active":     active,
		"waiting":    waiting,
		"closed":     closed,
		"parked":     parked,
	})
}

func (h *handlers) login(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	var body struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := readJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_JSON", err.Error())
		return
	}

	var settings models.Settings
	if err := h.db.Settings().FindOne(ctx, bson.M{"_id": "global"}).Decode(&settings); err == nil {
		if settings.Auth.OIDCEnabled && settings.Auth.DisableLocalLogin {
			writeError(w, http.StatusForbidden, "LOCAL_LOGIN_DISABLED", "local login is disabled")
			return
		}
	}

	var user models.User
	err := h.db.Users().FindOne(ctx, bson.M{"email": body.Email}).Decode(&user)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "INVALID_CREDENTIALS", "invalid email or password")
		return
	}

	if !store.VerifyPassword(body.Password, user.PasswordHash) {
		writeError(w, http.StatusUnauthorized, "INVALID_CREDENTIALS", "invalid email or password")
		return
	}

	// Generate JWT token
	token, err := generateToken(user.ID, user.Name, string(user.Role))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "TOKEN_ERROR", "failed to generate token")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"user":  user,
		"token": token,
	})
}
