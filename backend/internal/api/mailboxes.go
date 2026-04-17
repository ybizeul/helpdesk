package api

import (
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/helpdesk/backend/internal/email"
	"github.com/helpdesk/backend/internal/models"
	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
)

var slugRe = regexp.MustCompile(`[^a-z0-9]+`)

func toSlug(name string) string {
	s := strings.ToLower(strings.TrimSpace(name))
	s = slugRe.ReplaceAllString(s, "-")
	s = strings.Trim(s, "-")
	if s == "" {
		s = "mailbox"
	}
	return s
}

// userMailboxIDs returns the list of mailbox IDs the user can access.
// Admins get nil (meaning all), agents get their assigned list.
func userMailboxIDs(h *handlers, r *http.Request) ([]string, bool) {
	claims := r.Context().Value(claimsKey).(*jwtClaims)
	if claims.Role == string(models.RoleAdmin) {
		return nil, true // nil = all
	}
	ctx := r.Context()
	var user models.User
	oid, _ := bson.ObjectIDFromHex(claims.Sub)
	if err := h.db.Users().FindOne(ctx, bson.M{"_id": oid}).Decode(&user); err != nil {
		return []string{}, false
	}
	if len(user.Mailboxes) == 0 {
		return []string{}, false
	}
	return user.Mailboxes, false
}

func userCanAccessMailbox(h *handlers, r *http.Request, mailboxID string) bool {
	ids, isAdmin := userMailboxIDs(h, r)
	if isAdmin {
		return true
	}
	for _, id := range ids {
		if id == mailboxID {
			return true
		}
	}
	return false
}

func (h *handlers) listMailboxesAPI(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	ids, isAdmin := userMailboxIDs(h, r)

	filter := bson.M{}
	if !isAdmin {
		filter["_id"] = bson.M{"$in": toBsonObjectIDs(ids)}
	}

	cur, err := h.db.Mailboxes().Find(ctx, filter)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "DB_ERROR", err.Error())
		return
	}
	defer cur.Close(ctx)

	var mailboxes []models.Mailbox
	if err := cur.All(ctx, &mailboxes); err != nil {
		writeError(w, http.StatusInternalServerError, "DB_ERROR", err.Error())
		return
	}
	if mailboxes == nil {
		mailboxes = []models.Mailbox{}
	}

	// Compute unread counts per mailbox
	unreadFilter := bson.M{"unread": true, "status": bson.M{"$nin": bson.A{"closed", "parked"}}}
	if !isAdmin {
		unreadFilter["mailbox_id"] = bson.M{"$in": ids}
	}
	pipeline := mongo.Pipeline{
		{{Key: "$match", Value: unreadFilter}},
		{{Key: "$group", Value: bson.M{"_id": "$mailbox_id", "count": bson.M{"$sum": 1}}}},
	}
	cursor, err := h.db.Tickets().Aggregate(ctx, pipeline)
	unreadMap := map[string]int64{}
	if err == nil {
		var results []struct {
			ID    string `bson:"_id"`
			Count int64  `bson:"count"`
		}
		if cursor.All(ctx, &results) == nil {
			for _, r := range results {
				unreadMap[r.ID] = r.Count
			}
		}
	}

	type mailboxWithCount struct {
		models.Mailbox `bson:",inline"`
		UnreadCount    int64 `json:"unread_count"`
	}
	resp := make([]mailboxWithCount, len(mailboxes))
	for i, mb := range mailboxes {
		resp[i] = mailboxWithCount{Mailbox: mb, UnreadCount: unreadMap[mb.ID]}
	}
	writeJSON(w, http.StatusOK, resp)
}

func (h *handlers) getMailboxAPI(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id := r.PathValue("id")

	if !userCanAccessMailbox(h, r, id) {
		writeError(w, http.StatusForbidden, "FORBIDDEN", "no access to this mailbox")
		return
	}

	oid, err := bson.ObjectIDFromHex(id)
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_ID", "invalid mailbox ID")
		return
	}

	var mb models.Mailbox
	if err := h.db.Mailboxes().FindOne(ctx, bson.M{"_id": oid}).Decode(&mb); err != nil {
		writeError(w, http.StatusNotFound, "MAILBOX_NOT_FOUND", "mailbox not found")
		return
	}
	writeJSON(w, http.StatusOK, mb)
}

func (h *handlers) getMailboxBySlug(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	slug := r.PathValue("slug")

	var mb models.Mailbox
	if err := h.db.Mailboxes().FindOne(ctx, bson.M{"slug": slug}).Decode(&mb); err != nil {
		writeError(w, http.StatusNotFound, "MAILBOX_NOT_FOUND", "mailbox not found")
		return
	}

	if !userCanAccessMailbox(h, r, mb.ID) {
		writeError(w, http.StatusForbidden, "FORBIDDEN", "no access to this mailbox")
		return
	}

	writeJSON(w, http.StatusOK, mb)
}

