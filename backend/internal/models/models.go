package models

import (
	"time"
)

type TicketStatus string

const (
	TicketStatusUnassigned TicketStatus = "unassigned"
	TicketStatusActive     TicketStatus = "active"
	TicketStatusWaiting    TicketStatus = "waiting"
	TicketStatusClosed     TicketStatus = "closed"
)

type TicketPriority string

const (
	PriorityLow    TicketPriority = "low"
	PriorityNormal TicketPriority = "normal"
	PriorityHigh   TicketPriority = "high"
	PriorityUrgent TicketPriority = "urgent"
)

type UserRole string

const (
	RoleAdmin UserRole = "admin"
	RoleAgent UserRole = "agent"
)

type Requester struct {
	Name  string `bson:"name" json:"name"`
	Email string `bson:"email" json:"email"`
}

type MessageAttachment struct {
	Filename    string `bson:"filename" json:"filename"`
	ContentType string `bson:"content_type" json:"content_type"`
	Size        int    `bson:"size" json:"size"`
	Data        []byte `bson:"data" json:"-"`
}

type Message struct {
	MessageID   string              `bson:"message_id,omitempty" json:"message_id,omitempty"`
	From        string              `bson:"from" json:"from"`
	To          []string            `bson:"to,omitempty" json:"to,omitempty"`
	Subject     string              `bson:"subject,omitempty" json:"subject,omitempty"`
	Cc          []string            `bson:"cc,omitempty" json:"cc,omitempty"`
	Body        string              `bson:"body" json:"body"`
	HTML        string              `bson:"html,omitempty" json:"html,omitempty"`
	RawEmail    []byte              `bson:"raw_email,omitempty" json:"-"`
	Attachments []MessageAttachment `bson:"attachments,omitempty" json:"attachments,omitempty"`
	SendError   string              `bson:"send_error,omitempty" json:"send_error,omitempty"`
	CreatedAt   time.Time           `bson:"created_at" json:"created_at"`
}

type Ticket struct {
	ID            string         `bson:"_id,omitempty" json:"id"`
	Number        int            `bson:"number" json:"number"`
	Subject       string         `bson:"subject" json:"subject"`
	Status        TicketStatus   `bson:"status" json:"status"`
	Priority      TicketPriority `bson:"priority" json:"priority"`
	AssigneeID    string         `bson:"assignee_id,omitempty" json:"assignee_id,omitempty"`
	OwnerID       string         `bson:"owner_id,omitempty" json:"owner_id,omitempty"`
	Requester     Requester      `bson:"requester" json:"requester"`
	Messages      []Message      `bson:"messages" json:"messages"`
	Tags          []string       `bson:"tags,omitempty" json:"tags,omitempty"`
	EmailThreadID string         `bson:"email_thread_id,omitempty" json:"email_thread_id,omitempty"`
	ThreadTopic   string         `bson:"thread_topic,omitempty" json:"thread_topic,omitempty"`
	Unread        bool           `bson:"unread" json:"unread"`
	CreatedAt     time.Time      `bson:"created_at" json:"created_at"`
	UpdatedAt     time.Time      `bson:"updated_at" json:"updated_at"`
}

type User struct {
	ID           string    `bson:"_id,omitempty" json:"id"`
	Name         string    `bson:"name" json:"name"`
	Email        string    `bson:"email" json:"email"`
	Role         UserRole  `bson:"role" json:"role"`
	PasswordHash string    `bson:"password_hash" json:"-"`
	CreatedAt    time.Time `bson:"created_at" json:"created_at"`
}

type Attachment struct {
	ID          string    `bson:"_id,omitempty" json:"id"`
	TicketID    string    `bson:"ticket_id" json:"ticket_id"`
	Filename    string    `bson:"filename" json:"filename"`
	ContentType string    `bson:"content_type" json:"content_type"`
	Size        int64     `bson:"size" json:"size"`
	StoragePath string    `bson:"storage_path" json:"-"`
	CreatedAt   time.Time `bson:"created_at" json:"created_at"`
}

type EmailSettings struct {
	IMAPHost            string `bson:"imap_host" json:"imap_host"`
	IMAPPort            int    `bson:"imap_port" json:"imap_port"`
	IMAPTLS             bool   `bson:"imap_tls" json:"imap_tls"`
	IMAPUser            string `bson:"imap_user" json:"imap_user"`
	IMAPPassword        string `bson:"imap_password" json:"imap_password"`
	IMAPMailbox         string `bson:"imap_mailbox" json:"imap_mailbox"`
	SentMailbox         string `bson:"sent_mailbox,omitempty" json:"sent_mailbox,omitempty"`
	SMTPHost            string `bson:"smtp_host" json:"smtp_host"`
	SMTPPort            int    `bson:"smtp_port" json:"smtp_port"`
	SMTPTLS             bool   `bson:"smtp_tls" json:"smtp_tls"`
	SMTPUser            string `bson:"smtp_user" json:"smtp_user"`
	SMTPPassword        string `bson:"smtp_password" json:"smtp_password"`
	SMTPFrom            string `bson:"smtp_from" json:"smtp_from"`
	DeletedMailbox      string `bson:"deleted_mailbox,omitempty" json:"deleted_mailbox,omitempty"`
	PollIntervalSeconds int    `bson:"poll_interval_seconds" json:"poll_interval_seconds"`
}

type LLMSettings struct {
	Endpoint string `bson:"endpoint" json:"endpoint"`
	APIKey   string `bson:"api_key" json:"api_key"`
	Model    string `bson:"model" json:"model"`
	Enabled  bool   `bson:"enabled" json:"enabled"`
}

type AuthSettings struct {
	OIDCIssuer        string            `bson:"oidc_issuer,omitempty" json:"oidc_issuer,omitempty"`
	OIDCClientID      string            `bson:"oidc_client_id,omitempty" json:"oidc_client_id,omitempty"`
	OIDCClientSecret  string            `bson:"oidc_client_secret,omitempty" json:"oidc_client_secret,omitempty"`
	GroupRoleMappings map[string]string `bson:"group_role_mappings,omitempty" json:"group_role_mappings,omitempty"`
}

type Settings struct {
	ID            string        `bson:"_id" json:"id"`
	Email         EmailSettings `bson:"email" json:"email"`
	LLM           LLMSettings   `bson:"llm" json:"llm"`
	Auth          AuthSettings  `bson:"auth" json:"auth"`
	Signature     string        `bson:"signature,omitempty" json:"signature,omitempty"`
	LastFetchedAt *time.Time    `bson:"last_fetched_at,omitempty" json:"last_fetched_at,omitempty"`
	UpdatedAt     time.Time     `bson:"updated_at" json:"updated_at"`
}
