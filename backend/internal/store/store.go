package store

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"log/slog"
	"net/mail"
	"time"

	"github.com/helpdesk/backend/internal/email"
	"github.com/helpdesk/backend/internal/models"
	"github.com/helpdesk/backend/internal/textutil"
	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
)

type DB struct {
	client   *mongo.Client
	database *mongo.Database
}

func Connect(ctx context.Context, uri, dbName string) (*DB, error) {
	client, err := mongo.Connect(options.Client().ApplyURI(uri).SetBSONOptions(&options.BSONOptions{
		ObjectIDAsHexString: true,
	}))
	if err != nil {
		return nil, fmt.Errorf("mongo connect: %w", err)
	}
	if err := client.Ping(ctx, nil); err != nil {
		return nil, fmt.Errorf("mongo ping: %w", err)
	}
	return &DB{
		client:   client,
		database: client.Database(dbName),
	}, nil
}

func (db *DB) Disconnect(ctx context.Context) {
	_ = db.client.Disconnect(ctx)
}

func (db *DB) Ping(ctx context.Context) error {
	return db.client.Ping(ctx, nil)
}

func (db *DB) Tickets() *mongo.Collection     { return db.database.Collection("tickets") }
func (db *DB) Users() *mongo.Collection       { return db.database.Collection("users") }
func (db *DB) Attachments() *mongo.Collection { return db.database.Collection("attachments") }
func (db *DB) Settings() *mongo.Collection    { return db.database.Collection("settings") }
func (db *DB) Counters() *mongo.Collection    { return db.database.Collection("counters") }
func (db *DB) Passkeys() *mongo.Collection    { return db.database.Collection("passkeys") }
func (db *DB) Mailboxes() *mongo.Collection   { return db.database.Collection("mailboxes") }

// NextTicketNumber atomically increments and returns the next ticket number.
// The sequence starts at 1000.
func (db *DB) NextTicketNumber(ctx context.Context) (int, error) {
	var result struct {
		Seq int `bson:"seq"`
	}
	err := db.Counters().FindOneAndUpdate(
		ctx,
		bson.M{"_id": "ticket_number"},
		bson.M{"$inc": bson.M{"seq": 1}},
		options.FindOneAndUpdate().SetUpsert(true).SetReturnDocument(options.After),
	).Decode(&result)
	if err != nil {
		return 0, fmt.Errorf("next ticket number: %w", err)
	}
	return result.Seq, nil
}

// InitTicketCounter sets the counter to startAt-1 if not already present.
func (db *DB) InitTicketCounter(ctx context.Context, startAt int) error {
	_, err := db.Counters().UpdateOne(
		ctx,
		bson.M{"_id": "ticket_number"},
		bson.M{"$setOnInsert": bson.M{"seq": startAt - 1}},
		options.UpdateOne().SetUpsert(true),
	)
	return err
}

// EnsureCounterAtLeast advances the ticket counter so that it is at least val.
// This prevents future auto-assigned numbers from colliding with a manually chosen number.
func (db *DB) EnsureCounterAtLeast(ctx context.Context, val int) error {
	_, err := db.Counters().UpdateOne(
		ctx,
		bson.M{"_id": "ticket_number", "seq": bson.M{"$lt": val}},
		bson.M{"$set": bson.M{"seq": val}},
	)
	return err
}

