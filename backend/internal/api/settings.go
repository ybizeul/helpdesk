package api

import (
	"net/http"
	"time"

	"github.com/helpdesk/backend/internal/email"
	"github.com/helpdesk/backend/internal/models"
	"github.com/helpdesk/backend/internal/store"
	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
)

func (h *handlers) getSettings(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	var s models.Settings
	err := h.db.Settings().FindOne(ctx, bson.M{"_id": "global"}).Decode(&s)
	if err != nil {
		writeJSON(w, http.StatusOK, models.Settings{ID: "global"})
		return
	}
	writeJSON(w, http.StatusOK, s)
}

func (h *handlers) updateEmailSettings(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	var email models.EmailSettings
	if err := readJSON(r, &email); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_JSON", err.Error())
		return
	}

	_, err := h.db.Settings().UpdateOne(ctx,
		bson.M{"_id": "global"},
		bson.M{"$set": bson.M{"email": email, "updated_at": time.Now()}},
		options.UpdateOne().SetUpsert(true),
	)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "DB_ERROR", err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *handlers) updateLLMSettings(w http.ResponseWriter, r *http.Request) {
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
	ctx := r.Context()

	var auth models.AuthSettings
	if err := readJSON(r, &auth); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_JSON", err.Error())
		return
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

func (h *handlers) updateSignature(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	var body struct {
		Signature string `json:"signature"`
	}
	if err := readJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_JSON", err.Error())
		return
	}

	_, err := h.db.Settings().UpdateOne(ctx,
		bson.M{"_id": "global"},
		bson.M{"$set": bson.M{"signature": body.Signature, "updated_at": time.Now()}},
		options.UpdateOne().SetUpsert(true),
	)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "DB_ERROR", err.Error())
		return
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

	total, _ := h.db.Tickets().CountDocuments(ctx, bson.M{})
	open, _ := h.db.Tickets().CountDocuments(ctx, bson.M{"status": "open"})
	waiting, _ := h.db.Tickets().CountDocuments(ctx, bson.M{"status": "waiting"})
	closed, _ := h.db.Tickets().CountDocuments(ctx, bson.M{"status": "closed"})

	writeJSON(w, http.StatusOK, map[string]int64{
		"total":   total,
		"open":    open,
		"waiting": waiting,
		"closed":  closed,
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

func (h *handlers) listMailboxes(w http.ResponseWriter, r *http.Request) {
	var cfg models.EmailSettings
	if err := readJSON(r, &cfg); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_JSON", err.Error())
		return
	}

	mailboxes, err := email.ListMailboxes(cfg)
	if err != nil {
		writeError(w, http.StatusBadGateway, "IMAP_ERROR", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, mailboxes)
}

func (h *handlers) fetchNow(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	var s models.Settings
	err := h.db.Settings().FindOne(ctx, bson.M{"_id": "global"}).Decode(&s)
	if err != nil {
		writeError(w, http.StatusBadRequest, "NO_EMAIL_CONFIG", "email settings not configured")
		return
	}

	result, err := email.FetchEmails(ctx, s.Email, h.db)
	if err != nil {
		writeError(w, http.StatusBadGateway, "IMAP_ERROR", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, result)
}
