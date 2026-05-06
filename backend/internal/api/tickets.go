package api

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	netmail "net/mail"
	"strconv"
	"strings"
	"time"

	"github.com/helpdesk/backend/internal/email"
	"github.com/helpdesk/backend/internal/models"
	"github.com/helpdesk/backend/internal/store"
	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
)

// loadTicketMailbox loads the mailbox associated with a ticket.
func (h *handlers) loadTicketMailbox(ctx context.Context, ticket models.Ticket) (models.Mailbox, error) {
	var mb models.Mailbox
	if ticket.MailboxID == "" {
		return mb, fmt.Errorf("ticket has no mailbox_id")
	}
	oid, err := bson.ObjectIDFromHex(ticket.MailboxID)
	if err != nil {
		return mb, err
	}
	err = h.db.Mailboxes().FindOne(ctx, bson.M{"_id": oid}).Decode(&mb)
	return mb, err
}

// requireTicketAccess loads a ticket by OID and verifies the requesting user
// has access to its mailbox. Writes an HTTP error when access is denied.
func (h *handlers) requireTicketAccess(w http.ResponseWriter, r *http.Request, oid bson.ObjectID) (models.Ticket, bool) {
	var t models.Ticket
	if err := h.db.Tickets().FindOne(r.Context(), bson.M{"_id": oid}).Decode(&t); err != nil {
		writeError(w, http.StatusNotFound, "TICKET_NOT_FOUND", "ticket not found")
		return t, false
	}
	if t.MailboxID != "" && !userCanAccessMailbox(h, r, t.MailboxID) {
		writeError(w, http.StatusForbidden, "FORBIDDEN", "no access to this ticket's mailbox")
		return t, false
	}
	return t, true
}

// replyPrefixes lists multilingual reply/forward prefixes to strip when normalising subjects.
var replyPrefixes = []string{
	"Re: ", "RE: ", "re: ",
	"AW: ", "Aw: ", "aw: ", // German Antwort
	"Fwd: ", "FWD: ", "fwd: ",
	"WG: ", "Wg: ", // German Weitergeleitet (forward)
	"SV: ", "Sv: ", // Scandinavian reply
	"VS: ", "Vs: ", // Scandinavian forward
	"TR: ", "Tr: ", // French Transmission (forward)
}

// stripReplyPrefixes removes all leading reply/forward prefixes from subject.
func stripReplyPrefixes(subject string) string {
	for {
		stripped := false
		for _, p := range replyPrefixes {
			if strings.HasPrefix(subject, p) {
				subject = subject[len(p):]
				stripped = true
			}
		}
		if !stripped {
			break
		}
	}
	return subject
}

// buildReplySubject constructs the reply subject, avoiding double [#N] tags
// and normalising multilingual reply prefixes (AW:, SV:, etc.) to "Re:".
func buildReplySubject(number int, subject string) string {
	tag := fmt.Sprintf("[#%d]", number)
	if strings.Contains(subject, tag) {
		// Strip all reply prefixes then re-add a single canonical "Re: "
		bare := stripReplyPrefixes(subject)
		return "Re: " + bare
	}
	bare := stripReplyPrefixes(subject)
	return fmt.Sprintf("Re: %s %s", tag, bare)
}

// buildReplyHeaders collects threading headers from a ticket for outgoing replies.
func buildReplyHeaders(ticket models.Ticket) email.ReplyHeaders {
	h := email.ReplyHeaders{
		ThreadTopic: ticket.ThreadTopic,
		ThreadIndex: ticket.ThreadIndex,
	}
	// Collect all Message-IDs for the References chain
	for _, m := range ticket.Messages {
		if m.MessageID != "" {
			h.References = append(h.References, m.MessageID)
		}
	}
	// In-Reply-To is the last known Message-ID in the thread
	if len(h.References) > 0 {
		h.InReplyTo = h.References[len(h.References)-1]
	} else if ticket.EmailThreadID != "" {
		h.InReplyTo = ticket.EmailThreadID
		h.References = []string{ticket.EmailThreadID}
	}
	// If ThreadTopic is empty, use the ticket subject
	if h.ThreadTopic == "" {
		h.ThreadTopic = ticket.Subject
	}
	return h
}

