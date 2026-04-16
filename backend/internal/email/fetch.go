package email

import (
	"context"
	"crypto/tls"
	"fmt"
	"io"
	"log/slog"
	"mime"
	"net"
	"regexp"
	"strconv"
	"time"

	"github.com/emersion/go-imap/v2"
	"github.com/emersion/go-imap/v2/imapclient"
	"github.com/helpdesk/backend/internal/models"
	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
)

type FetchResult struct {
	Created int `json:"created"`
	Updated int `json:"updated"`
	Count   int `json:"count"`
}

type TicketStore interface {
	Tickets() *mongo.Collection
	Settings() *mongo.Collection
	NextTicketNumber(ctx context.Context) (int, error)
	EnsureCounterAtLeast(ctx context.Context, val int) error
}

func FetchEmails(ctx context.Context, cfg models.EmailSettings, db TicketStore) (*FetchResult, error) {
	var result *FetchResult
	err := withIMAPRetry(ctx, func() error {
		var runErr error
		result, runErr = fetchEmailsOnce(ctx, cfg, db)
		return runErr
	})
	if err != nil {
		return nil, err
	}
	return result, nil
}

func fetchEmailsOnce(ctx context.Context, cfg models.EmailSettings, db TicketStore) (*FetchResult, error) {
	c, err := connect(cfg)
	if err != nil {
		return nil, err
	}
	defer c.Close()

	// Close the IMAP connection if the context is canceled
	go func() {
		<-ctx.Done()
		c.Close()
	}()

	if err := c.Login(cfg.IMAPUser, cfg.IMAPPassword).Wait(); err != nil {
		return nil, fmt.Errorf("imap login: %w", err)
	}

	mailbox := cfg.IMAPMailbox
	if mailbox == "" {
		mailbox = "INBOX"
	}

	if _, err := c.Select(mailbox, nil).Wait(); err != nil {
		return nil, fmt.Errorf("imap select %s: %w", mailbox, err)
	}

	// Load last fetched date from settings
	var settings models.Settings
	var lastFetchedAt *time.Time
	if err := db.Settings().FindOne(ctx, bson.M{"_id": "global"}).Decode(&settings); err == nil {
		lastFetchedAt = settings.LastFetchedAt
	}

	// If we have a last fetched date, search for emails since that date
	// OR any unseen emails (to catch older unread messages).
	// Otherwise fall back to unseen only.
	var criteria *imap.SearchCriteria
	if lastFetchedAt != nil {
		criteria = &imap.SearchCriteria{
			Or: [][2]imap.SearchCriteria{
				{
					imap.SearchCriteria{Since: *lastFetchedAt},
					imap.SearchCriteria{NotFlag: []imap.Flag{imap.FlagSeen}},
				},
			},
		}
	} else {
		criteria = &imap.SearchCriteria{
			NotFlag: []imap.Flag{imap.FlagSeen},
		}
	}
	searchData, err := c.UIDSearch(criteria, nil).Wait()
	if err != nil {
		return nil, fmt.Errorf("imap search: %w", err)
	}

	// Search succeeded — update last_fetched_at regardless of what happens next
	defer updateFetchedAt(ctx, db)

	uids := searchData.AllUIDs()
	if len(uids) == 0 {
		return &FetchResult{Count: 0}, nil
	}

	// Build UIDSet from search results
	uidSet := imap.UIDSetNum(uids...)

	fetchOpts := &imap.FetchOptions{
		Envelope: true,
		BodySection: []*imap.FetchItemBodySection{
			{Specifier: imap.PartSpecifierNone, Peek: true},
		},
	}
	fetchCmd := c.Fetch(uidSet, fetchOpts)

	result := &FetchResult{}
	var processedUIDs []imap.UID
	uidIdx := 0

	for {
		msg := fetchCmd.Next()
		if msg == nil {
			break
		}

		var from, fromName, subject, messageID string
		var inReplyTo []string
		var to, cc []string
		var date time.Time
		var rawBody []byte

		for {
			item := msg.Next()
			if item == nil {
				break
			}
			switch data := item.(type) {
			case imapclient.FetchItemDataEnvelope:
				subject = data.Envelope.Subject
				date = data.Envelope.Date
				messageID = data.Envelope.MessageID
				inReplyTo = data.Envelope.InReplyTo
				if len(data.Envelope.From) > 0 {
					a := data.Envelope.From[0]
					from = fmt.Sprintf("%s@%s", a.Mailbox, a.Host)
					dec := new(mime.WordDecoder)
					if decoded, err := dec.DecodeHeader(a.Name); err == nil {
						fromName = decoded
					} else {
						fromName = a.Name
					}
				}
				for _, a := range data.Envelope.To {
					to = append(to, fmt.Sprintf("%s@%s", a.Mailbox, a.Host))
				}
				for _, a := range data.Envelope.Cc {
					cc = append(cc, fmt.Sprintf("%s@%s", a.Mailbox, a.Host))
				}
			case imapclient.FetchItemDataBodySection:
				rawBody, _ = io.ReadAll(data.Literal)
			}
		}

		if messageID == "" {
			slog.Warn("skipping email without Message-ID", "subject", subject)
			continue
		}

		// Skip if this message was already imported
		count, _ := db.Tickets().CountDocuments(ctx, bson.M{"messages.message_id": messageID})
		if count > 0 {
			if uidIdx < len(uids) {
				processedUIDs = append(processedUIDs, uids[uidIdx])
			}
			uidIdx++
			continue
		}

		parsed := ParseMIMEBody(rawBody)

		var attachments []models.MessageAttachment
		for _, a := range parsed.Attachments {
			attachments = append(attachments, models.MessageAttachment{
				Filename:    a.Filename,
				ContentType: a.ContentType,
				Size:        a.Size,
				Data:        a.Data,
			})
		}

		newMsg := models.Message{
			MessageID:   messageID,
			From:        from,
			To:          to,
			Subject:     subject,
			Cc:          cc,
			Body:        parsed.Text,
			HTML:        parsed.HTML,
			RawEmail:    rawBody,
			Attachments: attachments,
			CreatedAt:   date,
		}
		if len(newMsg.Cc) == 0 && len(parsed.Cc) > 0 {
			newMsg.Cc = parsed.Cc
		}

		// Remove any previously imported message with the same Message-ID
		db.Tickets().UpdateMany(ctx, bson.M{"messages.message_id": messageID}, bson.M{
			"$pull": bson.M{"messages": bson.M{"message_id": messageID}},
		})

		// Delete tickets that were created from this message and now have no messages left
		db.Tickets().DeleteMany(ctx, bson.M{
			"email_thread_id": messageID,
			"messages":        bson.M{"$size": 0},
		})

		// Also delete old tickets created from this message before message_id tracking existed
		// (ticket thread ID matches and all messages lack a message_id)
		db.Tickets().DeleteMany(ctx, bson.M{
			"email_thread_id":     messageID,
			"messages.message_id": bson.M{"$exists": false},
		})

		// Determine if this is a reply to an existing ticket.
		// Check In-Reply-To headers against existing ticket email_thread_id or
		// message_id of any message in a ticket.
		var existingTicket *models.Ticket

		// Collect all reference IDs to check: In-Reply-To + References from MIME
		refIDs := make([]string, 0, len(inReplyTo)+len(parsed.References))
		refIDs = append(refIDs, inReplyTo...)
		for _, ref := range parsed.References {
			// Avoid duplicates
			dup := false
			for _, existing := range refIDs {
				if ref == existing {
					dup = true
					break
				}
			}
			if !dup {
				refIDs = append(refIDs, ref)
			}
		}

		if len(refIDs) > 0 {
			// Try to match any reference ID against email_thread_id or messages.message_id
			var t models.Ticket
			err := db.Tickets().FindOne(ctx, bson.M{"$or": bson.A{
				bson.M{"email_thread_id": bson.M{"$in": refIDs}},
				bson.M{"messages.message_id": bson.M{"$in": refIDs}},
			}}).Decode(&t)
			if err == nil {
				existingTicket = &t
			}
		}

		// Try matching by Thread-Topic header (Outlook threading)
		if existingTicket == nil && parsed.ThreadTopic != "" {
			var t models.Ticket
			err := db.Tickets().FindOne(ctx, bson.M{
				"thread_topic":    parsed.ThreadTopic,
				"requester.email": from,
			}).Decode(&t)
			if err == nil {
				existingTicket = &t
			}
		}

		// Also try matching by subject prefix (Re: <original subject>)
		if existingTicket == nil && len(subject) > 4 {
			stripped := stripRePrefix(subject)
			if stripped != subject {
				var t models.Ticket
				err := db.Tickets().FindOne(ctx, bson.M{
					"subject":         stripped,
					"requester.email": from,
				}).Decode(&t)
				if err == nil {
					existingTicket = &t
				}
			}
		}

		if existingTicket != nil {
			// Append message to existing ticket
			oid, _ := bson.ObjectIDFromHex(existingTicket.ID)
			newStatus := models.TicketStatusUnassigned
			if existingTicket.OwnerID != "" {
				newStatus = models.TicketStatusActive
			}
			update := bson.M{
				"$push": bson.M{"messages": newMsg},
				"$set":  bson.M{"updated_at": date, "status": newStatus, "unread": true},
			}
			// Backfill requester name if not yet recorded
			if existingTicket.Requester.Name == "" && fromName != "" {
				update["$set"].(bson.M)["requester.name"] = fromName
			}
			_, err := db.Tickets().UpdateByID(ctx, oid, update)
			if err != nil {
				slog.Error("failed to update ticket", "id", existingTicket.ID, "error", err)
				continue
			}
			result.Updated++
		} else {
			// Create a new ticket
			// Check if the subject contains a ticket number like [#1234]
			var num int
			if extracted := extractTicketNumber(subject); extracted > 0 {
				// Only use it if no ticket with that number exists
				count, _ := db.Tickets().CountDocuments(ctx, bson.M{"number": extracted})
				if count == 0 {
					num = extracted
					// Advance counter so future tickets don't collide
					if err := db.EnsureCounterAtLeast(ctx, num+1); err != nil {
						slog.Error("failed to advance ticket counter", "error", err)
					}
				}
			}
			if num == 0 {
				var numErr error
				num, numErr = db.NextTicketNumber(ctx)
				if numErr != nil {
					slog.Error("failed to get ticket number", "error", numErr)
					continue
				}
			}
			ticket := models.Ticket{
				Number:        num,
				Subject:       subject,
				Status:        models.TicketStatusUnassigned,
				Priority:      models.PriorityNormal,
				Requester:     models.Requester{Name: fromName, Email: from},
				Messages:      []models.Message{newMsg},
				EmailThreadID: messageID,
				ThreadTopic:   parsed.ThreadTopic,
				Unread:        true,
				CreatedAt:     date,
				UpdatedAt:     date,
			}
			_, err := db.Tickets().InsertOne(ctx, ticket)
			if err != nil {
				slog.Error("failed to create ticket", "subject", subject, "error", err)
				continue
			}
			result.Created++
		}

		if uidIdx < len(uids) {
			processedUIDs = append(processedUIDs, uids[uidIdx])
		}
		uidIdx++
	}

	if err := fetchCmd.Close(); err != nil {
		return nil, fmt.Errorf("imap fetch: %w", err)
	}

	// Mark processed messages as seen
	if len(processedUIDs) > 0 {
		storeSet := imap.UIDSetNum(processedUIDs...)
		storeCmd := c.Store(storeSet, &imap.StoreFlags{
			Op:    imap.StoreFlagsAdd,
			Flags: []imap.Flag{imap.FlagSeen},
		}, nil)
		// Drain the store command
		for {
			msg := storeCmd.Next()
			if msg == nil {
				break
			}
			for {
				if msg.Next() == nil {
					break
				}
			}
		}
		if err := storeCmd.Close(); err != nil {
			slog.Error("failed to mark messages as seen", "error", err)
		}
	}

	result.Count = result.Created + result.Updated

	return result, nil
}

