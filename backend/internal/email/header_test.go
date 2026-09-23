package email

import (
	"strings"
	"testing"
)

func TestDecodeHeader(t *testing.T) {
	tests := []struct {
		name string
		in   string
		want string
	}{
		{
			name: "plain header is untouched",
			in:   "S3 object storage monitoring",
			want: "S3 object storage monitoring",
		},
		{
			// Windows-1252 is unknown to the stdlib decoder and needs CharsetReader.
			// =97 is an em dash, and the subject is split across two encoded-words.
			name: "windows-1252 split across encoded-words",
			in:   "=?Windows-1252?Q?Grafana_MCP_server_unreachable_via_public_endpoint_=97_C?= =?Windows-1252?Q?addy_routes_/mcp/grafana_to_harvest-mcp_instead?=",
			want: "Grafana MCP server unreachable via public endpoint — Caddy routes /mcp/grafana to harvest-mcp instead",
		},
		{
			name: "utf-8 base64",
			in:   "=?UTF-8?B?Q29tbWFuZGUgY2Fmw6k=?=",
			want: "Commande café",
		},
		{
			name: "iso-8859-1 quoted-printable",
			in:   "=?ISO-8859-1?Q?Commande_caf=E9?=",
			want: "Commande café",
		},
		{
			name: "encoded-word mixed with plain text",
			in:   "Re: =?Windows-1252?Q?caf=E9?= order",
			want: "Re: café order",
		},
		{
			name: "malformed encoded-word falls back to raw",
			in:   "=?nope?Q?broken",
			want: "=?nope?Q?broken",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := decodeHeader(tt.in); got != tt.want {
				t.Fatalf("decodeHeader(%q)\n got: %q\nwant: %q", tt.in, got, tt.want)
			}
		})
	}
}

func TestParseMIMEBody_DecodesEncodedSubjectAndThreadTopic(t *testing.T) {
	raw := strings.Join([]string{
		"From: Rene <rene@example.com>",
		"Subject: =?Windows-1252?Q?Grafana_MCP_server_unreachable_=97_Caddy_misroutes?=",
		"Thread-Topic: =?Windows-1252?Q?Grafana_MCP_server_unreachable_=97_Caddy_misroutes?=",
		"MIME-Version: 1.0",
		"Content-Type: text/plain; charset=\"utf-8\"",
		"",
		"The public endpoint is down.",
		"",
	}, "\r\n")

	parsed := ParseMIMEBody([]byte(raw))

	want := "Grafana MCP server unreachable — Caddy misroutes"
	if parsed.Subject != want {
		t.Fatalf("subject\n got: %q\nwant: %q", parsed.Subject, want)
	}
	if parsed.ThreadTopic != want {
		t.Fatalf("thread topic\n got: %q\nwant: %q", parsed.ThreadTopic, want)
	}
}
