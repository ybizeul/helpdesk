package main

import (
	"context"
	"fmt"
	"log"
	"math/rand"
	"os"
	"time"

	"github.com/helpdesk/backend/internal/models"
	"github.com/helpdesk/backend/internal/store"
	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
)

const (
	acmeMailboxSlug      = "acme"
	marvelousMailboxSlug = "marvelous"
)

type seedUser struct {
	Name     string
	Email    string
	Role     models.UserRole
	Password string
}

func main() {
	mongoURI := envOr("MONGO_URI", "mongodb://localhost:27017")
	dbName := envOr("MONGO_DB", "helpdesk")

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	db, err := store.Connect(ctx, mongoURI, dbName)
	if err != nil {
		log.Fatalf("connect db: %v", err)
	}
	defer db.Disconnect(context.Background())

	if err := seed(ctx, db); err != nil {
		log.Fatalf("seed failed: %v", err)
	}

	fmt.Println("Mock data seeded successfully")
	fmt.Println("Login credentials:")
	fmt.Println("- mock-admin@tynsoe.org / Mock1234!")
	fmt.Println("- mock-agent@tynsoe.org / Mock1234!")
	fmt.Println("- mock-triage@tynsoe.org / Mock1234!")
	fmt.Printf("Mailbox slugs: %s, %s\n", acmeMailboxSlug, marvelousMailboxSlug)
}

func seed(ctx context.Context, db *store.DB) error {
	now := time.Now().UTC()

	_, err := db.Settings().UpdateByID(ctx, "global", bson.M{
		"$set": bson.M{
			"site_name":   "Support Center",
			"website_url": "http://localhost:5173",
			"auth": bson.M{
				"oidc_enabled":        false,
				"disable_local_login": false,
			},
			"updated_at": now,
		},
		"$setOnInsert": bson.M{
			"llm": bson.M{
				"endpoint": "",
				"api_key":  "",
				"model":    "",
				"enabled":  false,
			},
			"hupload": bson.M{},
		},
	}, options.UpdateOne().SetUpsert(true))
	if err != nil {
		return fmt.Errorf("upsert global settings: %w", err)
	}

	mailboxIDs, err := upsertMockMailboxes(ctx, db, now)
	if err != nil {
		return err
	}

	users := []seedUser{
		{Name: "Mock Admin", Email: "mock-admin@tynsoe.org", Role: models.RoleAdmin, Password: "Mock1234!"},
		{Name: "Mock Agent", Email: "mock-agent@tynsoe.org", Role: models.RoleAgent, Password: "Mock1234!"},
		{Name: "Triage Agent", Email: "mock-triage@tynsoe.org", Role: models.RoleAgent, Password: "Mock1234!"},
	}

	userIDs := map[string]string{}
	for _, u := range users {
		id, upsertErr := upsertUser(ctx, db, u, mailboxIDs, now)
		if upsertErr != nil {
			return upsertErr
		}
		userIDs[u.Email] = id
	}

	mailboxIDList := []string{mailboxIDs[acmeMailboxSlug], mailboxIDs[marvelousMailboxSlug]}
	if _, err := db.Tickets().DeleteMany(ctx, bson.M{"mailbox_id": bson.M{"$in": mailboxIDList}}); err != nil {
		return fmt.Errorf("cleanup previous mock tickets: %w", err)
	}

	tickets := append(
		buildMockTickets(now, mailboxIDs[acmeMailboxSlug], userIDs, 7000),
		buildMockTickets(now, mailboxIDs[marvelousMailboxSlug], userIDs, 8000)...,
	)
	if len(tickets) == 0 {
		return nil
	}

	docs := make([]any, 0, len(tickets))
	maxNumber := 0
	for _, t := range tickets {
		docs = append(docs, t)
		if t.Number > maxNumber {
			maxNumber = t.Number
		}
	}

	if _, err := db.Tickets().InsertMany(ctx, docs); err != nil {
		return fmt.Errorf("insert tickets: %w", err)
	}

	if err := db.EnsureCounterAtLeast(ctx, maxNumber); err != nil {
		return fmt.Errorf("advance ticket counter: %w", err)
	}

	return nil
}

func upsertMockMailboxes(ctx context.Context, db *store.DB, now time.Time) (map[string]string, error) {
	emailSettings := bson.M{
		"imap_host":             "",
		"imap_port":             993,
		"imap_tls":              true,
		"imap_user":             "",
		"imap_password":         "",
		"imap_mailbox":          "INBOX",
		"sent_mailbox":          "",
		"smtp_host":             "",
		"smtp_port":             587,
		"smtp_tls":              true,
		"smtp_user":             "",
		"smtp_password":         "",
		"smtp_from":             "support@tynsoe.org",
		"deleted_mailbox":       "",
		"poll_interval_seconds": 300,
	}
	targets := []struct {
		name string
		slug string
	}{
		{name: "ACME", slug: acmeMailboxSlug},
		{name: "Marvelous", slug: marvelousMailboxSlug},
	}

	ids := make(map[string]string, len(targets))
	for _, target := range targets {
		res, err := db.Mailboxes().UpdateOne(ctx,
			bson.M{"slug": target.slug},
			bson.M{
				"$set": bson.M{
					"name":       target.name,
					"slug":       target.slug,
					"enabled":    true,
					"email":      emailSettings,
					"signature":  fmt.Sprintf("Best regards,<br>%s Support Team", target.name),
					"updated_at": now,
				},
				"$setOnInsert": bson.M{
					"created_at": now,
				},
			},
			options.UpdateOne().SetUpsert(true),
		)
		if err != nil {
			return nil, fmt.Errorf("upsert mailbox %s: %w", target.slug, err)
		}

		if res.UpsertedID != nil {
			if oid, ok := res.UpsertedID.(bson.ObjectID); ok {
				ids[target.slug] = oid.Hex()
				continue
			}
		}

		var mb models.Mailbox
		if err := db.Mailboxes().FindOne(ctx, bson.M{"slug": target.slug}).Decode(&mb); err != nil {
			return nil, fmt.Errorf("load mailbox id %s: %w", target.slug, err)
		}
		ids[target.slug] = mb.ID
	}

	return ids, nil
}

