package email

import (
	"context"
	"errors"
	"io"
	"net"
	"strings"
	"time"
)

const (
	imapRetryAttempts = 3
	imapRetryBaseWait = 500 * time.Millisecond
)

func withIMAPRetry(ctx context.Context, fn func() error) error {
	if ctx == nil {
		ctx = context.Background()
	}

	var lastErr error
	for attempt := 1; attempt <= imapRetryAttempts; attempt++ {
		err := fn()
		if err == nil {
			return nil
		}
		lastErr = err

		if !isRetryableIMAPError(err) || attempt == imapRetryAttempts || ctx.Err() != nil {
			return lastErr
		}

		wait := imapRetryBaseWait * time.Duration(1<<(attempt-1))
		timer := time.NewTimer(wait)
		select {
		case <-ctx.Done():
			timer.Stop()
			return lastErr
		case <-timer.C:
		}
	}

	return lastErr
}

func isRetryableIMAPError(err error) bool {
	if err == nil {
		return false
	}

	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return false
	}

	if errors.Is(err, io.EOF) || errors.Is(err, io.ErrUnexpectedEOF) {
		return true
	}

	var nerr net.Error
	if errors.As(err, &nerr) {
		if nerr.Timeout() {
			return true
		}
	}

	msg := strings.ToLower(err.Error())
	if strings.Contains(msg, "authentication") || strings.Contains(msg, "invalid credentials") || strings.Contains(msg, "auth") {
		return false
	}

	for _, token := range []string{
		"timeout",
		"temporar",
		"connection reset",
		"broken pipe",
		"connection refused",
		"server closed",
		"unexpected eof",
		"tls handshake",
		"network is unreachable",
	} {
		if strings.Contains(msg, token) {
			return true
		}
	}

	return false
}