func updateFetchedAt(ctx context.Context, db TicketStore) {
	now := time.Now()
	db.Settings().UpdateOne(ctx, bson.M{"_id": "global"}, bson.M{
		"$set": bson.M{"last_fetched_at": now},
	}, options.UpdateOne().SetUpsert(true))
}

func stripRePrefix(subject string) string {
	// Handle Re:, RE:, re:, Fwd:, FW: etc.
	s := subject
	for {
		trimmed := s
		for _, prefix := range []string{"Re: ", "RE: ", "re: ", "Re:", "RE:", "re:", "Fwd: ", "FW: ", "fwd: ", "Fwd:", "FW:", "fwd:"} {
			if len(trimmed) > len(prefix) && trimmed[:len(prefix)] == prefix {
				trimmed = trimmed[len(prefix):]
				break
			}
		}
		if trimmed == s {
			return s
		}
		s = trimmed
	}
}

var ticketNumberRe = regexp.MustCompile(`\[#(\d+)\]`)

// extractTicketNumber returns the ticket number found in a subject like "[#1042] Some subject", or 0.
func extractTicketNumber(subject string) int {
	m := ticketNumberRe.FindStringSubmatch(subject)
	if m == nil {
		return 0
	}
	n, err := strconv.Atoi(m[1])
	if err != nil {
		return 0
	}
	return n
}

func connect(cfg models.EmailSettings) (*imapclient.Client, error) {
	const dialTimeout = 30 * time.Second

	port := cfg.IMAPPort
	if port == 0 {
		if cfg.IMAPTLS {
			port = 993
		} else {
			port = 143
		}
	}
	addr := fmt.Sprintf("%s:%d", cfg.IMAPHost, port)

	if cfg.IMAPTLS {
		dialer := &tls.Dialer{
			NetDialer: &net.Dialer{Timeout: dialTimeout},
			Config:    &tls.Config{ServerName: cfg.IMAPHost},
		}
		conn, err := dialer.DialContext(context.Background(), "tcp", addr)
		if err != nil {
			return nil, fmt.Errorf("imap connect: %w", err)
		}
		return imapclient.New(conn, nil), nil
	}

	conn, err := net.DialTimeout("tcp", addr, dialTimeout)
	if err != nil {
		return nil, fmt.Errorf("imap dial: %w", err)
	}
	return imapclient.New(conn, nil), nil
}
