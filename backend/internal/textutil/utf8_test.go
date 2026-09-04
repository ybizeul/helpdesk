package textutil

import (
	"testing"
	"unicode/utf8"
)

func TestToValidUTF8KeepsValidText(t *testing.T) {
	for _, s := range []string{"", "plain", "café", "日本語", "emoji 🎉"} {
		if got := ToValidUTF8(s); got != s {
			t.Fatalf("ToValidUTF8(%q) = %q, want unchanged", s, got)
		}
	}
}

func TestToValidUTF8RecoversLatin1(t *testing.T) {
	// "café" encoded as Windows-1252: 0xE9 is a bare byte, invalid UTF-8.
	got := ToValidUTF8("caf\xe9")
	if got != "café" {
		t.Fatalf("got %q, want %q", got, "café")
	}
}

func TestToValidUTF8KeepsGenuineUTF8AroundBadBytes(t *testing.T) {
	// Real UTF-8 "café" plus one stray Windows-1252 byte. The genuine
	// characters must survive instead of being re-decoded into mojibake.
	got := ToValidUTF8("café \xe9t\xe9")
	if got != "café été" {
		t.Fatalf("got %q, want %q", got, "café été")
	}
}

func TestToValidUTF8IsIdempotent(t *testing.T) {
	for _, in := range []string{"caf\xe9", "café \xe9t\xe9", "\xff\xfe", "clean"} {
		once := ToValidUTF8(in)
		if twice := ToValidUTF8(once); twice != once {
			t.Fatalf("ToValidUTF8(%q): %q then %q", in, once, twice)
		}
	}
}

func TestToValidUTF8AlwaysReturnsValidUTF8(t *testing.T) {
	inputs := []string{"caf\xe9", "\xff\xfe\xfd", "mixed \xc3\x28 bytes", "\x81\x8d\x90"}
	for _, in := range inputs {
		got := ToValidUTF8(in)
		if !utf8.ValidString(got) {
			t.Fatalf("ToValidUTF8(%q) = %q, which is not valid UTF-8", in, got)
		}
	}
}

func TestToValidUTF8Slice(t *testing.T) {
	out, changed := ToValidUTF8Slice([]string{"ok", "urgent"})
	if changed {
		t.Fatalf("clean slice reported changed: %#v", out)
	}

	out, changed = ToValidUTF8Slice([]string{"ok", "caf\xe9"})
	if !changed {
		t.Fatal("dirty slice should report changed")
	}
	if out[1] != "café" {
		t.Fatalf("out[1] = %q", out[1])
	}
}