func (h *handlers) createMailbox(w http.ResponseWriter, r *http.Request) {
	if !requireAdmin(r) {
		writeError(w, http.StatusForbidden, "FORBIDDEN", "admin role required")
		return
	}

	ctx := r.Context()

	var body struct {
		Name string `json:"name"`
	}
	if err := readJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_JSON", err.Error())
		return
	}
	if strings.TrimSpace(body.Name) == "" {
		writeError(w, http.StatusBadRequest, "NAME_REQUIRED", "mailbox name is required")
		return
	}

	slug := toSlug(body.Name)
	// Ensure unique slug by appending a suffix if needed
	baseSlug := slug
	for i := 2; ; i++ {
		count, _ := h.db.Mailboxes().CountDocuments(ctx, bson.M{"slug": slug})
		if count == 0 {
			break
		}
		slug = baseSlug + "-" + strings.Repeat("", 0) + string(rune('0'+i))
		if i > 9 {
			slug = baseSlug + "-" + time.Now().Format("20060102150405")
			break
		}
	}

	now := time.Now()
	mb := models.Mailbox{
		Name:      strings.TrimSpace(body.Name),
		Slug:      slug,
		Enabled:   true,
		CreatedAt: now,
		UpdatedAt: now,
	}

	res, err := h.db.Mailboxes().InsertOne(ctx, mb)
	if err != nil {
		if strings.Contains(err.Error(), "duplicate key") {
			writeError(w, http.StatusConflict, "SLUG_TAKEN", "a mailbox with this slug already exists")
			return
		}
		writeError(w, http.StatusInternalServerError, "DB_ERROR", err.Error())
		return
	}
	mb.ID = res.InsertedID.(bson.ObjectID).Hex()
	writeJSON(w, http.StatusCreated, mb)
}

func (h *handlers) updateMailbox(w http.ResponseWriter, r *http.Request) {
	if !requireAdmin(r) {
		writeError(w, http.StatusForbidden, "FORBIDDEN", "admin role required")
		return
	}

	ctx := r.Context()
	id := r.PathValue("id")

	oid, err := bson.ObjectIDFromHex(id)
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_ID", "invalid mailbox ID")
		return
	}

	var body map[string]any
	if err := readJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_JSON", err.Error())
		return
	}

	// Only allow updating specific fields
	set := bson.M{"updated_at": time.Now()}
	if v, ok := body["name"]; ok {
		set["name"] = v
	}
	if v, ok := body["email"]; ok {
		set["email"] = v
	}
	if v, ok := body["signature"]; ok {
		set["signature"] = v
	}
	if v, ok := body["oidc_group"]; ok {
		set["oidc_group"] = v
	}
	if v, ok := body["enabled"]; ok {
		set["enabled"] = v
	}
	if v, ok := body["slug"]; ok {
		s, _ := v.(string)
		s = toSlug(s)
		if s == "" {
			writeError(w, http.StatusBadRequest, "INVALID_SLUG", "slug must contain at least one alphanumeric character")
			return
		}
		set["slug"] = s
	}

	result, err := h.db.Mailboxes().UpdateByID(ctx, oid, bson.M{"$set": set})
	if err != nil {
		if strings.Contains(err.Error(), "duplicate key") {
			writeError(w, http.StatusConflict, "SLUG_TAKEN", "a mailbox with this slug already exists")
			return
		}
		writeError(w, http.StatusInternalServerError, "DB_ERROR", err.Error())
		return
	}
	if result.MatchedCount == 0 {
		writeError(w, http.StatusNotFound, "MAILBOX_NOT_FOUND", "mailbox not found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *handlers) deleteMailbox(w http.ResponseWriter, r *http.Request) {
	if !requireAdmin(r) {
		writeError(w, http.StatusForbidden, "FORBIDDEN", "admin role required")
		return
	}

	ctx := r.Context()
	id := r.PathValue("id")

	oid, err := bson.ObjectIDFromHex(id)
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_ID", "invalid mailbox ID")
		return
	}

	// Check that no tickets belong to this mailbox
	count, _ := h.db.Tickets().CountDocuments(ctx, bson.M{"mailbox_id": id})
	if count > 0 {
		writeError(w, http.StatusConflict, "MAILBOX_HAS_TICKETS", "cannot delete a mailbox that has tickets")
		return
	}

	result, err := h.db.Mailboxes().DeleteOne(ctx, bson.M{"_id": oid})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "DB_ERROR", err.Error())
		return
	}
	if result.DeletedCount == 0 {
		writeError(w, http.StatusNotFound, "MAILBOX_NOT_FOUND", "mailbox not found")
		return
	}

	// Remove this mailbox from all users' mailboxes arrays
	h.db.Users().UpdateMany(ctx, bson.M{}, bson.M{
		"$pull": bson.M{"mailboxes": id},
	})

	w.WriteHeader(http.StatusNoContent)
}

func (h *handlers) fetchMailboxNow(w http.ResponseWriter, r *http.Request) {
	if !requireAdmin(r) {
		writeError(w, http.StatusForbidden, "FORBIDDEN", "admin role required")
		return
	}

	ctx := r.Context()
	id := r.PathValue("id")

	oid, err := bson.ObjectIDFromHex(id)
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_ID", "invalid mailbox ID")
		return
	}

	var mb models.Mailbox
	if err := h.db.Mailboxes().FindOne(ctx, bson.M{"_id": oid}).Decode(&mb); err != nil {
		writeError(w, http.StatusNotFound, "MAILBOX_NOT_FOUND", "mailbox not found")
		return
	}

	if mb.Email.IMAPHost == "" {
		writeError(w, http.StatusBadRequest, "NO_EMAIL_CONFIG", "email settings not configured for this mailbox")
		return
	}

	result, fetchErr := email.FetchEmails(ctx, mb.Email, h.db, mb.ID, mb.LastFetchedAt)
	if fetchErr != nil {
		writeError(w, http.StatusBadGateway, "IMAP_ERROR", fetchErr.Error())
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (h *handlers) listMailboxIMAPFolders(w http.ResponseWriter, r *http.Request) {
	if !requireAdmin(r) {
		writeError(w, http.StatusForbidden, "FORBIDDEN", "admin role required")
		return
	}

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

func toBsonObjectIDs(ids []string) []bson.ObjectID {
	result := make([]bson.ObjectID, 0, len(ids))
	for _, id := range ids {
		if oid, err := bson.ObjectIDFromHex(id); err == nil {
			result = append(result, oid)
		}
	}
	return result
}
