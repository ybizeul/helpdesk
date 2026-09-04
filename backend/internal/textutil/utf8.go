// Package textutil holds small text helpers shared by email parsing, storage
// and the API.
package textutil

import (
	"strings"
	"unicode/utf8"

	"golang.org/x/text/encoding/charmap"
)

// ToValidUTF8 returns text that MongoDB accepts in a text index.
//
// Emails that declare an unknown or wrong charset reach us as raw bytes, most
// often Windows-1252. Only the invalid bytes are decoded that way, so a body
// that is genuine UTF-8 apart from a few stray bytes keeps its own characters
// instead of turning into mojibake.
func ToValidUTF8(s string) string {
	if s == "" || utf8.ValidString(s) {
		return s
	}
	var b strings.Builder
	b.Grow(len(s))
	for i := 0; i < len(s); {
		r, size := utf8.DecodeRuneInString(s[i:])
		if r == utf8.RuneError && size <= 1 {
			b.WriteRune(charmap.Windows1252.DecodeByte(s[i]))
			i++
			continue
		}
		b.WriteString(s[i : i+size])
		i += size
	}
	return b.String()
}

// ToValidUTF8Slice applies ToValidUTF8 to every element. It reports whether any
// element changed so callers can skip a write.
func ToValidUTF8Slice(in []string) (out []string, changed bool) {
	out = make([]string, len(in))
	for i, s := range in {
		out[i] = ToValidUTF8(s)
		if out[i] != s {
			changed = true
		}
	}
	return out, changed
}
