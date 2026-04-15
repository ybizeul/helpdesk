package api

import (
	"net/http"
	"time"

	"github.com/helpdesk/backend/internal/models"
	"github.com/helpdesk/backend/internal/store"
	"go.mongodb.org/mongo-driver/v2/bson"
)

func (h *handlers) listUsers(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	cursor, err := h.db.Users().Find(ctx, bson.M{})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "DB_ERROR", err.Error())
		return
	}
	defer cursor.Close(ctx)

	var users []models.User
	if err := cursor.All(ctx, &users); err != nil {
		writeError(w, http.StatusInternalServerError, "DB_ERROR", err.Error())
		return
	}
	if users == nil {
		users = []models.User{}
	}
	writeJSON(w, http.StatusOK, users)
}

func (h *handlers) createUser(w http.ResponseWriter, r *http.Request) {
	if !requireAdmin(r) {
		writeError(w, http.StatusForbidden, "FORBIDDEN", "admin role required")
		return
	}

	ctx := r.Context()

	var body struct {
		Name     string          `json:"name"`
		Email    string          `json:"email"`
		Role     models.UserRole `json:"role"`
		Password string          `json:"password"`
	}
	if err := readJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_JSON", err.Error())
		return
	}
	if body.Email == "" || body.Password == "" {
		writeError(w, http.StatusBadRequest, "MISSING_FIELDS", "email and password are required")
		return
	}

	user := models.User{
		Name:         body.Name,
		Email:        body.Email,
		Role:         body.Role,
		PasswordHash: store.HashPassword(body.Password),
		CreatedAt:    time.Now(),
	}
	result, err := h.db.Users().InsertOne(ctx, user)
	if err != nil {
		writeError(w, http.StatusConflict, "USER_EXISTS", "a user with this email already exists")
		return
	}
	user.ID = result.InsertedID.(bson.ObjectID).Hex()
	writeJSON(w, http.StatusCreated, user)
}

func (h *handlers) getUser(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id := r.PathValue("id")

	oid, err := bson.ObjectIDFromHex(id)
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_ID", "invalid user ID format")
		return
	}

	var u models.User
	err = h.db.Users().FindOne(ctx, bson.M{"_id": oid}).Decode(&u)
	if err != nil {
		writeError(w, http.StatusNotFound, "USER_NOT_FOUND", "user not found")
		return
	}
	writeJSON(w, http.StatusOK, u)
}

func (h *handlers) updateUser(w http.ResponseWriter, r *http.Request) {
	if !requireAdmin(r) {
		writeError(w, http.StatusForbidden, "FORBIDDEN", "admin role required")
		return
	}

	ctx := r.Context()
	id := r.PathValue("id")

	oid, err := bson.ObjectIDFromHex(id)
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_ID", "invalid user ID format")
		return
	}

	var updates map[string]any
	if err := readJSON(r, &updates); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_JSON", err.Error())
		return
	}
	delete(updates, "_id")
	delete(updates, "id")
	delete(updates, "password_hash")

	if pwd, ok := updates["password"].(string); ok && pwd != "" {
		updates["password_hash"] = store.HashPassword(pwd)
		delete(updates, "password")
	}

	result, err := h.db.Users().UpdateByID(ctx, oid, bson.M{"$set": updates})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "DB_ERROR", err.Error())
		return
	}
	if result.MatchedCount == 0 {
		writeError(w, http.StatusNotFound, "USER_NOT_FOUND", "user not found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *handlers) deleteUser(w http.ResponseWriter, r *http.Request) {
	if !requireAdmin(r) {
		writeError(w, http.StatusForbidden, "FORBIDDEN", "admin role required")
		return
	}

	ctx := r.Context()
	id := r.PathValue("id")

	oid, err := bson.ObjectIDFromHex(id)
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_ID", "invalid user ID format")
		return
	}

	// Fetch the user to check their role before deleting.
	var u models.User
	if err := h.db.Users().FindOne(ctx, bson.M{"_id": oid}).Decode(&u); err != nil {
		writeError(w, http.StatusNotFound, "USER_NOT_FOUND", "user not found")
		return
	}

	// Prevent deleting the last admin.
	if u.Role == models.RoleAdmin {
		adminCount, err := h.db.Users().CountDocuments(ctx, bson.M{"role": models.RoleAdmin})
		if err != nil {
			writeError(w, http.StatusInternalServerError, "DB_ERROR", err.Error())
			return
		}
		if adminCount <= 1 {
			writeError(w, http.StatusForbidden, "LAST_ADMIN", "cannot delete the last admin user")
			return
		}
	}

	if _, err := h.db.Users().DeleteOne(ctx, bson.M{"_id": oid}); err != nil {
		writeError(w, http.StatusInternalServerError, "DB_ERROR", err.Error())
		return
	}

	// Nullify owner_id on any tickets owned by this user.
	h.db.Tickets().UpdateMany(ctx, bson.M{"owner_id": id}, bson.M{"$unset": bson.M{"owner_id": ""}})

	w.WriteHeader(http.StatusNoContent)
}
