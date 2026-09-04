package api

import (
	"strings"
	"testing"

	"go.mongodb.org/mongo-driver/v2/bson"
)

func TestEscapeTextSearch(t *testing.T) {
	got := escapeTextSearch(`foo "bar" \baz`)
	want := `"foo \"bar\" \\baz"`
	if got != want {
		t.Fatalf("escapeTextSearch = %q, want %q", got, want)
	}
}

func TestTicketListExcludesClosed(t *testing.T) {
	cases := []struct {
		status, include, q string
		want               bool
	}{
		{"", "", "", true},
		{"", "", "   ", true},
		{"", "", "invoice", false},
		{"unassigned", "", "invoice", false},
		{"", "1", "", false},
	}
	for _, c := range cases {
		got := ticketListExcludesClosed(c.status, c.include, c.q)
		if got != c.want {
			t.Fatalf("excludesClosed(%q,%q,%q)=%v want %v", c.status, c.include, c.q, got, c.want)
		}
	}
}

func TestApplyTicketSearchEmpty(t *testing.T) {
	filter := bson.M{"mailbox_id": "abc"}
	searching, useScore := applyTicketSearch(filter, "  ")
	if searching || useScore {
		t.Fatalf("empty q should not search, got searching=%v score=%v", searching, useScore)
	}
	if _, ok := filter["$text"]; ok {
		t.Fatal("empty q should not add $text")
	}
	if filter["mailbox_id"] != "abc" {
		t.Fatal("mailbox filter must be preserved")
	}
}

func TestApplyTicketSearchTextOnly(t *testing.T) {
	filter := bson.M{"mailbox_id": "abc"}
	searching, useScore := applyTicketSearch(filter, "invoice")
	if !searching || !useScore {
		t.Fatalf("text search should use textScore, got searching=%v score=%v", searching, useScore)
	}
	text, ok := filter["$text"].(bson.M)
	if !ok {
		t.Fatalf("$text missing: %#v", filter)
	}
	if text["$search"] != `"invoice"` || text["$language"] != "none" {
		t.Fatalf("unexpected $text: %#v", text)
	}
	if filter["mailbox_id"] != "abc" {
		t.Fatal("mailbox filter must be preserved")
	}
	if _, ok := filter["$or"]; ok {
		t.Fatal("text search must not use $or")
	}
}

func TestApplyTicketSearchNumber(t *testing.T) {
	for _, q := range []string{"#1234", "1234"} {
		filter := bson.M{"mailbox_id": "abc"}
		searching, useScore := applyTicketSearch(filter, q)
		if !searching {
			t.Fatalf("%q: expected searching", q)
		}
		if useScore {
			t.Fatalf("%q: number lookup should not use textScore", q)
		}
		if filter["number"] != 1234 {
			t.Fatalf("%q: number = %#v", q, filter["number"])
		}
		if _, ok := filter["$text"]; ok {
			t.Fatalf("%q: must not add $text", q)
		}
		if filter["mailbox_id"] != "abc" {
			t.Fatal("mailbox filter must be preserved")
		}
	}
}

func TestApplyTicketSearchNumberZeroFallsThrough(t *testing.T) {
	filter := bson.M{}
	searching, useScore := applyTicketSearch(filter, "0")
	if !searching || !useScore {
		t.Fatalf("zero should fall through to $text, searching=%v score=%v", searching, useScore)
	}
}

func TestApplyTicketSearchEmail(t *testing.T) {
	filter := bson.M{"mailbox_id": bson.M{"$in": []string{"a"}}}
	searching, useScore := applyTicketSearch(filter, "Ada@Example.com")
	if !searching {
		t.Fatal("expected searching")
	}
	if useScore {
		t.Fatal("email lookup should not use textScore")
	}
	email, ok := filter["requester.email"].(bson.M)
	if !ok {
		t.Fatalf("expected requester.email, got %#v", filter)
	}
	if email["$regex"] != `Ada@Example\.com` {
		t.Fatalf("regex = %#v", email["$regex"])
	}
	if _, ok := filter["$text"]; ok {
		t.Fatal("must not add $text")
	}
	if _, ok := filter["$or"]; ok {
		t.Fatal("must not use $or")
	}
}

func TestNormalizeSearchQueryTruncatesRunes(t *testing.T) {
	q := strings.Repeat("é", ticketSearchMaxLen+10)
	got := normalizeSearchQuery(q)
	if len([]rune(got)) != ticketSearchMaxLen {
		t.Fatalf("len=%d want %d", len([]rune(got)), ticketSearchMaxLen)
	}
}