// BackfillTicketNumbers assigns numbers to any tickets that don't have one yet.
func (db *DB) BackfillTicketNumbers(ctx context.Context) error {
	cur, err := db.Tickets().Find(ctx, bson.M{
		"$or": []bson.M{
			{"number": bson.M{"$exists": false}},
			{"number": 0},
		},
	}, options.Find().SetSort(bson.D{{Key: "created_at", Value: 1}}))
	if err != nil {
		return fmt.Errorf("find unnumbered tickets: %w", err)
	}
	defer cur.Close(ctx)

	count := 0
	for cur.Next(ctx) {
		var t struct {
			ID string `bson:"_id"`
		}
		if err := cur.Decode(&t); err != nil {
			return fmt.Errorf("decode ticket: %w", err)
		}
		num, err := db.NextTicketNumber(ctx)
		if err != nil {
			return fmt.Errorf("next ticket number: %w", err)
		}
		oid, _ := bson.ObjectIDFromHex(t.ID)
		if _, err := db.Tickets().UpdateByID(ctx, oid, bson.M{"$set": bson.M{"number": num}}); err != nil {
			return fmt.Errorf("update ticket %s: %w", t.ID, err)
		}
		count++
	}
	if count > 0 {
		slog.Info("backfilled ticket numbers", "count", count)
	}
	return nil
}

// ReparseRawEmails re-parses messages that have raw_email stored but empty body/html
// (e.g. due to earlier charset decoding bugs).
func (db *DB) ReparseRawEmails(ctx context.Context) error {
	cur, err := db.Tickets().Find(ctx, bson.M{
		"messages": bson.M{
			"$elemMatch": bson.M{
				"raw_email": bson.M{"$exists": true, "$ne": nil},
				"body":      "",
				"html":      "",
			},
		},
	})
	if err != nil {
		return fmt.Errorf("find tickets with empty bodies: %w", err)
	}
	defer cur.Close(ctx)

	count := 0
	for cur.Next(ctx) {
		var t models.Ticket
		if err := cur.Decode(&t); err != nil {
			slog.Warn("reparse: decode ticket failed", "error", err)
			continue
		}
		for i, msg := range t.Messages {
			if len(msg.RawEmail) == 0 || msg.Body != "" || msg.HTML != "" {
				continue
			}
			parsed := email.ParseMIMEBody(msg.RawEmail)
			if parsed.Text == "" && parsed.HTML == "" {
				continue
			}
			prefix := fmt.Sprintf("messages.%d.", i)
			update := bson.M{
				prefix + "body": parsed.Text,
				prefix + "html": parsed.HTML,
			}
			if len(parsed.Attachments) > 0 {
				atts := make([]models.MessageAttachment, len(parsed.Attachments))
				for j, a := range parsed.Attachments {
					atts[j] = models.MessageAttachment{
						Filename:    a.Filename,
						ContentType: a.ContentType,
						Size:        len(a.Data),
						Data:        a.Data,
					}
				}
				update[prefix+"attachments"] = atts
			}
			oid, _ := bson.ObjectIDFromHex(t.ID)
			if _, err := db.Tickets().UpdateByID(ctx, oid, bson.M{"$set": update}); err != nil {
				slog.Warn("reparse: update failed", "ticket", t.ID, "msg", i, "error", err)
				continue
			}
			count++
		}
	}
	if count > 0 {
		slog.Info("re-parsed raw emails", "messages_fixed", count)
	}
	return nil
}

func messageAttachmentsMatchParsed(existing []models.MessageAttachment, parsed []email.Attachment) bool {
	if len(existing) != len(parsed) {
		return false
	}
	for i := range existing {
		if existing[i].Filename != parsed[i].Filename {
			return false
		}
		if existing[i].ContentType != parsed[i].ContentType {
			return false
		}
		if existing[i].Size != parsed[i].Size {
			return false
		}
		if len(existing[i].Data) != len(parsed[i].Data) {
			return false
		}
	}
	return true
}

