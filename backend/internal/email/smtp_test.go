package email

import (
	"strings"
	"testing"
)

func TestApplyInlineStyles(t *testing.T) {
	out := applyInlineStyles(`<blockquote><p>quoted</p></blockquote><p>an <code>inline</code> bit</p><pre><code class="language-go">x := 1</code></pre>`)

	if !strings.Contains(out, `<blockquote style="`+blockquoteStyle+`">`) {
		t.Errorf("blockquote not styled: %s", out)
	}
	if !strings.Contains(out, `<code style="`+codeStyle+`">inline</code>`) {
		t.Errorf("inline code not styled: %s", out)
	}
	if !strings.Contains(out, `<pre style="`+preStyle+`">`) {
		t.Errorf("code block not styled: %s", out)
	}
	if !strings.Contains(out, `<code class="language-go" style="`+preCodeStyle+`">`) {
		t.Errorf("code inside pre should reset, not repeat, the box: %s", out)
	}
}

func TestApplyInlineStylesKeepsAuthorStyles(t *testing.T) {
	in := `<blockquote style="color:red">quoted</blockquote>`
	if out := applyInlineStyles(in); out != in {
		t.Errorf("expected existing style attribute to be preserved, got %s", out)
	}
}

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
