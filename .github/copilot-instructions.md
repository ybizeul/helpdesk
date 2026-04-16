# Copilot Instructions

## Dev Commands

All tasks use [mise](https://mise.jdx.dev):

| Task | Command |
|------|---------|
| Start MongoDB | `mise mongo` |
| Start backend | `mise back` (loads `.env` automatically) |
| Start frontend dev server | `mise front` |
| Start both | `mise dev` |
| Build frontend into Go embed | `mise build-frontend` |
| Release snapshot | `mise release-snapshot` |

Frontend-only commands (from `frontend/`):
```sh
npm run dev       # Vite dev server
npm run build     # TypeScript check + Vite production build
npm run lint      # ESLint
```

Backend-only (from `backend/`):
```sh
go build ./...
go vet ./...
# No test suite exists yet
```

## Architecture

The Go backend serves **both** the REST API and the embedded React SPA from a single binary. At build time, `mise build-frontend` compiles the frontend and moves the output to `backend/cmd/helpdesk/dist/`, which is embedded via `//go:embed` in `frontend.go`. In development, Vite proxies `/api/` requests to the backend on `:8080`.

```
browser → :5173 (Vite dev) → proxies /api/* → :8080 (Go)
browser → :8080 (production) → /api/* handled by Go router, everything else served as embedded SPA
```

**Backend layers:**
- `cmd/helpdesk/` — entry point; wires MongoDB, starts HTTP server and background email poller goroutine
- `internal/api/` — HTTP handlers using stdlib `net/http` only (no framework); route registration in `router.go`
- `internal/store/` — all MongoDB operations as methods on `*store.DB`; no repository interfaces
- `internal/models/` — shared domain types with `bson` + `json` struct tags
- `internal/email/` — IMAP fetch and SMTP send; called both from background poller and via API endpoints

## Email Ingestion

The background poller (`pollEmails` in `main.go`) runs on a configurable interval stored in `settings.email.poll_interval_seconds` (defaults to 60 s). It fetches from IMAP using a compound search: emails received since the last successful fetch **OR** any unseen message. After each run, `settings.last_fetched_at` is updated.

**Ticket deduplication / thread matching** — when an email arrives, `fetchEmailsOnce` tries to append it to an existing ticket using these checks in order:

1. **Message-ID dedup** — skips the message entirely if `messages.message_id` already exists in any ticket.
2. **`In-Reply-To` + `References` headers** — looks for any ticket whose `email_thread_id` or any `messages.message_id` appears in the union of those header values.
3. **`Thread-Topic` header** — matches a ticket by the `thread_topic` field (set from the `Thread-Topic` MIME header, common in Outlook threads).
4. **Subject `Re:`/`Fwd:` stripping** — strips reply/forward prefixes from the subject and matches against the original ticket subject + requester email.
5. **`[#1234]` in subject** — if the subject contains a ticket number in that format and a ticket with that number exists, the email is appended to it; otherwise the number is claimed for the new ticket and the counter is advanced to avoid future collisions.

If none of the above match, a new ticket is created with `email_thread_id` set to the incoming `Message-ID`. Processed messages are marked `\Seen` on IMAP after import.

When a reply is appended, the ticket status resets to `unassigned` (or `active` if already owned) and `unread` is set to `true`.

## Key Conventions

### Backend

**Routing** uses Go 1.22+ method-pattern syntax directly on `http.ServeMux`:
```go
mux.HandleFunc("GET /api/v1/tickets", h.listTickets)
mux.HandleFunc("POST /api/v1/tickets/{id}/reply", h.replyTicket)
```

**Error responses** always use `writeError`:
```go
writeError(w, http.StatusBadRequest, "SNAKE_CASE_CODE", "human message")
// → {"error": {"code": "...", "message": "..."}}
```

**Success responses** use `writeJSON`:
```go
writeJSON(w, http.StatusOK, payload)
writeJSON(w, http.StatusCreated, created)
w.WriteHeader(http.StatusNoContent) // for 204s
```

**Auth** — JWT is custom-implemented (HS256, no external JWT library). The middleware injects `*jwtClaims` into context under `claimsKey`. Use `requireAdmin(r)` to gate admin-only actions. Auth is skipped for login and OIDC/passkey login endpoints. Token can also be passed as `?token=` query param (used for attachment downloads).

**MongoDB** is connected with `ObjectIDAsHexString: true`, so ObjectIDs are hex strings throughout. Convert with `bson.ObjectIDFromHex(id)` before queries. IDs in models are `string` with `bson:"_id,omitempty"`.

**Ticket statuses** (in code/DB): `unassigned`, `active`, `waiting`, `closed`. Note: `data-model.md` still says `open` but it was migrated to `active` — the migration runs on every startup.

**Environment** — config comes from env vars: `MONGO_URI`, `MONGO_DB`, `LISTEN_ADDR`, `JWT_SECRET`, `INIT_PASSWORD`. The `mise back` task loads `.env` via `set -a && source ../.env && set +a`.

### Frontend

**All API calls** go through the typed `api` object in `src/api/client.ts`. Add new endpoints there rather than calling `fetch` directly in components.

**UI components** use [Mantine v9](https://mantine.dev) (`@mantine/core`, `@mantine/hooks`, `@mantine/notifications`). Icons come from `@tabler/icons-react`. Rich text editing uses Tiptap via `@mantine/tiptap`.

**Routing** uses React Router v7. Pages live in `src/pages/`, shared components in `src/components/`.

**Auth token** is stored in `localStorage` under `"token"` and injected into every request as `Authorization: Bearer <token>`. A 401 response triggers a page reload to force re-login.