// collectCc gathers Cc addresses from the last inbound message on the ticket,
// excluding the helpdesk's own address and the requester (already in To).
func collectCc(ticket models.Ticket, emailCfg models.EmailSettings) []string {
	ownAddr := emailCfg.SMTPFrom
	if ownAddr == "" {
		ownAddr = emailCfg.SMTPUser
	}
	if ownAddr == "" {
		ownAddr = emailCfg.IMAPUser
	}
	// Extract bare email so "Name" <addr> format matches stripped Cc addresses.
	if parsed, err := netmail.ParseAddress(ownAddr); err == nil {
		ownAddr = parsed.Address
	}
	ownAddr = strings.ToLower(ownAddr)
	requester := strings.ToLower(ticket.Requester.Email)

	// Walk messages in reverse to find the last inbound message with Cc
	for i := len(ticket.Messages) - 1; i >= 0; i-- {
		msg := ticket.Messages[i]
		if msg.From == "agent" || len(msg.Cc) == 0 {
			continue
		}
		var cc []string
		for _, addr := range msg.Cc {
			// Strip display name if present: "Name <email>" -> "email"
			clean := addr
			if idx := strings.Index(addr, "<"); idx >= 0 {
				clean = strings.TrimRight(addr[idx+1:], "> ")
			}
			clean = strings.TrimSpace(clean)
			lower := strings.ToLower(clean)
			if lower == ownAddr || lower == requester || clean == "" {
				continue
			}
			cc = append(cc, clean)
		}
		return cc
	}
	return nil
}

func (h *handlers) listTickets(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	filter := bson.M{}

	// Mailbox filtering — if mailbox_id is specified, filter by it; otherwise filter by user's accessible mailboxes
	if mbID := r.URL.Query().Get("mailbox_id"); mbID != "" {
		if !userCanAccessMailbox(h, r, mbID) {
			writeError(w, http.StatusForbidden, "FORBIDDEN", "no access to this mailbox")
			return
		}
		filter["mailbox_id"] = mbID
	} else {
		ids, isAdmin := userMailboxIDs(h, r)
		if !isAdmin {
			filter["mailbox_id"] = bson.M{"$in": ids}
		}
	}

	if s := r.URL.Query().Get("status"); s != "" {
		filter["status"] = s
	} else if r.URL.Query().Get("include_closed") == "" {
		filter["status"] = bson.M{"$nin": bson.A{"closed", "parked"}}
	}
	if a := r.URL.Query().Get("assignee_id"); a != "" {
		filter["assignee_id"] = a
	}

	// Use aggregation to sort: unread first, then active before waiting, then by date
	pipeline := mongo.Pipeline{
		{{Key: "$match", Value: filter}},
		{{Key: "$addFields", Value: bson.M{
			"_status_order": bson.M{"$switch": bson.M{
				"branches": bson.A{
					bson.M{"case": bson.M{"$eq": bson.A{"$status", "unassigned"}}, "then": 0},
					bson.M{"case": bson.M{"$eq": bson.A{"$status", "active"}}, "then": 1},
					bson.M{"case": bson.M{"$eq": bson.A{"$status", "waiting"}}, "then": 2},
					bson.M{"case": bson.M{"$eq": bson.A{"$status", "closed"}}, "then": 3},
					bson.M{"case": bson.M{"$eq": bson.A{"$status", "parked"}}, "then": 4},
				},
				"default": 4,
			}},
		}}},
		{{Key: "$sort", Value: bson.D{
			{Key: "_status_order", Value: 1},
			{Key: "unread", Value: -1},
			{Key: "updated_at", Value: -1},
		}}},
		{{Key: "$addFields", Value: bson.M{
			"message_count": bson.M{"$size": bson.M{"$ifNull": bson.A{"$messages", bson.A{}}}},
			"id":            "$_id",
		}}},
		{{Key: "$unset", Value: bson.A{"_status_order", "messages", "_id"}}},
	}

	cursor, err := h.db.Tickets().Aggregate(ctx, pipeline)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "DB_ERROR", err.Error())
		return
	}
	defer cursor.Close(ctx)

	var results []bson.M
	if err := cursor.All(ctx, &results); err != nil {
		writeError(w, http.StatusInternalServerError, "DB_ERROR", err.Error())
		return
	}
	if results == nil {
		results = []bson.M{}
	}
	writeJSON(w, http.StatusOK, results)
}

