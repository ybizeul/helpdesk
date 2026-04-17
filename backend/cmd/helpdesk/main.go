package main

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/helpdesk/backend/internal/api"
	"github.com/helpdesk/backend/internal/email"
	"github.com/helpdesk/backend/internal/models"
	"github.com/helpdesk/backend/internal/store"
	"go.mongodb.org/mongo-driver/v2/bson"
)

func main() {
	logger := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	slog.SetDefault(logger)

	mongoURI := envOr("MONGO_URI", "mongodb://localhost:27017")
	dbName := envOr("MONGO_DB", "helpdesk")
	listenAddr := envOr("LISTEN_ADDR", ":8080")

	api.InitJWTSecret(os.Getenv("JWT_SECRET"))

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	db, err := store.Connect(ctx, mongoURI, dbName)
	if err != nil {
		slog.Error("failed to connect to MongoDB", "error", err)
		os.Exit(1)
	}
	defer db.Disconnect(context.Background())

	slog.Info("connected to MongoDB", "uri", mongoURI, "db", dbName)

	if err := db.InitTicketCounter(ctx, 1000); err != nil {
		slog.Error("failed to init ticket counter", "error", err)
		os.Exit(1)
	}

	if err := db.BackfillTicketNumbers(ctx); err != nil {
		slog.Error("failed to backfill ticket numbers", "error", err)
		os.Exit(1)
	}

	if err := db.ReparseRawEmails(ctx); err != nil {
		slog.Error("failed to reparse raw emails", "error", err)
		os.Exit(1)
	}
	if err := db.ForceReparseRawEmails(ctx); err != nil {
		slog.Error("failed to force reparse raw emails", "error", err)
		os.Exit(1)
	}
	if err := db.BackfillRequesterNames(ctx); err != nil {
		slog.Error("failed to backfill requester names", "error", err)
		os.Exit(1)
	}

	if err := db.EnsureIndexes(ctx); err != nil {
		slog.Error("failed to create indexes", "error", err)
		os.Exit(1)
	}

	if err := db.EnsureDefaultAdmin(ctx, os.Getenv("INIT_PASSWORD")); err != nil {
		slog.Error("failed to ensure default admin", "error", err)
		os.Exit(1)
	}

	if err := db.RunMigrations(ctx); err != nil {
		slog.Error("failed to run migrations", "error", err)
		os.Exit(1)
	}

	apiRouter := api.NewRouter(db)
	frontend := frontendHandler()

	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Route /api/ requests to the API, everything else to the embedded frontend.
		if strings.HasPrefix(r.URL.Path, "/api/") {
			apiRouter.ServeHTTP(w, r)
			return
		}
		frontend.ServeHTTP(w, r)
	})

	srv := &http.Server{
		Addr:         listenAddr,
		Handler:      handler,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	go func() {
		slog.Info("server starting", "addr", listenAddr)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			slog.Error("server error", "error", err)
			os.Exit(1)
		}
	}()

	// Start background email poller
	stopPoller := make(chan struct{})
	go pollEmails(db, stopPoller)

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	close(stopPoller)
	slog.Info("shutting down server")
	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer shutdownCancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		slog.Error("server forced shutdown", "error", err)
	}
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func pollEmails(db *store.DB, stop <-chan struct{}) {
	const defaultInterval = 60 * time.Second

	for {
		// Load all mailboxes
		ctx := context.Background()
		cur, err := db.Mailboxes().Find(ctx, bson.M{
			"email.imap_host": bson.M{"$ne": ""},
			"enabled":         true,
		})
		if err != nil {
			select {
			case <-stop:
				return
			case <-time.After(defaultInterval):
				continue
			}
		}

		var mailboxes []models.Mailbox
		if err := cur.All(ctx, &mailboxes); err != nil || len(mailboxes) == 0 {
			cur.Close(ctx)
			select {
			case <-stop:
				return
			case <-time.After(defaultInterval):
				continue
			}
		}
		cur.Close(ctx)

		minInterval := defaultInterval
		for _, mb := range mailboxes {
			fetchCtx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
			result, fetchErr := email.FetchEmails(fetchCtx, mb.Email, db, mb.ID, mb.LastFetchedAt)
			cancel()
			if fetchErr != nil {
				slog.Error("background email fetch failed", "mailbox", mb.Name, "error", fetchErr)
			} else if result.Count > 0 {
				slog.Info("background email fetch", "mailbox", mb.Name, "created", result.Created, "updated", result.Updated)
				if result.Created > 0 || result.Updated > 0 {
					go sendPushoverNotifications(db, mb, result)
				}
			}

			interval := time.Duration(mb.Email.PollIntervalSeconds) * time.Second
			if interval > 0 && interval < minInterval {
				minInterval = interval
			}
		}

		select {
		case <-stop:
			return
		case <-time.After(minInterval):
		}
	}
}

func sendPushoverNotifications(db *store.DB, mb models.Mailbox, result *email.FetchResult) {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	// Load the Pushover app token from global settings
	var s models.Settings
	if err := db.Settings().FindOne(ctx, bson.M{"_id": "global"}).Decode(&s); err != nil || s.PushoverAppToken == "" {
		return
	}

	// Find users who have a pushover key and access to this mailbox
	// Admins have access to all mailboxes; agents only if mailbox is in their list
	filter := bson.M{"pushover_key": bson.M{"$ne": ""}}
	cur, err := db.Users().Find(ctx, filter)
	if err != nil {
		slog.Error("pushover: failed to query users", "error", err)
		return
	}
	defer cur.Close(ctx)

	var users []models.User
	if err := cur.All(ctx, &users); err != nil {
		slog.Error("pushover: failed to decode users", "error", err)
		return
	}

	// Build messages from events
	var messages []string
	for _, ev := range result.Events {
		sender := ev.FromName
		if sender == "" {
			sender = ev.FromEmail
		}
		if ev.IsNew {
			messages = append(messages, fmt.Sprintf("New case in %s from %s", mb.Name, sender))
		} else {
			messages = append(messages, fmt.Sprintf("%s replied to case #%d", sender, ev.Number))
		}
	}
	if len(messages) == 0 {
		return
	}

	for _, u := range users {
		if u.Role != models.RoleAdmin {
			hasAccess := false
			for _, mid := range u.Mailboxes {
				if mid == mb.ID {
					hasAccess = true
					break
				}
			}
			if !hasAccess {
				continue
			}
		}
		for _, msg := range messages {
			if err := sendPushover(s.PushoverAppToken, u.PushoverKey, msg); err != nil {
				slog.Error("pushover: failed to send", "user", u.Email, "error", err)
			}
		}
	}
}

func sendPushover(appToken, userKey, message string) error {
	resp, err := http.PostForm("https://api.pushover.net/1/messages.json", url.Values{
		"token":   {appToken},
		"user":    {userKey},
		"message": {message},
	})
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("pushover API returned status %d", resp.StatusCode)
	}
	return nil
}
