package store

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"log/slog"
	"time"

	"github.com/helpdesk/backend/internal/email"
	"github.com/helpdesk/backend/internal/models"
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
			if len(parsed.Attachments) > 0 && len(msg.Attachments) == 0 {
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
	}
	for _, idx := range indexes {
		_, err := db.database.Collection(idx.collection).Indexes().CreateOne(ctx, idx.model)
		if err != nil {
			return fmt.Errorf("create index on %s: %w", idx.collection, err)
		}
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
				slog.Info("admin password reset via INIT_PASSWORD", "email", admin.Email, "password", password)
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
				slog.Info("admin password was empty, assigned new password", "email", admin.Email, "password", password)
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
	slog.Info("default admin user created", "email", admin.Email, "password", password)
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
	return nil
}