func (h *handlers) createTicket(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	var t models.Ticket
	if err := readJSON(r, &t); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_JSON", err.Error())
		return
	}

	if t.MailboxID != "" && !userCanAccessMailbox(h, r, t.MailboxID) {
		writeError(w, http.StatusForbidden, "FORBIDDEN", "no access to this mailbox")
		return
	}

	if strings.TrimSpace(t.Subject) == "" {
		writeError(w, http.StatusBadRequest, "SUBJECT_REQUIRED", "subject must not be empty")
		return
	}

	now := time.Now()
	t.ID = ""
	t.Status = models.TicketStatusUnassigned
	t.CreatedAt = now
	t.UpdatedAt = now
	if t.Messages == nil {
		t.Messages = []models.Message{}
	}

	num, err := h.db.NextTicketNumber(ctx)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "DB_ERROR", err.Error())
		return
	}
	t.Number = num

	result, err := h.db.Tickets().InsertOne(ctx, t)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "DB_ERROR", err.Error())
		return
	}
	t.ID = result.InsertedID.(bson.ObjectID).Hex()
	writeJSON(w, http.StatusCreated, t)
}

func (h *handlers) getTicket(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id := r.PathValue("id")

	var t models.Ticket
	var ok bool

	oid, err := bson.ObjectIDFromHex(id)
	if err == nil {
		t, ok = h.requireTicketAccess(w, r, oid)
		if !ok {
			return
		}
	} else if num, numErr := strconv.Atoi(id); numErr == nil && num > 0 {
		if findErr := h.db.Tickets().FindOne(ctx, bson.M{"number": num}).Decode(&t); findErr != nil {
			writeError(w, http.StatusNotFound, "TICKET_NOT_FOUND", "ticket not found")
			return
		}
		if t.MailboxID != "" && !userCanAccessMailbox(h, r, t.MailboxID) {
			writeError(w, http.StatusForbidden, "FORBIDDEN", "no access to this ticket's mailbox")
			return
		}
	} else {
		writeError(w, http.StatusBadRequest, "INVALID_ID", "invalid ticket ID format")
		return
	}

	// Mark as read when viewed
	if t.Unread {
		toid, _ := bson.ObjectIDFromHex(t.ID)
		h.db.Tickets().UpdateByID(ctx, toid, bson.M{"$set": bson.M{"unread": false}})
		t.Unread = false
	}

	writeJSON(w, http.StatusOK, t)
}

func (h *handlers) updateTicket(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id := r.PathValue("id")

	oid, err := bson.ObjectIDFromHex(id)
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_ID", "invalid ticket ID format")
		return
	}

	if _, ok := h.requireTicketAccess(w, r, oid); !ok {
		return
	}

	var updates map[string]any
	if err := readJSON(r, &updates); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_JSON", err.Error())
		return
	}
	updates["updated_at"] = time.Now()
	delete(updates, "_id")
	delete(updates, "id")
	delete(updates, "mailbox_id")
	delete(updates, "messages")
	delete(updates, "number")
	delete(updates, "created_at")
	delete(updates, "email_thread_id")
	delete(updates, "thread_topic")
	delete(updates, "thread_index")

	result, err := h.db.Tickets().UpdateByID(ctx, oid, bson.M{"$set": updates})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "DB_ERROR", err.Error())
		return
	}
	if result.MatchedCount == 0 {
		writeError(w, http.StatusNotFound, "TICKET_NOT_FOUND", "ticket not found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *handlers) renameTicket(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id := r.PathValue("id")

	oid, err := bson.ObjectIDFromHex(id)
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_ID", "invalid ticket ID format")
		return
	}

	if _, ok := h.requireTicketAccess(w, r, oid); !ok {
		return
	}

	var body struct {
		Subject string `json:"subject"`
	}
	if err := readJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_JSON", err.Error())
		return
	}
	body.Subject = strings.TrimSpace(body.Subject)
	if body.Subject == "" {
		writeError(w, http.StatusBadRequest, "SUBJECT_REQUIRED", "subject must not be empty")
		return
	}

	result, err := h.db.Tickets().UpdateByID(ctx, oid, bson.M{"$set": bson.M{
		"subject": body.Subject,
	}})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "DB_ERROR", err.Error())
		return
	}
	if result.MatchedCount == 0 {
		writeError(w, http.StatusNotFound, "TICKET_NOT_FOUND", "ticket not found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *handlers) deleteTicket(w http.ResponseWriter, r *http.Request) {
	if !requireAdmin(r) {
		writeError(w, http.StatusForbidden, "FORBIDDEN", "admin role required")
		return
	}

	ctx := r.Context()
	id := r.PathValue("id")

	oid, err := bson.ObjectIDFromHex(id)
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_ID", "invalid ticket ID format")
		return
	}

	// Load ticket to get message IDs before deleting
	var ticket models.Ticket
	if err := h.db.Tickets().FindOne(ctx, bson.M{"_id": oid}).Decode(&ticket); err != nil {
		writeError(w, http.StatusNotFound, "TICKET_NOT_FOUND", "ticket not found")
		return
	}

	result, err := h.db.Tickets().DeleteOne(ctx, bson.M{"_id": oid})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "DB_ERROR", err.Error())
		return
	}
	if result.DeletedCount == 0 {
		writeError(w, http.StatusNotFound, "TICKET_NOT_FOUND", "ticket not found")
		return
	}

	// Move emails to deleted mailbox in background
	go moveTicketEmails(h.db, []models.Ticket{ticket})

	w.WriteHeader(http.StatusNoContent)
}