// ForceReparseRawEmails re-parses ALL messages that have raw_email stored,
// updating body, html, attachments, and thread_topic regardless of current values.
func (db *DB) ForceReparseRawEmails(ctx context.Context) error {
	cur, err := db.Tickets().Find(ctx, bson.M{
		"messages.raw_email": bson.M{"$exists": true},
	})
	if err != nil {
		return fmt.Errorf("find tickets with raw_email: %w", err)
	}
	defer cur.Close(ctx)

	count := 0
	for cur.Next(ctx) {
		var t models.Ticket
		if err := cur.Decode(&t); err != nil {
			slog.Warn("force-reparse: decode ticket failed", "error", err)
			continue
		}
		changed := false
		for i, msg := range t.Messages {
			if len(msg.RawEmail) == 0 {
				continue
			}
			parsed := email.ParseMIMEBody(msg.RawEmail)
			if parsed.Text != msg.Body || parsed.HTML != msg.HTML {
				t.Messages[i].Body = parsed.Text
				t.Messages[i].HTML = parsed.HTML
				changed = true
			}
			if len(parsed.Cc) > 0 && len(msg.Cc) == 0 {
				t.Messages[i].Cc = parsed.Cc
				changed = true
			}
			if len(parsed.Attachments) > 0 && !messageAttachmentsMatchParsed(msg.Attachments, parsed.Attachments) {
				atts := make([]models.MessageAttachment, len(parsed.Attachments))
				for j, a := range parsed.Attachments {
					atts[j] = models.MessageAttachment{
						Filename:    a.Filename,
						ContentType: a.ContentType,
						Size:        a.Size,
						Data:        a.Data,
					}
				}
				t.Messages[i].Attachments = atts
				changed = true
			}
			if parsed.ThreadTopic != "" && t.ThreadTopic == "" {
				t.ThreadTopic = parsed.ThreadTopic
				changed = true
			}
		}
		if !changed {
			continue
		}
		oid, _ := bson.ObjectIDFromHex(t.ID)
		_, err := db.Tickets().UpdateByID(ctx, oid, bson.M{
			"$set": bson.M{
				"messages":     t.Messages,
				"thread_topic": t.ThreadTopic,
			},
		})
		if err != nil {
			slog.Warn("force-reparse: update failed", "ticket", t.ID, "error", err)
			continue
		}
		count++
	}
	if count > 0 {
		slog.Info("force re-parsed all raw emails", "tickets_updated", count)
	}
	return nil
}

// sanitizeSentinelField records a completed repair on the global settings
// document so the scan runs once instead of on every boot.
const sanitizeSentinelField = "ticket_utf8_sanitized_at"

// SanitizeTicketText repairs ticket text that is not valid UTF-8. MongoDB
// refuses to build a text index over such documents, so this must run before
// EnsureIndexes.
func (db *DB) SanitizeTicketText(ctx context.Context) error {
	var sentinel struct {
		At *time.Time `bson:"ticket_utf8_sanitized_at"`
	}
	if err := db.Settings().FindOne(ctx, bson.M{"_id": "global"}).Decode(&sentinel); err == nil && sentinel.At != nil {
		return nil
	}

	// Tickets carry raw MIME and attachment bytes; only text fields are needed
	// here, and loading the rest would be a lot of memory for nothing.
	projection := bson.M{
		"subject":          1,
		"thread_topic":     1,
		"requester":        1,
		"tags":             1,
		"messages.subject": 1,
		"messages.body":    1,
		"messages.html":    1,
		"messages.from":    1,
	}
	cur, err := db.Tickets().Find(ctx, bson.M{}, options.Find().SetProjection(projection))
	if err != nil {
		return fmt.Errorf("find tickets: %w", err)
	}
	defer cur.Close(ctx)

	repaired, skipped := 0, 0
	for cur.Next(ctx) {
		var t models.Ticket
		if err := cur.Decode(&t); err != nil {
			slog.Warn("sanitize: decode ticket failed", "error", err)
			skipped++
			continue
		}
		set := sanitizeTicketFields(t)
		if len(set) == 0 {
			continue
		}
		oid, err := bson.ObjectIDFromHex(t.ID)
		if err != nil {
			slog.Warn("sanitize: bad ticket id", "ticket", t.ID, "error", err)
			skipped++
			continue
		}
		if _, err := db.Tickets().UpdateByID(ctx, oid, bson.M{"$set": set}); err != nil {
			slog.Warn("sanitize: update failed", "ticket", t.ID, "error", err)
			skipped++
			continue
		}
		repaired++
	}
	if err := cur.Err(); err != nil {
		return fmt.Errorf("iterate tickets: %w", err)
	}
	if repaired > 0 {
		slog.Info("repaired invalid UTF-8 in tickets", "tickets", repaired)
	}
	if skipped > 0 {
		// Leaving the sentinel unset retries the whole pass on the next boot.
		return fmt.Errorf("%d ticket(s) could not be repaired", skipped)
	}

	_, err = db.Settings().UpdateOne(ctx,
		bson.M{"_id": "global"},
		bson.M{"$set": bson.M{sanitizeSentinelField: time.Now().UTC()}},
		options.UpdateOne().SetUpsert(true),
	)
	if err != nil {
		return fmt.Errorf("record sanitize sentinel: %w", err)
	}
	return nil
}

