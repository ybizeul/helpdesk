package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/go-webauthn/webauthn/webauthn"
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

	// Initialize WebAuthn
	rpID := envOr("WEBAUTHN_RPID", "localhost")
	rpOrigins := strings.Split(envOr("WEBAUTHN_ORIGINS", "http://localhost:8080,http://localhost:5173"), ",")
	rpName := envOr("WEBAUTHN_RPNAME", "Helpdesk")

	wan, err := webauthn.New(&webauthn.Config{
		RPDisplayName: rpName,
		RPID:          rpID,
		RPOrigins:     rpOrigins,
	})
	if err != nil {
		slog.Error("failed to initialize WebAuthn", "error", err)
		os.Exit(1)
	}

	apiRouter := api.NewRouter(db, wan)
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
		// Load settings to get poll interval and email config
		var s models.Settings
		err := db.Settings().FindOne(context.Background(), bson.M{"_id": "global"}).Decode(&s)
		if err != nil || s.Email.IMAPHost == "" {
			// No email configured yet, check again later
			select {
			case <-stop:
				return
			case <-time.After(defaultInterval):
				continue
			}
		}

		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
		result, err := email.FetchEmails(ctx, s.Email, db)
		cancel()
		if err != nil {
			slog.Error("background email fetch failed", "error", err)
		} else if result.Count > 0 {
			slog.Info("background email fetch", "created", result.Created, "updated", result.Updated)
		}

		interval := time.Duration(s.Email.PollIntervalSeconds) * time.Second
		if interval <= 0 {
			interval = defaultInterval
		}

		select {
		case <-stop:
			return
		case <-time.After(interval):
		}
	}
}
