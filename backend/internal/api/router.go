package api

import (
	"encoding/json"
	"net/http"

	"github.com/helpdesk/backend/internal/store"
)

func NewRouter(db *store.DB) http.Handler {
	mux := http.NewServeMux()

	h := &handlers{db: db}

	// Tickets
	mux.HandleFunc("GET /api/v1/tickets", h.listTickets)
	mux.HandleFunc("POST /api/v1/tickets", h.createTicket)
	mux.HandleFunc("GET /api/v1/tickets/{id}", h.getTicket)
	mux.HandleFunc("PUT /api/v1/tickets/{id}", h.updateTicket)
	mux.HandleFunc("DELETE /api/v1/tickets/{id}", h.deleteTicket)
	mux.HandleFunc("POST /api/v1/tickets/{id}/reply", h.replyTicket)
	mux.HandleFunc("POST /api/v1/tickets/{id}/retry-send", h.retrySend)
	mux.HandleFunc("PUT /api/v1/tickets/{id}/assign", h.assignTicket)
	mux.HandleFunc("PUT /api/v1/tickets/{id}/claim", h.claimTicket)
	mux.HandleFunc("PUT /api/v1/tickets/{id}/status", h.changeTicketStatus)
	mux.HandleFunc("GET /api/v1/tickets/{id}/messages/{msgIdx}/attachments/{attIdx}", h.downloadAttachment)
	mux.HandleFunc("POST /api/v1/tickets/bulk", h.bulkTicketAction)
	mux.HandleFunc("POST /api/v1/tickets/merge", h.mergeTickets)

	// Users
	mux.HandleFunc("GET /api/v1/users", h.listUsers)
	mux.HandleFunc("POST /api/v1/users", h.createUser)
	mux.HandleFunc("GET /api/v1/users/{id}", h.getUser)
	mux.HandleFunc("PUT /api/v1/users/{id}", h.updateUser)
	mux.HandleFunc("DELETE /api/v1/users/{id}", h.deleteUser)

	// Email
	mux.HandleFunc("GET /api/v1/email/status", h.emailStatus)
	mux.HandleFunc("POST /api/v1/email/mailboxes", h.listMailboxes)
	mux.HandleFunc("POST /api/v1/email/fetch", h.fetchNow)
	mux.HandleFunc("POST /api/v1/email/reparse", h.reparseEmails)

	// Settings
	mux.HandleFunc("GET /api/v1/settings", h.getSettings)
	mux.HandleFunc("PUT /api/v1/settings/email", h.updateEmailSettings)
	mux.HandleFunc("PUT /api/v1/settings/llm", h.updateLLMSettings)
	mux.HandleFunc("PUT /api/v1/settings/auth", h.updateAuthSettings)
	mux.HandleFunc("PUT /api/v1/settings/signature", h.updateSignature)

	// Dashboard
	mux.HandleFunc("GET /api/v1/stats", h.getStats)

	// Auth
	mux.HandleFunc("POST /api/v1/auth/login", h.login)
	mux.HandleFunc("PUT /api/v1/auth/password", h.changePassword)

	return authMiddleware(mux)
}

type handlers struct {
	db *store.DB
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, map[string]any{
		"error": map[string]string{
			"code":    code,
			"message": message,
		},
	})
}

func readJSON(r *http.Request, v any) error {
	defer r.Body.Close()
	return json.NewDecoder(r.Body).Decode(v)
}