// sanitizeTicketFields returns the $set fields needed to make a ticket's text
// valid UTF-8, or an empty map when it is already clean.
func sanitizeTicketFields(t models.Ticket) bson.M {
	set := bson.M{}
	addString := func(field, value string) {
		if fixed := textutil.ToValidUTF8(value); fixed != value {
			set[field] = fixed
		}
	}

	addString("subject", t.Subject)
	addString("thread_topic", t.ThreadTopic)
	addString("requester.name", t.Requester.Name)
	addString("requester.email", t.Requester.Email)
	if tags, changed := textutil.ToValidUTF8Slice(t.Tags); changed {
		set["tags"] = tags
	}
	for i, m := range t.Messages {
		prefix := fmt.Sprintf("messages.%d.", i)
		addString(prefix+"subject", m.Subject)
		addString(prefix+"body", m.Body)
		addString(prefix+"html", m.HTML)
		addString(prefix+"from", m.From)
	}
	return set
}

func (db *DB) EnsureIndexes(ctx context.Context) error {
	indexes := []struct {
		collection string
		model      mongo.IndexModel
	}{
		{"tickets", mongo.IndexModel{Keys: bson.D{{Key: "number", Value: 1}}, Options: options.Index().SetUnique(true).SetSparse(true)}},
		{"tickets", mongo.IndexModel{Keys: bson.D{{Key: "status", Value: 1}, {Key: "updated_at", Value: -1}}}},
		{"tickets", mongo.IndexModel{Keys: bson.D{{Key: "assignee_id", Value: 1}}}},
		{"tickets", mongo.IndexModel{Keys: bson.D{{Key: "email_thread_id", Value: 1}}}},
		{"tickets", mongo.IndexModel{Keys: bson.D{{Key: "requester.email", Value: 1}}}},
		{"users", mongo.IndexModel{Keys: bson.D{{Key: "email", Value: 1}}, Options: options.Index().SetUnique(true)}},
		{"attachments", mongo.IndexModel{Keys: bson.D{{Key: "ticket_id", Value: 1}}}},
		{"passkeys", mongo.IndexModel{Keys: bson.D{{Key: "user_id", Value: 1}}}},
		{"passkeys", mongo.IndexModel{Keys: bson.D{{Key: "credential_id", Value: 1}}, Options: options.Index().SetUnique(true)}},
		{"mailboxes", mongo.IndexModel{Keys: bson.D{{Key: "slug", Value: 1}}, Options: options.Index().SetUnique(true)}},
		{"tickets", mongo.IndexModel{Keys: bson.D{{Key: "mailbox_id", Value: 1}}}},
	}
	for _, idx := range indexes {
		_, err := db.database.Collection(idx.collection).Indexes().CreateOne(ctx, idx.model)
		if err != nil {
			return fmt.Errorf("create index on %s: %w", idx.collection, err)
		}
	}

	// The search index is best-effort: a single unindexable ticket must degrade
	// search rather than stop the server from starting.
	textIndex := mongo.IndexModel{
		Keys: bson.D{
			{Key: "subject", Value: "text"},
			{Key: "requester.name", Value: "text"},
			{Key: "requester.email", Value: "text"},
			{Key: "tags", Value: "text"},
			{Key: "messages.body", Value: "text"},
		},
		Options: options.Index().
			SetName("tickets_text").
			SetDefaultLanguage("none").
			SetWeights(map[string]int32{
				"subject":         10,
				"requester.email": 8,
				"requester.name":  5,
				"tags":            4,
				"messages.body":   1,
			}),
	}
	if _, err := db.Tickets().Indexes().CreateOne(ctx, textIndex); err != nil {
		slog.Error("ticket search index not built; search is unavailable", "error", err)
	}
	return nil
}

