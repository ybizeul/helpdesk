package api

import (
	"context"
	"errors"
	"net/http/httptest"
	"reflect"
	"testing"
	"time"

	"github.com/helpdesk/backend/internal/models"
	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
)

func TestRequireAdminForOwnerAssignment(t *testing.T) {
	tests := []struct {
		name   string
		claims *jwtClaims
		want   bool
	}{
		{name: "missing claims", want: false},
		{name: "agent", claims: &jwtClaims{Role: string(models.RoleAgent)}, want: false},
		{name: "administrator", claims: &jwtClaims{Role: string(models.RoleAdmin)}, want: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			request := httptest.NewRequest("PUT", "/api/v1/tickets/ticket-id/owner", nil)
			if tt.claims != nil {
				request = request.WithContext(context.WithValue(request.Context(), claimsKey, tt.claims))
			}
			if got := requireAdmin(request); got != tt.want {
				t.Fatalf("requireAdmin() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestValidateTicketOwner(t *testing.T) {
	tests := []struct {
		name      string
		user      *models.User
		mailboxID string
		wantErr   error
	}{
		{name: "missing user", wantErr: errOwnerNotFound},
		{
			name:      "administrator has global access",
			user:      &models.User{Role: models.RoleAdmin},
			mailboxID: "mailbox-a",
		},
		{
			name:      "agent has mailbox access",
			user:      &models.User{Role: models.RoleAgent, Mailboxes: []string{"mailbox-a", "mailbox-b"}},
			mailboxID: "mailbox-b",
		},
		{
			name:      "agent lacks mailbox access",
			user:      &models.User{Role: models.RoleAgent, Mailboxes: []string{"mailbox-a"}},
			mailboxID: "mailbox-b",
			wantErr:   errOwnerMailboxAccess,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := validateTicketOwner(tt.user, tt.mailboxID)
			if !errors.Is(err, tt.wantErr) {
				t.Fatalf("validateTicketOwner() error = %v, want %v", err, tt.wantErr)
			}
		})
	}
}

func TestOwnerAssignmentUpdate(t *testing.T) {
	now := time.Date(2026, time.September, 9, 19, 0, 0, 0, time.UTC)
	want := mongo.Pipeline{
		bson.D{{Key: "$set", Value: bson.D{
			{Key: "owner_id", Value: "user-id"},
			{Key: "updated_at", Value: now},
			{Key: "status", Value: bson.D{{Key: "$cond", Value: bson.A{
				bson.D{{Key: "$eq", Value: bson.A{"$status", models.TicketStatusUnassigned}}},
				models.TicketStatusActive,
				"$status",
			}}}},
		}}},
	}
	if got := ownerAssignmentUpdate("user-id", now); !reflect.DeepEqual(got, want) {
		t.Fatalf("ownerAssignmentUpdate() = %#v, want %#v", got, want)
	}
}

func TestRemoveProtectedTicketUpdates(t *testing.T) {
	updates := map[string]any{
		"owner_id": "attacker-selected-owner",
		"subject":  "Allowed subject",
	}
	removeProtectedTicketUpdates(updates)
	if _, ok := updates["owner_id"]; ok {
		t.Fatal("owner_id was not removed from generic ticket updates")
	}
	if updates["subject"] != "Allowed subject" {
		t.Fatalf("subject = %v, want Allowed subject", updates["subject"])
	}
}
