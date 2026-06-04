package email
package email

import (
	"strings"
	"testing"
)

func TestParseMIMEBody_DecodesQuotedPrintablePlainText(t *testing.T) {
	raw := strings.Join([]string{
		"From: NAbox Help <help@nabox.org>",
		"To: \"Antony Wellens\" <Antony.Wellens@portofantwerpbruges.com>",
		"Subject: Re: [#1140] S3 object storage monitoring",
		"Message-ID: <da1b9cc9884e3c3207147684ef8b7b9e.1780384041009627326@nabox.org>",
		"MIME-Version: 1.0",
		"Content-Type: multipart/alternative; boundary=\"----=_HelpDeskBoundary_alt\"",
		"",
		"------=_HelpDeskBoundary_alt",
		"Content-Type: text/plain; charset=\"utf-8\"",
		"Content-Transfer-Encoding: quoted-printable",
		"",
		"Yes you have to do all three.=20",
		"",
		"Let me know how it goes !",
		"",
		"--",
		"",
		"NAbox Assistance",
		"",
		"Documentation | FAQ=C2=A0| Feed=",
		"back",
		"------=_HelpDeskBoundary_alt--",
		"",
	}, "\r\n")

	parsed := ParseMIMEBody([]byte(raw))

	if strings.Contains(parsed.Text, "Feed=") {
		t.Fatalf("expected quoted-printable soft line break to be decoded, got %q", parsed.Text)
	}
	if strings.Contains(parsed.Text, "=20") || strings.Contains(parsed.Text, "=C2=A0") {
		t.Fatalf("expected quoted-printable escapes to be decoded, got %q", parsed.Text)
	}
	if !strings.Contains(parsed.Text, "Feedback") {
		t.Fatalf("expected decoded text to contain Feedback, got %q", parsed.Text)
	}
}