func upsertUser(ctx context.Context, db *store.DB, u seedUser, mailboxIDs map[string]string, now time.Time) (string, error) {
	update := bson.M{
		"name":          u.Name,
		"email":         u.Email,
		"role":          u.Role,
		"password_hash": store.HashPassword(u.Password),
	}
	if u.Role == models.RoleAgent {
		update["mailboxes"] = []string{mailboxIDs[acmeMailboxSlug], mailboxIDs[marvelousMailboxSlug]}
	}

	res, err := db.Users().UpdateOne(ctx,
		bson.M{"email": u.Email},
		bson.M{
			"$set": update,
			"$setOnInsert": bson.M{
				"created_at": now,
			},
		},
		options.UpdateOne().SetUpsert(true),
	)
	if err != nil {
		return "", fmt.Errorf("upsert user %s: %w", u.Email, err)
	}

	if res.UpsertedID != nil {
		if oid, ok := res.UpsertedID.(bson.ObjectID); ok {
			return oid.Hex(), nil
		}
	}

	var user models.User
	if err := db.Users().FindOne(ctx, bson.M{"email": u.Email}).Decode(&user); err != nil {
		return "", fmt.Errorf("load user %s: %w", u.Email, err)
	}
	return user.ID, nil
}

func buildMockTickets(now time.Time, mailboxID string, userIDs map[string]string, numberBase int) []models.Ticket {
	rng := rand.New(rand.NewSource(42))
	requesters := []models.Requester{
		{Name: "Alice Martin", Email: "alice.martin@example.com"},
		{Name: "Bob Nguyen", Email: "bob.nguyen@example.com"},
		{Name: "Carla Diaz", Email: "carla.diaz@example.com"},
		{Name: "David Rossi", Email: "david.rossi@example.com"},
		{Name: "Elena Smith", Email: "elena.smith@example.com"},
		{Name: "Farid Khan", Email: "farid.khan@example.com"},
	}

	subjects := []string{
		"Unable to reset password",
		"Invoice PDF is blank",
		"2FA code not received",
		"API request returns 500",
		"Need access to archived reports",
		"Mobile app keeps crashing",
		"Data export missing last week",
		"Cannot upload attachment",
		"SAML SSO mapping issue",
		"Feature request: dark mode",
		"Billing address update",
		"Webhook retries too aggressive",
		"Intermittent timeout on search",
		"Wrong timezone in dashboard",
		"Need to merge duplicate accounts",
	}

	statuses := []models.TicketStatus{
		models.TicketStatusUnassigned,
		models.TicketStatusActive,
		models.TicketStatusWaiting,
		models.TicketStatusClosed,
		models.TicketStatusParked,
	}
	priorities := []models.TicketPriority{
		models.PriorityLow,
		models.PriorityNormal,
		models.PriorityHigh,
		models.PriorityUrgent,
	}

	assignees := []string{
		"",
		userIDs["mock-agent@tynsoe.org"],
		userIDs["mock-triage@tynsoe.org"],
	}

	tickets := make([]models.Ticket, 0, len(subjects))
	for i, subject := range subjects {
		createdAt := now.Add(-time.Duration((len(subjects)-i)*6) * time.Hour)
		updatedAt := createdAt.Add(time.Duration(rng.Intn(180)) * time.Minute)
		status := statuses[i%len(statuses)]
		assigneeID := assignees[i%len(assignees)]
		if status == models.TicketStatusUnassigned {
			assigneeID = ""
		}

		requester := requesters[i%len(requesters)]
		msgCount := 1 + rng.Intn(3)
		messages := make([]models.Message, 0, msgCount)
		for m := 0; m < msgCount; m++ {
			msgAt := createdAt.Add(time.Duration(m*30+rng.Intn(20)) * time.Minute)
			from := requester.Email
			private := false
			body := fmt.Sprintf("Hello support, this is message %d about: %s.", m+1, subject)
			if m > 0 && m%2 == 1 {
				from = "mock-agent@tynsoe.org"
				private = rng.Intn(4) == 0
				body = fmt.Sprintf("Agent follow-up on %s. We are investigating and will update soon.", subject)
			}
			messages = append(messages, models.Message{
				MessageID: fmt.Sprintf("<mock-%s-%d-%d@tynsoe.org>", mailboxID, i+1, m+1),
				From:      from,
				To:        []string{"support@tynsoe.org"},
				Subject:   subject,
				Body:      body,
				Private:   private,
				CreatedAt: msgAt,
			})
		}

		ownerID := assigneeID
		if ownerID == "" {
			ownerID = userIDs["mock-triage@tynsoe.org"]
		}

		tickets = append(tickets, models.Ticket{
			Number:        numberBase + i,
			MailboxID:     mailboxID,
			Subject:       subject,
			Status:        status,
			Priority:      priorities[(i+rng.Intn(3))%len(priorities)],
			AssigneeID:    assigneeID,
			OwnerID:       ownerID,
			Requester:     requester,
			Messages:      messages,
			Tags:          []string{"mock", "seed"},
			EmailThreadID: fmt.Sprintf("mock-thread-%03d", i+1),
			Unread:        i%3 == 0,
			CreatedAt:     createdAt,
			UpdatedAt:     updatedAt,
		})
	}

	return tickets
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
