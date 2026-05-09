package hupload

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

type Client struct {
	baseURL string
	apiKey  string
	http    *http.Client
}

type CreateShareRequest struct {
	Validity    int    `json:"validity,omitempty"`
	Exposure    string `json:"exposure,omitempty"`
	Description string `json:"description,omitempty"`
	Message     string `json:"message,omitempty"`
}

type Share struct {
	Name string `json:"name"`
}

type ShareItemInfo struct {
	Size         int64     `json:"Size"`
	DateModified time.Time `json:"DateModified"`
}

type ShareItem struct {
	Path     string        `json:"Path"`
	ItemInfo ShareItemInfo `json:"ItemInfo"`
}

type apiError struct {
	Status  string `json:"status"`
	Message string `json:"message"`
}

func NewClient(baseURL, apiKey string) *Client {
	return &Client{
		baseURL: strings.TrimSuffix(strings.TrimSpace(baseURL), "/"),
		apiKey:  strings.TrimSpace(apiKey),
		http: &http.Client{
			Timeout: 15 * time.Second,
		},
	}
}

func (c *Client) CreateShare(ctx context.Context, req CreateShareRequest) (*Share, error) {
	body, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("marshal create share request: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/api/v1/shares", bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("create create-share request: %w", err)
	}
	httpReq.Header.Set("Authorization", "Bearer "+c.apiKey)
	httpReq.Header.Set("Content-Type", "application/json")

	httpResp, err := c.http.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("create share request failed: %w", err)
	}
	defer httpResp.Body.Close()

	if httpResp.StatusCode < 200 || httpResp.StatusCode >= 300 {
		return nil, decodeAPIError(httpResp)
	}

	var out Share
	if err := json.NewDecoder(httpResp.Body).Decode(&out); err != nil {
		return nil, fmt.Errorf("decode create share response: %w", err)
	}
	if strings.TrimSpace(out.Name) == "" {
		return nil, fmt.Errorf("create share response missing name")
	}

	return &out, nil
}

func (c *Client) ListItems(ctx context.Context, share string) ([]ShareItem, error) {
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+"/api/v1/shares/"+share+"/items", nil)
	if err != nil {
		return nil, fmt.Errorf("create list-items request: %w", err)
	}
	httpReq.Header.Set("Authorization", "Bearer "+c.apiKey)

	httpResp, err := c.http.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("list share items request failed: %w", err)
	}
	defer httpResp.Body.Close()

	if httpResp.StatusCode < 200 || httpResp.StatusCode >= 300 {
		return nil, decodeAPIError(httpResp)
	}

	var out []ShareItem
	if err := json.NewDecoder(httpResp.Body).Decode(&out); err != nil {
		return nil, fmt.Errorf("decode list items response: %w", err)
	}

	return out, nil
}

func decodeAPIError(resp *http.Response) error {
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 32*1024))
	var msg apiError
	if err := json.Unmarshal(raw, &msg); err == nil && strings.TrimSpace(msg.Message) != "" {
		return fmt.Errorf("hupload api %d: %s", resp.StatusCode, strings.TrimSpace(msg.Message))
	}
	if len(raw) == 0 {
		return fmt.Errorf("hupload api %d", resp.StatusCode)
	}
	return fmt.Errorf("hupload api %d: %s", resp.StatusCode, strings.TrimSpace(string(raw)))
}