func (db *DB) EnsureDefaultAdmin(ctx context.Context, initPassword string) error {
	count, err := db.Users().CountDocuments(ctx, bson.M{})
	if err != nil {
		return err
	}
	if count > 0 {
		// If INIT_PASSWORD is set, force-reset the first admin's password
		if initPassword != "" {
			var admin models.User
			if err := db.Users().FindOne(ctx, bson.M{"role": models.RoleAdmin}).Decode(&admin); err == nil {
				password := initPassword
				oid, _ := bson.ObjectIDFromHex(admin.ID)
				_, err = db.Users().UpdateByID(ctx, oid, bson.M{"$set": bson.M{"password_hash": HashPassword(password)}})
				if err != nil {
					return err
				}
				slog.Info("admin password reset via INIT_PASSWORD", "email", admin.Email)
			}
		} else {
			// If any admin has an empty password, generate one
			var admin models.User
			if err := db.Users().FindOne(ctx, bson.M{"role": models.RoleAdmin, "password_hash": ""}).Decode(&admin); err == nil {
				b := make([]byte, 16)
				if _, err := rand.Read(b); err != nil {
					return err
				}
				password := hex.EncodeToString(b)
				oid, _ := bson.ObjectIDFromHex(admin.ID)
				_, err = db.Users().UpdateByID(ctx, oid, bson.M{"$set": bson.M{"password_hash": HashPassword(password)}})
				if err != nil {
					return err
				}
				slog.Info("admin password was empty and has been regenerated", "email", admin.Email)
			}
		}
		return nil
	}

	password := initPassword
	if password == "" {
		b := make([]byte, 16)
		if _, err := rand.Read(b); err != nil {
			return err
		}
		password = hex.EncodeToString(b)
	}

	admin := models.User{
		Name:         "Admin",
		Email:        "admin@localhost",
		Role:         models.RoleAdmin,
		PasswordHash: HashPassword(password),
		CreatedAt:    time.Now(),
	}
	_, err = db.Users().InsertOne(ctx, admin)
	if err != nil {
		return err
	}
	slog.Info("default admin user created", "email", admin.Email)
	return nil
}

// RunMigrations applies one-time data migrations. Each migration is idempotent.
func (db *DB) RunMigrations(ctx context.Context) error {
	// Migration: rename ticket status "open" → "active"
	result, err := db.Tickets().UpdateMany(ctx, bson.M{"status": "open"}, bson.M{"$set": bson.M{"status": "active"}})
	if err != nil {
		return err
	}
	if result.ModifiedCount > 0 {
		slog.Info("migration: renamed ticket status open→active", "count", result.ModifiedCount)
	}

	// Migration: create default mailbox from global settings if no mailboxes exist
	if err := db.migrateToMailboxes(ctx); err != nil {
		return fmt.Errorf("mailbox migration: %w", err)
	}

	return nil
}