func (h *handlers) replyTicket(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id := r.PathValue("id")

	oid, err := bson.ObjectIDFromHex(id)
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_ID", "invalid ticket ID format")
		return
	}

	// Load the ticket to get requester email and thread ID
	ticket, ok := h.requireTicketAccess(w, r, oid)
	if !ok {
		return
	}

	var msg models.Message
	if err := readJSON(r, &msg); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_JSON", err.Error())
		return
	}
	msg.CreatedAt = time.Now()
	msg.To = []string{ticket.Requester.Email}
	msg.Subject = buildReplySubject(ticket.Number, ticket.Subject)

	// Load mailbox to get email config
	mb, _ := h.loadTicketMailbox(ctx, ticket)
	if mb.Email.SMTPFrom != "" {
		msg.From = mb.Email.SMTPFrom
	} else {
		msg.From = "agent"
	}

	// Set owner to the replying user if not already set
	claims := ctx.Value(claimsKey).(*jwtClaims)
	setFields := bson.M{"updated_at": time.Now(), "status": models.TicketStatusWaiting}
	if ticket.OwnerID == "" {
		setFields["owner_id"] = claims.Sub
	}

	_, err = h.db.Tickets().UpdateByID(ctx, oid, bson.M{
		"$push": bson.M{"messages": msg},
		"$set":  setFields,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "DB_ERROR", err.Error())
		return
	}

	// Send email via SMTP
	if mb.Email.SMTPHost != "" {
		subject := buildReplySubject(ticket.Number, ticket.Subject)
		replyHeaders := buildReplyHeaders(ticket)
		cc := collectCc(ticket, mb.Email)
		generatedID, rawMsg, sendErr := email.SendReply(mb.Email, ticket.Requester.Email, cc, subject, msg.Body, msg.HTML, replyHeaders)
		if sendErr != nil {
			slog.Error("failed to send reply email", "ticket", ticket.Number, "to", ticket.Requester.Email, "error", sendErr)
			msg.SendError = sendErr.Error()
			// Update the last message with the error
			h.db.Tickets().UpdateOne(ctx,
				bson.M{"_id": oid, "messages.created_at": msg.CreatedAt},
				bson.M{"$set": bson.M{"messages.$.send_error": msg.SendError}},
			)
		} else {
			// Store generated Message-ID on the sent message
			h.db.Tickets().UpdateOne(ctx,
				bson.M{"_id": oid, "messages.created_at": msg.CreatedAt},
				bson.M{"$set": bson.M{"messages.$.message_id": generatedID}},
			)
			if err := email.StoreSentEmail(mb.Email, rawMsg); err != nil {
				slog.Error("failed to store sent email", "ticket", ticket.Number, "error", err)
			}
		}
	}

	writeJSON(w, http.StatusCreated, msg)
}

