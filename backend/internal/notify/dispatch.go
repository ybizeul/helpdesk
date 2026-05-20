package notify

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/helpdesk/backend/internal/email"
	"github.com/helpdesk/backend/internal/models"
	"github.com/helpdesk/backend/internal/store"
	"go.mongodb.org/mongo-driver/v2/bson"
)

func SendUserNotifications(db *store.DB, mb models.Mailbox, result *email.FetchResult) {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	var s models.Settings
	if err := db.Settings().FindOne(ctx, bson.M{"_id": "global"}).Decode(&s); err != nil {
		slog.Error("notifications: failed to load settings", "error", err)
	}

	filter := bson.M{"$or": bson.A{
		bson.M{"pushover_key": bson.M{"$ne": ""}},
		bson.M{"email_notify_new_cases": true},
		bson.M{"email_notify_reply_to_my_cases": true},
		bson.M{"email_notify_any_email": true},
	}}
	cur, err := db.Users().Find(ctx, filter)
	if err != nil {
		slog.Error("notifications: failed to query users", "error", err)
		return
	}
	defer cur.Close(ctx)

	var users []models.User
	if err := cur.All(ctx, &users); err != nil {
		slog.Error("notifications: failed to decode users", "error", err)
		return
	}

	if len(result.Events) == 0 || len(users) == 0 {
		slog.Info("notifications: no candidates", "mailbox", mb.Name, "events", len(result.Events), "users", len(users))
		return
	}

	emailSent := 0
	pushSent := 0
	for _, ev := range result.Events {
		sender := ev.FromName
		if sender == "" {
			sender = ev.FromEmail
		}

		var pushoverText string
		var emailSubject string
		emailText := fmt.Sprintf("Mailbox: %s\nCase: #%d\nSender: %s", mb.Name, ev.Number, ev.FromEmail)
		emailHTML := fmt.Sprintf("<p><strong>Mailbox:</strong> %s</p><p><strong>Case:</strong> #%d</p><p><strong>Sender:</strong> %s</p>", mb.Name, ev.Number, ev.FromEmail)
		if ev.IsNew {
			pushoverText = fmt.Sprintf("New case in %s from %s", mb.Name, sender)
			emailSubject = fmt.Sprintf("[%s] New case #%d open for %s", mb.Name, ev.Number, ev.FromEmail)
		} else {
			pushoverText = fmt.Sprintf("%s replied to case #%d", sender, ev.Number)
			emailSubject = fmt.Sprintf("[%s] New reply on #%d from %s", mb.Name, ev.Number, ev.FromEmail)
		}

		var ticketURL string
		if s.WebsiteURL != "" {
			ticketURL = fmt.Sprintf("%s/#/mailbox/%s/tickets/%s", strings.TrimRight(s.WebsiteURL, "/"), mb.Slug, ev.TicketID)
		}
		if ticketURL != "" {
			emailText += "\nOpen case: " + ticketURL
			emailHTML += fmt.Sprintf("<p><a href=\"%s\">Open case</a></p>", ticketURL)
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

			if s.PushoverAppToken != "" && u.PushoverKey != "" {
				if err := sendPushover(s.PushoverAppToken, u.PushoverKey, pushoverText, ticketURL); err != nil {
					slog.Error("pushover: failed to send", "user", u.Email, "error", err)
				} else {
					pushSent++
				}
			}

			if !shouldSendEmailNotification(u, ev) || u.Email == "" {
				continue
			}

			if err := sendInternalNotificationEmail(mb.Email, u.Email, emailSubject, emailText, emailHTML); err != nil {
				slog.Error("email-notification: failed to send", "user", u.Email, "mailbox", mb.Name, "error", err)
			} else {
				emailSent++
			}
		}
	}

	slog.Info("notifications: dispatch complete", "mailbox", mb.Name, "events", len(result.Events), "email_sent", emailSent, "push_sent", pushSent)
}

func shouldSendEmailNotification(u models.User, ev email.TicketEvent) bool {
	if u.EmailNotifyAnyEmail {
		return true
	}
	if ev.IsNew {
		return u.EmailNotifyNewCases
	}
	if !u.EmailNotifyReplyToMyCases {
		return false
	}
	return u.ID != "" && (u.ID == ev.OwnerID || u.ID == ev.AssigneeID)
}

func sendInternalNotificationEmail(cfg models.EmailSettings, to, subject, textBody, htmlBody string) error {
	if cfg.SMTPHost == "" {
		return fmt.Errorf("SMTP not configured")
	}
	_, _, err := email.SendReply(cfg, to, nil, subject, textBody, htmlBody, email.ReplyHeaders{})
	return err
}

func sendPushover(appToken, userKey, message, ticketURL string) error {
	params := url.Values{
		"token":   {appToken},
		"user":    {userKey},
		"message": {message},
	}
	if ticketURL != "" {
		params.Set("url", ticketURL)
		params.Set("url_title", "Open case")
	}
	resp, err := http.PostForm("https://api.pushover.net/1/messages.json", params)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("pushover API returned status %d", resp.StatusCode)
	}
	return nil
}
