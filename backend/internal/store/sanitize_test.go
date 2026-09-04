package store

import (
	"testing"
	"unicode/utf8"

	"github.com/helpdesk/backend/internal/models"
)

func TestSanitizeTicketFieldsCleanTicket(t *testing.T) {
	ticket := models.Ticket{
		Subject:   "Café order",
		Requester: models.Requester{Name: "Ada", Email: "ada@example.com"},
		Tags:      []string{"billing"},
		Messages:  []models.Message{{From: "ada@example.com", Body: "héllo"}},
	}
	if set := sanitizeTicketFields(ticket); len(set) != 0 {
		t.Fatalf("clean ticket should need no update, got %#v", set)
	}
}

func TestSanitizeTicketFieldsRepairsInvalidUTF8(t *testing.T) {
	ticket := models.Ticket{
		Subject:     "caf\xe9",
		ThreadTopic: "caf\xe9",
		Requester:   models.Requester{Name: "Ren\xe9", Email: "rene@example.com"},
		Tags:        []string{"urgent", "priorit\xe9"},
		Messages: []models.Message{
			{From: "rene@example.com", Body: "bonjour \xe9", HTML: "<p>\xe9</p>", Subject: "caf\xe9"},
			{From: "agent", Body: "clean reply"},
		},
	}

	set := sanitizeTicketFields(ticket)

	want := map[string]string{
		"subject":            "café",
		"thread_topic":       "café",
		"requester.name":     "René",
		"messages.0.body":    "bonjour é",
		"messages.0.html":    "<p>é</p>",
		"messages.0.subject": "café",
	}
	for field, expected := range want {
		got, ok := set[field]
		if !ok {
			t.Fatalf("missing %s in %#v", field, set)
		}
		if got != expected {
			t.Fatalf("%s = %q, want %q", field, got, expected)
		}
	}

	tags, ok := set["tags"].([]string)
	if !ok {
		t.Fatalf("tags = %#v", set["tags"])
	}
	if tags[1] != "priorité" {
		t.Fatalf("tags[1] = %q", tags[1])
	}

	for _, field := range []string{"requester.email", "messages.0.from", "messages.1.body"} {
		if _, ok := set[field]; ok {
			t.Fatalf("%s was already valid and must not be rewritten", field)
		}
	}

	for field, value := range set {
		if s, ok := value.(string); ok && !utf8.ValidString(s) {
			t.Fatalf("%s is still invalid UTF-8", field)
		}
	}
}