func (h *handlers) retrySend(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id := r.PathValue("id")

	oid, err := bson.ObjectIDFromHex(id)
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_ID", "invalid ticket ID format")
		return
	}

	var body struct {
		MessageIndex int `json:"message_index"`
	}
	if err := readJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_JSON", err.Error())
		return
	}

	ticket, ok := h.requireTicketAccess(w, r, oid)
	if !ok {
		return
	}

	if body.MessageIndex < 0 || body.MessageIndex >= len(ticket.Messages) {
		writeError(w, http.StatusBadRequest, "INVALID_INDEX", "message index out of range")
		return
	}

	msg := ticket.Messages[body.MessageIndex]

	mb, err := h.loadTicketMailbox(ctx, ticket)
	if err != nil || mb.Email.SMTPHost == "" {
		writeError(w, http.StatusBadRequest, "SMTP_NOT_CONFIGURED", "SMTP is not configured")
		return
	}

	subject := buildReplySubject(ticket.Number, ticket.Subject)
	replyHeaders := buildReplyHeaders(ticket)
	cc := collectCc(ticket, mb.Email)
	generatedID, rawMsg, sendErr := email.SendReply(mb.Email, ticket.Requester.Email, cc, subject, msg.Body, msg.HTML, replyHeaders)

	arrayFilter := fmt.Sprintf("messages.%d.send_error", body.MessageIndex)
	if sendErr != nil {
		slog.Error("retry send failed", "ticket", ticket.Number, "error", sendErr)
		h.db.Tickets().UpdateByID(ctx, oid, bson.M{"$set": bson.M{arrayFilter: sendErr.Error()}})
		writeError(w, http.StatusBadGateway, "SEND_FAILED", sendErr.Error())
		return
	}

	if err := email.StoreSentEmail(mb.Email, rawMsg); err != nil {
		slog.Error("failed to store sent email", "ticket", ticket.Number, "error", err)
	}

	// Store generated Message-ID and clear send_error on success
	msgIDFilter := fmt.Sprintf("messages.%d.message_id", body.MessageIndex)
	h.db.Tickets().UpdateByID(ctx, oid, bson.M{
		"$set":   bson.M{msgIDFilter: generatedID},
		"$unset": bson.M{arrayFilter: ""},
	})
	writeJSON(w, http.StatusOK, map[string]string{"status": "sent"})
}

