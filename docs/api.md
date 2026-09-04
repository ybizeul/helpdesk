# API Design

Base path: `/api/v1`

## Conventions

- JSON request/response bodies.
- Standard HTTP status codes (200, 201, 400, 404, 500).
- Pagination via `?page=1&limit=25` query params.
- Authentication: Internal user database or OIDC.

## Authentication

On initial startup, a default `admin` user is created with a password clearly
indicated in startup logs, password is never showed again, but can be reset if
server sees `INIT_PASSWORD`environment variable defined.

If logged in as admin, or part of the administrator role, you can configure
authentication settings in Web UI. There is an area to CRUD local users, and
an area to configure OIDC and map groups to roles.

## Endpoints

### Tickets

| Method | Path                   | Description               |
|--------|------------------------|---------------------------|
| GET    | /tickets               | List tickets (filterable; `q` for search) |
| POST   | /tickets               | Create a ticket           |
| GET    | /tickets/:id           | Get ticket by ID          |
| PUT    | /tickets/:id           | Update ticket             |
| DELETE | /tickets/:id           | Delete ticket             |
| POST   | /tickets/:id/reply     | Reply to a ticket         |
| PUT    | /tickets/:id/assign    | Assign ticket to agent    |
| PUT    | /tickets/:id/status    | Change ticket status      |

Query params for `GET /tickets`:

| Param | Description |
|-------|-------------|
| `mailbox_id` | Restrict to one mailbox. Agents may only use a mailbox they can access. |
| `status` | Exact status (`unassigned`, `active`, `waiting`, `closed`, `parked`). |
| `include_closed=1` | Include closed and parked when `status` is omitted. |
| `assignee_id` | Filter by assignee. |
| `q` | Search subject, requester, tags, and message bodies (phrase match). Ticket `#1234` / `1234` matches by number only; values containing `@` match requester email. When `q` is set and `status` is omitted, closed and parked tickets are included. Results are capped at 50. |

### Users / Agents

| Method | Path                   | Description               |
|--------|------------------------|---------------------------|
| GET    | /users                 | List users                |
| POST   | /users                 | Create user               |
| GET    | /users/:id             | Get user                  |
| PUT    | /users/:id             | Update user               || DELETE | /users/:id             | Delete user               |
### Email

| Method | Path                   | Description               |
|--------|------------------------|---------------------------|
| GET    | /email/status          | IMAP polling status       |

### Settings

| Method | Path                   | Description               |
|--------|------------------------|---------------------------|
| GET    | /settings              | Get all settings          |
| PUT    | /settings/email        | Update IMAP/SMTP config   |
| PUT    | /settings/llm          | Update LLM endpoint config|
| PUT    | /settings/auth         | Update auth/OIDC config   |

### Dashboard

| Method | Path                   | Description               |
|--------|------------------------|---------------------------|
| GET    | /stats                 | Ticket counts & metrics   |

## Error Format

```json
{
  "error": {
    "code": "TICKET_NOT_FOUND",
    "message": "Ticket with ID abc123 not found"
  }
}
```
