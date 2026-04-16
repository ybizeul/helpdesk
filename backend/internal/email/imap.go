package email

import (
	"context"
	"fmt"
	"sort"

	"github.com/emersion/go-imap/v2"
	"github.com/helpdesk/backend/internal/models"
)

type Mailbox struct {
	Name      string `json:"name"`
	Delimiter string `json:"delimiter"`
}

func ListMailboxes(cfg models.EmailSettings) ([]Mailbox, error) {
	var flat []Mailbox
	err := withIMAPRetry(context.Background(), func() error {
		c, err := connect(cfg)
		if err != nil {
			return err
		}
		defer c.Close()

		if err := c.Login(cfg.IMAPUser, cfg.IMAPPassword).Wait(); err != nil {
			return fmt.Errorf("imap login: %w", err)
		}

		listCmd := c.List("", "*", nil)
		var local []Mailbox
		for {
			mbox := listCmd.Next()
			if mbox == nil {
				break
			}
			delim := "/"
			if mbox.Delim != 0 {
				delim = string(mbox.Delim)
			}
			if !hasAttr(mbox.Attrs, imap.MailboxAttrNoSelect) {
				local = append(local, Mailbox{
					Name:      mbox.Mailbox,
					Delimiter: delim,
				})
			}
		}
		if err := listCmd.Close(); err != nil {
			return fmt.Errorf("imap list: %w", err)
		}

		flat = local
		return nil
	})
	if err != nil {
		return nil, err
	}

	sort.Slice(flat, func(i, j int) bool { return flat[i].Name < flat[j].Name })
	return flat, nil
}

func hasAttr(attrs []imap.MailboxAttr, target imap.MailboxAttr) bool {
	for _, a := range attrs {
		if a == target {
			return true
		}
	}
	return false
}