func (h *handlers) assignTicket(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id := r.PathValue("id")

	oid, err := bson.ObjectIDFromHex(id)
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_ID", "invalid ticket ID format")
		return
	}

	if _, ok := h.requireTicketAccess(w, r, oid); !ok {
		return
	}

	var body struct {
		AssigneeID string `json:"assignee_id"`
	}
	if err := readJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_JSON", err.Error())
		return
	}

	result, err := h.db.Tickets().UpdateByID(ctx, oid, bson.M{
		"$set": bson.M{"assignee_id": body.AssigneeID, "updated_at": time.Now()},
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "DB_ERROR", err.Error())
		return
	}
	if result.MatchedCount == 0 {
		writeError(w, http.StatusNotFound, "TICKET_NOT_FOUND", "ticket not found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *handlers) claimTicket(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id := r.PathValue("id")

	oid, err := bson.ObjectIDFromHex(id)
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_ID", "invalid ticket ID format")
		return
	}

	ticket, ok := h.requireTicketAccess(w, r, oid)
	if !ok {
		return
	}

	claims := ctx.Value(claimsKey).(*jwtClaims)

	updateFields := bson.M{"owner_id": claims.Sub, "updated_at": time.Now()}
	// If unassigned, transition to active
	if ticket.Status == models.TicketStatusUnassigned {
		updateFields["status"] = models.TicketStatusActive
	}
	result, err := h.db.Tickets().UpdateByID(ctx, oid, bson.M{
		"$set": updateFields,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "DB_ERROR", err.Error())
		return
	}
	if result.MatchedCount == 0 {
		writeError(w, http.StatusNotFound, "TICKET_NOT_FOUND", "ticket not found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *handlers) changeTicketStatus(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id := r.PathValue("id")

	oid, err := bson.ObjectIDFromHex(id)
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_ID", "invalid ticket ID format")
		return
	}

	if _, ok := h.requireTicketAccess(w, r, oid); !ok {
		return
	}

	var body struct {
		Status models.TicketStatus `json:"status"`
	}
	if err := readJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_JSON", err.Error())
		return
	}

	result, err := h.db.Tickets().UpdateByID(ctx, oid, bson.M{
		"$set": bson.M{"status": body.Status, "updated_at": time.Now()},
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "DB_ERROR", err.Error())
		return
	}
	if result.MatchedCount == 0 {
		writeError(w, http.StatusNotFound, "TICKET_NOT_FOUND", "ticket not found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *handlers) addNote(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id := r.PathValue("id")

	oid, err := bson.ObjectIDFromHex(id)
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_ID", "invalid ticket ID format")
		return
	}

	if _, ok := h.requireTicketAccess(w, r, oid); !ok {
		return
	}

	var body struct {
		Body string `json:"body"`
		HTML string `json:"html"`
	}
	if err := readJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_JSON", err.Error())
		return
	}

	claims := ctx.Value(claimsKey).(*jwtClaims)
	msg := models.Message{
		From:      claims.Sub,
		Body:      body.Body,
		HTML:      body.HTML,
		Private:   true,
		CreatedAt: time.Now(),
	}

	result, err := h.db.Tickets().UpdateByID(ctx, oid, bson.M{
		"$push": bson.M{"messages": msg},
		"$set":  bson.M{"updated_at": time.Now()},
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "DB_ERROR", err.Error())
		return
	}
	if result.MatchedCount == 0 {
		writeError(w, http.StatusNotFound, "TICKET_NOT_FOUND", "ticket not found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *handlers) downloadAttachment(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")

	oid, err := bson.ObjectIDFromHex(id)
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_ID", "invalid ticket ID format")
		return
	}

	msgIdx, err := strconv.Atoi(r.PathValue("msgIdx"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_INDEX", "invalid message index")
		return
	}
	attIdx, err := strconv.Atoi(r.PathValue("attIdx"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_INDEX", "invalid attachment index")
		return
	}

	ticket, ok := h.requireTicketAccess(w, r, oid)
	if !ok {
		return
	}

	if msgIdx < 0 || msgIdx >= len(ticket.Messages) {
		writeError(w, http.StatusBadRequest, "INVALID_INDEX", "message index out of range")
		return
	}
	msg := ticket.Messages[msgIdx]
	if attIdx < 0 || attIdx >= len(msg.Attachments) {
		writeError(w, http.StatusBadRequest, "INVALID_INDEX", "attachment index out of range")
		return
	}
	att := msg.Attachments[attIdx]

	w.Header().Set("Content-Type", att.ContentType)
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", att.Filename))
	w.Header().Set("Content-Length", strconv.Itoa(len(att.Data)))
	w.Write(att.Data)
}

func (h *handlers) reparseEmails(w http.ResponseWriter, r *http.Request) {
	if !requireAdmin(r) {
		writeError(w, http.StatusForbidden, "FORBIDDEN", "admin role required")
		return
	}

	ctx := r.Context()

	cursor, err := h.db.Tickets().Find(ctx, bson.M{
		"messages.raw_email": bson.M{"$exists": true},
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "DB_ERROR", err.Error())
		return
	}
	defer cursor.Close(ctx)

	var updated int
	for cursor.Next(ctx) {
		var ticket models.Ticket
		if err := cursor.Decode(&ticket); err != nil {
			continue
		}
		changed := false
		for i, msg := range ticket.Messages {
			if len(msg.RawEmail) == 0 {
				continue
			}
			parsed := email.ParseMIMEBody(msg.RawEmail)
			if parsed.Text != msg.Body || parsed.HTML != msg.HTML {
				ticket.Messages[i].Body = parsed.Text
				ticket.Messages[i].HTML = parsed.HTML
				changed = true
			}
			if parsed.Subject != "" && msg.Subject == "" {
				ticket.Messages[i].Subject = parsed.Subject
				changed = true
			}
			if len(parsed.To) > 0 && len(msg.To) == 0 {
				ticket.Messages[i].To = parsed.To
				changed = true
			}
			if len(parsed.Cc) > 0 && len(msg.Cc) == 0 {
				ticket.Messages[i].Cc = parsed.Cc
				changed = true
			}
			if len(parsed.Attachments) > 0 && len(msg.Attachments) == 0 {
				var atts []models.MessageAttachment
				for _, a := range parsed.Attachments {
					atts = append(atts, models.MessageAttachment{
						Filename:    a.Filename,
						ContentType: a.ContentType,
						Size:        a.Size,
						Data:        a.Data,
					})
				}
				ticket.Messages[i].Attachments = atts
				changed = true
			}
		}
		if !changed {
			continue
		}

		// Also reparse Thread-Topic from the first message
		if ticket.ThreadTopic == "" && len(ticket.Messages) > 0 && len(ticket.Messages[0].RawEmail) > 0 {
			parsed := email.ParseMIMEBody(ticket.Messages[0].RawEmail)
			if parsed.ThreadTopic != "" {
				ticket.ThreadTopic = parsed.ThreadTopic
			}
		}

		oid, err := bson.ObjectIDFromHex(ticket.ID)
		if err != nil {
			slog.Error("reparse: invalid ticket ID", "id", ticket.ID, "error", err)
			continue
		}
		_, err = h.db.Tickets().UpdateByID(ctx, oid, bson.M{
			"$set": bson.M{
				"messages":     ticket.Messages,
				"thread_topic": ticket.ThreadTopic,
			},
		})
		if err != nil {
			slog.Error("reparse: failed to update ticket", "id", ticket.ID, "error", err)
			continue
		}
		updated++
	}

	writeJSON(w, http.StatusOK, map[string]int{"updated": updated})
}

func (h *handlers) mergeTickets(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	var req struct {
		IDs []string `json:"ids"`
	}
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_JSON", err.Error())
		return
	}
	if len(req.IDs) < 2 {
		writeError(w, http.StatusBadRequest, "TOO_FEW", "at least 2 tickets required to merge")
		return
	}

	oids := make([]bson.ObjectID, 0, len(req.IDs))
	for _, id := range req.IDs {
		oid, err := bson.ObjectIDFromHex(id)
		if err != nil {
			continue
		}
		oids = append(oids, oid)
	}

	// Load all tickets
	cursor, err := h.db.Tickets().Find(ctx, bson.M{"_id": bson.M{"$in": oids}})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "DB_ERROR", err.Error())
		return
	}
	var tickets []models.Ticket
	if err := cursor.All(ctx, &tickets); err != nil {
		writeError(w, http.StatusInternalServerError, "DB_ERROR", err.Error())
		return
	}
	if len(tickets) < 2 {
		writeError(w, http.StatusBadRequest, "NOT_FOUND", "could not find enough tickets to merge")
		return
	}

	// Verify access to all tickets' mailboxes
	for _, t := range tickets {
		if t.MailboxID != "" && !userCanAccessMailbox(h, r, t.MailboxID) {
			writeError(w, http.StatusForbidden, "FORBIDDEN", "no access to one or more tickets' mailboxes")
			return
		}
	}

	// Collect all messages and find the latest one to determine subject
	var allMessages []models.Message
	var latestMsg models.Message
	for _, t := range tickets {
		allMessages = append(allMessages, t.Messages...)
		for _, m := range t.Messages {
			if m.CreatedAt.After(latestMsg.CreatedAt) {
				latestMsg = m
			}
		}
	}

	// Sort messages by date
	for i := 1; i < len(allMessages); i++ {
		for j := i; j > 0 && allMessages[j].CreatedAt.Before(allMessages[j-1].CreatedAt); j-- {
			allMessages[j], allMessages[j-1] = allMessages[j-1], allMessages[j]
		}
	}

	// Find the ticket that contains the latest message — use its subject
	var targetTicket models.Ticket
	for _, t := range tickets {
		for _, m := range t.Messages {
			if m.CreatedAt.Equal(latestMsg.CreatedAt) && m.MessageID == latestMsg.MessageID {
				targetTicket = t
				break
			}
		}
	}
	if targetTicket.ID == "" {
		targetTicket = tickets[0]
	}

	// Use the lowest ticket number as the surviving ticket
	survivingTicket := tickets[0]
	for _, t := range tickets[1:] {
		if t.Number < survivingTicket.Number {
			survivingTicket = t
		}
	}

	// Update surviving ticket
	survivingOID, _ := bson.ObjectIDFromHex(survivingTicket.ID)
	_, err = h.db.Tickets().UpdateByID(ctx, survivingOID, bson.M{
		"$set": bson.M{
			"subject":    targetTicket.Subject,
			"messages":   allMessages,
			"updated_at": latestMsg.CreatedAt,
			"unread":     true,
		},
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "DB_ERROR", err.Error())
		return
	}

	// Delete the other tickets
	deleteOIDs := make([]bson.ObjectID, 0, len(oids)-1)
	for _, oid := range oids {
		if oid != survivingOID {
			deleteOIDs = append(deleteOIDs, oid)
		}
	}
	h.db.Tickets().DeleteMany(ctx, bson.M{"_id": bson.M{"$in": deleteOIDs}})

	writeJSON(w, http.StatusOK, map[string]any{"merged_into": survivingTicket.ID, "ticket_number": survivingTicket.Number})
}

