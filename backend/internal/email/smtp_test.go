package email

import (
	"strings"
	"testing"
)

func TestEncodeQuotedPrintable_NoMalformedSoftBreak(t *testing.T) {
	input := strings.Repeat("A", 90)
	encoded := encodeQuotedPrintable(input)

	if strings.Contains(encoded, "=\r\r\n") {
		t.Fatalf("found malformed quoted-printable soft break sequence: %q", encoded)
	}
	if !strings.Contains(encoded, "=\r\n") {
		t.Fatalf("expected at least one quoted-printable soft break in encoded output: %q", encoded)
	}
}
