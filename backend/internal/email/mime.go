package email

import (
	"encoding/base64"
	"fmt"
	"io"
	"mime"
	"strings"

	"github.com/emersion/go-message"
	"golang.org/x/text/encoding/ianaindex"
)

func init() {
	message.CharsetReader = func(charset string, r io.Reader) (io.Reader, error) {
		enc, err := ianaindex.IANA.Encoding(charset)
		if err != nil || enc == nil {
			return r, nil
		}
		return enc.NewDecoder().Reader(r), nil
	}
}

type Attachment struct {
	Filename    string `json:"filename"`
	ContentType string `json:"content_type"`
	Data        []byte `json:"-"`
	Size        int    `json:"size"`
}

type ParsedBody struct {
	Text         string
	HTML         string
	Subject      string
	To           []string
	Cc           []string
	Attachments  []Attachment
	ThreadTopic  string
	ThreadIndex  string   // Raw Thread-Index header (base64)
	References   []string // Message-IDs from the References header
	inlineImages []string // base64 <img> tags for inline images without Content-ID
}

func ParseMIMEBody(raw []byte) ParsedBody {
	r := strings.NewReader(string(raw))
	entity, err := message.Read(r)
	if err != nil {
		return ParsedBody{Text: string(raw)}
	}

	var result ParsedBody
	cidMap := make(map[string]string) // cid -> data URI

	if subj := entity.Header.Get("Subject"); subj != "" {
		dec := new(mime.WordDecoder)
		if decoded, err := dec.DecodeHeader(subj); err == nil {
			result.Subject = decoded
		} else {
			result.Subject = subj
		}
	}

	if topic := entity.Header.Get("Thread-Topic"); topic != "" {
		result.ThreadTopic = topic
	}

	if ti := entity.Header.Get("Thread-Index"); ti != "" {
		result.ThreadIndex = strings.TrimSpace(ti)
	}

	// Parse To header
	if to := entity.Header.Get("To"); to != "" {
		for _, addr := range strings.Split(to, ",") {
			addr = strings.TrimSpace(addr)
			if addr != "" {
				result.To = append(result.To, addr)
			}
		}
	}

	// Parse Cc header
	if cc := entity.Header.Get("Cc"); cc != "" {
		for _, addr := range strings.Split(cc, ",") {
			addr = strings.TrimSpace(addr)
			if addr != "" {
				result.Cc = append(result.Cc, addr)
			}
		}
	}

	// Parse References header for thread matching
	if refs := entity.Header.Get("References"); refs != "" {
		for _, ref := range strings.Fields(refs) {
			ref = strings.TrimSpace(ref)
			if ref != "" {
				result.References = append(result.References, ref)
			}
		}
	}

	collectParts(entity, &result, cidMap)

	// Replace cid: references in HTML with inline base64 data URIs
	if result.HTML != "" && len(cidMap) > 0 {
		for cid, dataURI := range cidMap {
			result.HTML = strings.ReplaceAll(result.HTML, "cid:"+cid, dataURI)
		}
	}

	// Append any inline images that had no Content-ID to the HTML body
	if len(result.inlineImages) > 0 {
		if result.HTML == "" {
			// Convert plain text to basic HTML so we can embed images
			result.HTML = "<pre>" + result.Text + "</pre>"
		}
		result.HTML += strings.Join(result.inlineImages, "")
	}

	return result
}

func collectParts(e *message.Entity, result *ParsedBody, cidMap map[string]string) {
	mediaType, params, _ := e.Header.ContentType()

	if mr := e.MultipartReader(); mr != nil {
		for {
			part, err := mr.NextPart()
			if err != nil {
				break
			}
			collectParts(part, result, cidMap)
		}
		return
	}

	body, err := io.ReadAll(e.Body)
	if err != nil {
		return
	}

	// Check for Content-ID (inline attachment for cid: references)
	// Only treat non-text parts as inline resources; text/html and text/plain
	// parts may carry a Content-ID in multipart/related messages but still
	// contain the actual message body.
	contentID := e.Header.Get("Content-Id")
	if contentID != "" && !strings.HasPrefix(mediaType, "text/") {
		cid := strings.TrimPrefix(strings.TrimSuffix(contentID, ">"), "<")
		if strings.HasPrefix(mediaType, "image/") || strings.HasPrefix(mediaType, "application/") {
			dataURI := fmt.Sprintf("data:%s;base64,%s", mediaType, base64.StdEncoding.EncodeToString(body))
			cidMap[cid] = dataURI
		}
		return
	}

	// Determine disposition
	disp := strings.ToLower(e.Header.Get("Content-Disposition"))

	// Check if this is an attachment (explicit disposition or non-text type without CID)
	isAttachment := strings.HasPrefix(disp, "attachment")
	isInline := strings.HasPrefix(disp, "inline")
	filename := extractFilename(e, params)

	switch {
	case strings.HasPrefix(mediaType, "text/html") && !isAttachment:
		if result.HTML == "" {
			result.HTML = string(body)
		}
	case strings.HasPrefix(mediaType, "text/plain") && !isAttachment:
		if result.Text == "" {
			result.Text = string(body)
		}
	case (mediaType == "" || strings.HasPrefix(mediaType, "text")) && !isAttachment:
		if result.Text == "" {
			result.Text = string(body)
		}
	case isInline && strings.HasPrefix(mediaType, "image/"):
		// Inline image without Content-ID — embed directly as base64 img tag
		dataURI := fmt.Sprintf("data:%s;base64,%s", mediaType, base64.StdEncoding.EncodeToString(body))
		imgTag := fmt.Sprintf(`<img src="%s" />`, dataURI)
		result.inlineImages = append(result.inlineImages, imgTag)
	default:
		// Treat as attachment
		if filename == "" {
			ext := ".bin"
			exts, _ := mime.ExtensionsByType(mediaType)
			if len(exts) > 0 {
				ext = exts[0]
			}
			filename = fmt.Sprintf("attachment%s", ext)
		}
		result.Attachments = append(result.Attachments, Attachment{
			Filename:    filename,
			ContentType: mediaType,
			Data:        body,
			Size:        len(body),
		})
	}
}

func extractFilename(e *message.Entity, params map[string]string) string {
	// Try Content-Disposition filename
	disp := e.Header.Get("Content-Disposition")
	if disp != "" {
		_, dparams, err := mime.ParseMediaType(disp)
		if err == nil {
			if name, ok := dparams["filename"]; ok {
				return name
			}
		}
	}
	// Try Content-Type name parameter
	if name, ok := params["name"]; ok {
		return name
	}
	return ""
}