func (h *handlers) bulkTicketAction(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	var req struct {
		IDs    []string `json:"ids"`
		Action string   `json:"action"`
		Status string   `json:"status,omitempty"`
	}
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_JSON", err.Error())
		return
	}

	if len(req.IDs) == 0 {
		writeError(w, http.StatusBadRequest, "NO_IDS", "no ticket IDs provided")
		return
	}

	oids := make([]bson.ObjectID, 0, len(req.IDs))
	for _, id := range req.IDs {
		oid, err := bson.ObjectIDFromHex(id)
		if err != nil {
			continue
		}
		oids = append(oids, oid)
	}

	filter := bson.M{"_id": bson.M{"$in": oids}}

	// Restrict to tickets in user's accessible mailboxes
	mbIDs, isAdmin := userMailboxIDs(h, r)
	if !isAdmin {
		filter["mailbox_id"] = bson.M{"$in": mbIDs}
	}

	switch req.Action {
	case "delete":
		if !requireAdmin(r) {
			writeError(w, http.StatusForbidden, "FORBIDDEN", "admin role required")
			return
		}

		// Load tickets to get message IDs before deleting
		cursor, findErr := h.db.Tickets().Find(ctx, filter)
		var ticketsToDelete []models.Ticket
		if findErr == nil {
			cursor.All(ctx, &ticketsToDelete)
			cursor.Close(ctx)
		}

		result, err := h.db.Tickets().DeleteMany(ctx, filter)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "DB_ERROR", err.Error())
			return
		}

		// Move emails to deleted mailbox in background
		if len(ticketsToDelete) > 0 {
			go moveTicketEmails(h.db, ticketsToDelete)
		}

		writeJSON(w, http.StatusOK, map[string]int64{"deleted": result.DeletedCount})
	case "mark_read":
		result, err := h.db.Tickets().UpdateMany(ctx, filter, bson.M{"$set": bson.M{"unread": false}})
		if err != nil {
			writeError(w, http.StatusInternalServerError, "DB_ERROR", err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]int64{"updated": result.ModifiedCount})
	case "mark_unread":
		result, err := h.db.Tickets().UpdateMany(ctx, filter, bson.M{"$set": bson.M{"unread": true}})
		if err != nil {
			writeError(w, http.StatusInternalServerError, "DB_ERROR", err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]int64{"updated": result.ModifiedCount})
	case "set_status":
		if req.Status == "" {
			writeError(w, http.StatusBadRequest, "MISSING_STATUS", "status is required for set_status action")
			return
		}
		result, err := h.db.Tickets().UpdateMany(ctx, filter, bson.M{"$set": bson.M{"status": req.Status, "updated_at": time.Now()}})
		if err != nil {
			writeError(w, http.StatusInternalServerError, "DB_ERROR", err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]int64{"updated": result.ModifiedCount})
	default:
		writeError(w, http.StatusBadRequest, "INVALID_ACTION", "invalid action")
	}
}