// migrateToMailboxes creates a "Default" mailbox from existing global settings
// and assigns all tickets and agent users to it.
func (db *DB) migrateToMailboxes(ctx context.Context) error {
	count, err := db.Mailboxes().CountDocuments(ctx, bson.M{})
	if err != nil {
		return err
	}
	if count > 0 {
		return nil // already migrated
	}

	// Read legacy settings (which may still have email/signature/last_fetched_at)
	var legacy struct {
		Email         models.EmailSettings `bson:"email"`
		Signature     string               `bson:"signature"`
		LastFetchedAt *time.Time           `bson:"last_fetched_at"`
	}
	_ = db.Settings().FindOne(ctx, bson.M{"_id": "global"}).Decode(&legacy)

	now := time.Now()
	mailbox := models.Mailbox{
		Name:          "Default",
		Slug:          "default",
		Email:         legacy.Email,
		Signature:     legacy.Signature,
		LastFetchedAt: legacy.LastFetchedAt,
		CreatedAt:     now,
		UpdatedAt:     now,
	}
	res, err := db.Mailboxes().InsertOne(ctx, mailbox)
	if err != nil {
		return fmt.Errorf("insert default mailbox: %w", err)
	}
	mailboxID := res.InsertedID.(bson.ObjectID).Hex()
	slog.Info("migration: created default mailbox", "id", mailboxID)

	// Assign mailbox_id to all existing tickets
	ticketResult, err := db.Tickets().UpdateMany(ctx,
		bson.M{"mailbox_id": bson.M{"$exists": false}},
		bson.M{"$set": bson.M{"mailbox_id": mailboxID}},
	)
	if err != nil {
		return fmt.Errorf("assign tickets to default mailbox: %w", err)
	}
	if ticketResult.ModifiedCount > 0 {
		slog.Info("migration: assigned tickets to default mailbox", "count", ticketResult.ModifiedCount)
	}

	// Assign mailbox to all agent users
	agentResult, err := db.Users().UpdateMany(ctx,
		bson.M{"role": models.RoleAgent, "mailboxes": bson.M{"$exists": false}},
		bson.M{"$set": bson.M{"mailboxes": []string{mailboxID}}},
	)
	if err != nil {
		return fmt.Errorf("assign agents to default mailbox: %w", err)
	}
	if agentResult.ModifiedCount > 0 {
		slog.Info("migration: assigned agents to default mailbox", "count", agentResult.ModifiedCount)
	}

	// Clean up legacy fields from global settings
	db.Settings().UpdateOne(ctx, bson.M{"_id": "global"}, bson.M{
		"$unset": bson.M{"email": "", "signature": "", "last_fetched_at": ""},
	})

	return nil
}

// BackfillRequesterNames fills in requester.name for tickets where it is empty,
// by parsing the From: header of the first message's raw_email.
func (db *DB) BackfillRequesterNames(ctx context.Context) error {
	cur, err := db.Tickets().Find(ctx, bson.M{
		"requester.name":       bson.M{"$in": bson.A{"", nil}},
		"messages.0.raw_email": bson.M{"$exists": true},
	})
	if err != nil {
		return fmt.Errorf("find tickets without requester name: %w", err)
	}
	defer cur.Close(ctx)

	count := 0
	for cur.Next(ctx) {
		var t models.Ticket
		if err := cur.Decode(&t); err != nil {
			slog.Warn("backfill requester name: decode failed", "error", err)
			continue
		}
		// Find the first inbound message with raw_email
		var name string
		for _, msg := range t.Messages {
			if len(msg.RawEmail) == 0 || msg.From == "agent" {
				continue
			}
			m, err := mail.ReadMessage(bytes.NewReader(msg.RawEmail))
			if err != nil {
				continue
			}
			addr, err := mail.ParseAddress(m.Header.Get("From"))
			if err != nil || addr.Name == "" {
				continue
			}
			name = textutil.ToValidUTF8(addr.Name)
			break
		}
		if name == "" {
			continue
		}
		oid, _ := bson.ObjectIDFromHex(t.ID)
		if _, err := db.Tickets().UpdateByID(ctx, oid, bson.M{"$set": bson.M{"requester.name": name}}); err != nil {
			slog.Warn("backfill requester name: update failed", "ticket", t.ID, "error", err)
			continue
		}
		count++
	}
	if count > 0 {
		slog.Info("backfilled requester names", "count", count)
	}
	return nil
}
