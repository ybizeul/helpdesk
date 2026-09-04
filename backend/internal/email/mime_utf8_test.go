package email

import (
	"strings"
	"testing"
	"unicode/utf8"
)

// Mail that declares a charset we cannot resolve reaches the parser as raw
// bytes. Storing those would make MongoDB reject the ticket text index.
func TestParseMIMEBody_UnknownCharsetStoresValidUTF8(t *testing.T) {
	raw := strings.Join([]string{
		"From: Rene <rene@example.com>",
		"Subject: Commande caf\xe9",
		"MIME-Version: 1.0",
		"Content-Type: text/plain; charset=\"x-unknown-charset\"",
		"",
		"Bonjour, la commande est arriv\xe9e.",
		"",
	}, "\r\n")

	parsed := ParseMIMEBody([]byte(raw))

	if !utf8.ValidString(parsed.Text) {
		t.Fatalf("body is not valid UTF-8: %q", parsed.Text)
	}
	if !utf8.ValidString(parsed.Subject) {
		t.Fatalf("subject is not valid UTF-8: %q", parsed.Subject)
	}
	if !strings.Contains(parsed.Text, "arrivée") {
		t.Fatalf("expected accented text to be recovered, got %q", parsed.Text)
	}
	if !strings.Contains(parsed.Subject, "café") {
		t.Fatalf("expected accented subject to be recovered, got %q", parsed.Subject)
	}
}

func TestParseMIMEBody_UnparseableMailStoresValidUTF8(t *testing.T) {
	parsed := ParseMIMEBody([]byte("not a mime message \xe9\xff"))
	if !utf8.ValidString(parsed.Text) {
		t.Fatalf("fallback text is not valid UTF-8: %q", parsed.Text)
	}
}
