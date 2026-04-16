package email

import (
	"context"
	"crypto/rand"
	"crypto/tls"
	"encoding/base64"
	"fmt"
	"mime"
	"net"
	"net/smtp"
	"regexp"
	"strings"
	"time"

	"github.com/emersion/go-imap/v2"
	"github.com/helpdesk/backend/internal/models"
)

// ReplyHeaders carries threading headers for outgoing emails.
type ReplyHeaders struct {
	InReplyTo   string   // Message-ID of the last message in the thread
	References  []string // All Message-IDs in the thread, in order
	ThreadTopic string   // Thread-Topic header (Outlook threading)
}

// SendReply sends an email reply to the ticket requester (and Cc recipients) via SMTP.
// Returns the generated Message-ID and the raw message bytes.
func SendReply(cfg models.EmailSettings, to string, cc []string, subject, textBody, htmlBody string, headers ReplyHeaders) (string, []byte, error) {
	if cfg.SMTPHost == "" {
		return "", nil, fmt.Errorf("SMTP not configured")
	}

	from := cfg.SMTPFrom
	if from == "" {
		from = cfg.SMTPUser
	}
	port := cfg.SMTPPort
	if port == 0 {
		port = 587
	}
	addr := net.JoinHostPort(cfg.SMTPHost, fmt.Sprintf("%d", port))

	// Generate a unique Message-ID for this outgoing email
	randBytes := make([]byte, 16)
	rand.Read(randBytes)
	domain := cfg.SMTPHost
	if idx := strings.Index(from, "@"); idx >= 0 {
		domain = from[idx+1:]
		if end := strings.Index(domain, ">"); end >= 0 {
			domain = domain[:end]
		}
	}
	messageID := fmt.Sprintf("<%x.%d@%s>", randBytes, time.Now().UnixNano(), domain)

	// Build MIME message
	altBoundary := "----=_HelpDeskBoundary_alt"
	relBoundary := "----=_HelpDeskBoundary_rel"

	// Extract inline base64 images from HTML and convert to CID attachments
	var cidParts []cidAttachment
	processedHTML := htmlBody
	if processedHTML != "" {
		processedHTML, cidParts = extractInlineImages(processedHTML)
	}

	var msg strings.Builder

	msg.WriteString("From: " + from + "\r\n")
	msg.WriteString("To: " + to + "\r\n")
	if len(cc) > 0 {
		msg.WriteString("Cc: " + strings.Join(cc, ", ") + "\r\n")
	}
	msg.WriteString("Subject: " + mime.QEncoding.Encode("utf-8", subject) + "\r\n")
	msg.WriteString("Message-ID: " + messageID + "\r\n")
	if headers.InReplyTo != "" {
		msg.WriteString("In-Reply-To: " + headers.InReplyTo + "\r\n")
	}
	if len(headers.References) > 0 {
		msg.WriteString("References: " + strings.Join(headers.References, " ") + "\r\n")
	}
	if headers.ThreadTopic != "" {
		msg.WriteString("Thread-Topic: " + headers.ThreadTopic + "\r\n")
	}
	msg.WriteString("Date: " + time.Now().UTC().Format(time.RFC1123Z) + "\r\n")
	msg.WriteString("MIME-Version: 1.0\r\n")

	if len(cidParts) > 0 {
		// multipart/related wrapping multipart/alternative + CID images
		msg.WriteString("Content-Type: multipart/related; boundary=\"" + relBoundary + "\"\r\n")
		msg.WriteString("\r\n")

		// Start related: alternative part
		msg.WriteString("--" + relBoundary + "\r\n")
		msg.WriteString("Content-Type: multipart/alternative; boundary=\"" + altBoundary + "\"\r\n")
		msg.WriteString("\r\n")

		writeAlternativeParts(&msg, altBoundary, textBody, processedHTML)

		// CID image parts
		for _, cp := range cidParts {
			msg.WriteString("--" + relBoundary + "\r\n")
			msg.WriteString("Content-Type: " + cp.contentType + "\r\n")
			msg.WriteString("Content-Transfer-Encoding: base64\r\n")
			msg.WriteString("Content-ID: <" + cp.cid + ">\r\n")
			msg.WriteString("Content-Disposition: inline\r\n")
			msg.WriteString("\r\n")
			writeBase64Wrapped(&msg, cp.data)
			msg.WriteString("\r\n")
		}

		msg.WriteString("--" + relBoundary + "--\r\n")
	} else {
		// Simple multipart/alternative (no inline images)
		msg.WriteString("Content-Type: multipart/alternative; boundary=\"" + altBoundary + "\"\r\n")
		msg.WriteString("\r\n")

		writeAlternativeParts(&msg, altBoundary, textBody, processedHTML)
	}

	msgBytes := []byte(msg.String())

	// Connect and send
	if cfg.SMTPTLS && port == 465 {
		// Implicit TLS (SMTPS)
		tlsConfig := &tls.Config{ServerName: cfg.SMTPHost}
		conn, err := tls.Dial("tcp", addr, tlsConfig)
		if err != nil {
			return "", nil, fmt.Errorf("smtp tls dial: %w", err)
		}
		defer conn.Close()

		c, err := smtp.NewClient(conn, cfg.SMTPHost)
		if err != nil {
			return "", nil, fmt.Errorf("smtp new client: %w", err)
		}
		defer c.Close()

		if err := smtpSend(c, cfg, from, to, cc, msgBytes); err != nil {
			return "", nil, err
		}
	} else {
		// STARTTLS or plain
		c, err := smtp.Dial(addr)
		if err != nil {
			return "", nil, fmt.Errorf("smtp dial: %w", err)
		}
		defer c.Close()

		if cfg.SMTPTLS {
			tlsConfig := &tls.Config{ServerName: cfg.SMTPHost}
			if err := c.StartTLS(tlsConfig); err != nil {
				return "", nil, fmt.Errorf("smtp starttls: %w", err)
			}
		}

		if err := smtpSend(c, cfg, from, to, cc, msgBytes); err != nil {
			return "", nil, err
		}
	}

	return messageID, msgBytes, nil
}