// moveTicketEmails collects Message-IDs from the given tickets and moves the
// corresponding emails to the configured deleted IMAP mailbox.
func moveTicketEmails(db *store.DB, tickets []models.Ticket) {
	ctx := context.Background()

	// Group tickets by mailbox_id
	byMailbox := map[string][]models.Ticket{}
	for _, t := range tickets {
		byMailbox[t.MailboxID] = append(byMailbox[t.MailboxID], t)
	}

	for mailboxID, mbTickets := range byMailbox {
		if mailboxID == "" {
			continue
		}
		oid, err := bson.ObjectIDFromHex(mailboxID)
		if err != nil {
			continue
		}
		var mb models.Mailbox
		if err := db.Mailboxes().FindOne(ctx, bson.M{"_id": oid}).Decode(&mb); err != nil {
			continue
		}
		if mb.Email.DeletedMailbox == "" {
			continue
		}

		var messageIDs []string
		for _, t := range mbTickets {
			for _, m := range t.Messages {
				if m.MessageID != "" {
					messageIDs = append(messageIDs, m.MessageID)
				}
			}
		}
		if len(messageIDs) == 0 {
			continue
		}

		if err := email.MoveToDeletedMailbox(mb.Email, messageIDs); err != nil {
			slog.Error("failed to move emails to deleted mailbox", "mailbox", mailboxID, "error", err)
		}
	}
}