func wrapHTML(body string) string {
	return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body><style>
pre, code { background-color: #f5f5f5; border-radius: 4px; }
code { padding: 2px 4px; font-size: 0.9em; }
pre { padding: 12px; overflow-x: auto; }
pre code { padding: 0; background: none; }
img { max-width: 100%; height: auto; }
</style>` + body + `</body></html>`
}

type cidAttachment struct {
	cid         string
	contentType string
	data        []byte
}

var dataURIRegex = regexp.MustCompile(`(?i)(<img[^>]+src=")data:([^;]+);base64,([^"]+)("[^>]*>)`)

// extractInlineImages finds data: URIs in <img> tags and replaces them with cid: references.
func extractInlineImages(html string) (string, []cidAttachment) {
	var parts []cidAttachment
	counter := 0

	result := dataURIRegex.ReplaceAllStringFunc(html, func(match string) string {
		groups := dataURIRegex.FindStringSubmatch(match)
		if len(groups) < 5 {
			return match
		}
		contentType := groups[2]
		b64Data := groups[3]

		data, err := base64.StdEncoding.DecodeString(b64Data)
		if err != nil {
			// Try RawStdEncoding (no padding)
			data, err = base64.RawStdEncoding.DecodeString(b64Data)
			if err != nil {
				return match
			}
		}

		counter++
		cid := fmt.Sprintf("img%d@helpdesk", counter)

		parts = append(parts, cidAttachment{
			cid:         cid,
			contentType: contentType,
			data:        data,
		})

		return groups[1] + "cid:" + cid + groups[4]
	})

	return result, parts
}

func writeAlternativeParts(msg *strings.Builder, boundary, textBody, htmlBody string) {
	// Plain text part
	msg.WriteString("--" + boundary + "\r\n")
	msg.WriteString("Content-Type: text/plain; charset=\"utf-8\"\r\n")
	msg.WriteString("Content-Transfer-Encoding: 8bit\r\n\r\n")
	msg.WriteString(textBody + "\r\n")

	// HTML part
	if htmlBody != "" {
		msg.WriteString("--" + boundary + "\r\n")
		msg.WriteString("Content-Type: text/html; charset=\"utf-8\"\r\n")
		msg.WriteString("Content-Transfer-Encoding: 8bit\r\n\r\n")
		msg.WriteString(wrapHTML(htmlBody) + "\r\n")
	}

	msg.WriteString("--" + boundary + "--\r\n")
}

func writeBase64Wrapped(msg *strings.Builder, data []byte) {
	encoded := base64.StdEncoding.EncodeToString(data)
	// Wrap at 76 characters per RFC 2045
	for len(encoded) > 76 {
		msg.WriteString(encoded[:76] + "\r\n")
		encoded = encoded[76:]
	}
	if len(encoded) > 0 {
		msg.WriteString(encoded + "\r\n")
	}
}

func smtpSend(c *smtp.Client, cfg models.EmailSettings, from, to string, cc []string, msg []byte) error {
	if cfg.SMTPUser != "" && cfg.SMTPPassword != "" {
		auth := smtp.PlainAuth("", cfg.SMTPUser, cfg.SMTPPassword, cfg.SMTPHost)
		if err := c.Auth(auth); err != nil {
			return fmt.Errorf("smtp auth: %w", err)
		}
	}
	if err := c.Mail(from); err != nil {
		return fmt.Errorf("smtp mail: %w", err)
	}
	if err := c.Rcpt(to); err != nil {
		return fmt.Errorf("smtp rcpt: %w", err)
	}
	for _, addr := range cc {
		if err := c.Rcpt(addr); err != nil {
			return fmt.Errorf("smtp rcpt cc %s: %w", addr, err)
		}
	}
	w, err := c.Data()
	if err != nil {
		return fmt.Errorf("smtp data: %w", err)
	}
	if _, err := w.Write(msg); err != nil {
		return fmt.Errorf("smtp write: %w", err)
	}
	if err := w.Close(); err != nil {
		return fmt.Errorf("smtp close data: %w", err)
	}
	return c.Quit()
}

// StoreSentEmail appends the raw message to the configured sent mailbox via IMAP.
func StoreSentEmail(cfg models.EmailSettings, rawMsg []byte) error {
	if cfg.SentMailbox == "" || cfg.IMAPHost == "" {
		return nil
	}

	return withIMAPRetry(context.Background(), func() error {
		c, err := connect(cfg)
		if err != nil {
			return fmt.Errorf("imap connect for sent: %w", err)
		}
		defer c.Close()

		if err := c.Login(cfg.IMAPUser, cfg.IMAPPassword).Wait(); err != nil {
			return fmt.Errorf("imap login for sent: %w", err)
		}

		appendCmd := c.Append(cfg.SentMailbox, int64(len(rawMsg)), &imap.AppendOptions{
			Flags: []imap.Flag{imap.FlagSeen},
		})
		if _, err := appendCmd.Write(rawMsg); err != nil {
			return fmt.Errorf("imap append write: %w", err)
		}
		if err := appendCmd.Close(); err != nil {
			return fmt.Errorf("imap append close: %w", err)
		}

		return nil
	})
}

// MoveToDeletedMailbox moves emails identified by their Message-IDs from the
// inbox to the configured deleted mailbox via IMAP MOVE (or COPY+delete fallback).
func MoveToDeletedMailbox(cfg models.EmailSettings, messageIDs []string) error {
	if cfg.DeletedMailbox == "" || cfg.IMAPHost == "" || len(messageIDs) == 0 {
		return nil
	}

	return withIMAPRetry(context.Background(), func() error {
		c, err := connect(cfg)
		if err != nil {
			return fmt.Errorf("imap connect for delete: %w", err)
		}
		defer c.Close()

		if err := c.Login(cfg.IMAPUser, cfg.IMAPPassword).Wait(); err != nil {
			return fmt.Errorf("imap login for delete: %w", err)
		}

		mailbox := cfg.IMAPMailbox
		if mailbox == "" {
			mailbox = "INBOX"
		}
		if _, err := c.Select(mailbox, nil).Wait(); err != nil {
			return fmt.Errorf("imap select %s: %w", mailbox, err)
		}

		// Search for each Message-ID and collect UIDs
		var allUIDs []imap.UID
		for _, mid := range messageIDs {
			// Ensure angle brackets for IMAP header search — the raw header
			// contains them even though the envelope strips them.
			searchMID := mid
			if !strings.HasPrefix(searchMID, "<") {
				searchMID = "<" + searchMID + ">"
			}
			criteria := &imap.SearchCriteria{
				Header: []imap.SearchCriteriaHeaderField{
					{Key: "Message-ID", Value: searchMID},
				},
			}
			searchData, err := c.UIDSearch(criteria, nil).Wait()
			if err != nil {
				continue
			}
			allUIDs = append(allUIDs, searchData.AllUIDs()...)
		}

		if len(allUIDs) == 0 {
			return nil
		}

		uidSet := imap.UIDSetNum(allUIDs...)

		// Try MOVE first, fall back to COPY+delete
		moveCmd := c.Move(uidSet, cfg.DeletedMailbox)
		if _, err := moveCmd.Wait(); err != nil {
			// Fallback: COPY then mark deleted and expunge
			copyCmd := c.Copy(uidSet, cfg.DeletedMailbox)
			if _, err := copyCmd.Wait(); err != nil {
				return fmt.Errorf("imap copy to %s: %w", cfg.DeletedMailbox, err)
			}
			storeCmd := c.Store(uidSet, &imap.StoreFlags{
				Op:    imap.StoreFlagsAdd,
				Flags: []imap.Flag{imap.FlagDeleted},
			}, nil)
			for {
				msg := storeCmd.Next()
				if msg == nil {
					break
				}
				for msg.Next() != nil {
				}
			}
			_ = storeCmd.Close()
			expungeCmd := c.Expunge()
			for expungeCmd.Next() != 0 {
			}
			if err := expungeCmd.Close(); err != nil {
				return fmt.Errorf("imap expunge: %w", err)
			}
		}

		return nil
	})
}
