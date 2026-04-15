# Architecture

## System Overview

```
┌──────────────┐    ┌──────────────────────────┐    ┌───────────┐
│  Mail Server │◄──►│      Go API Server        │◄──►│  MongoDB  │
│ (IMAP/SMTP)  │    │                           │    │           │
└──────────────┘    │  ┌─────────┐ ┌──────────┐ │    └───────────┘
                    │  │ Email   │ │ Ticket   │ │
                    │  │ Ingestion│ │ Engine   │ │
                    │  └─────────┘ └──────────┘ │
                    └──────────┬───────────────┘
                               │ REST API
                    ┌──────────▼───────────────┐
                    │   React + Mantine SPA     │
                    └──────────────────────────┘
```

## Components

### Backend (Go)

- **API Server** — RESTful HTTP API; all operations exposed as endpoints first.
- **Email Ingestion** — Polls or receives emails via IMAP, parses them, and creates/updates tickets.
- **Email Sending** — Sends replies and notifications via SMTP.
- **Ticket Engine** — Core domain logic: ticket lifecycle, assignment, status transitions.
- **Store Layer** — MongoDB data access through a repository pattern.

### Frontend (React + Mantine)

- SPA consuming the REST API.
- Mantine component library for consistent UI.
- Pages: ticket list, ticket detail, dashboard, settings.

### Database (MongoDB)

- Document-oriented storage for tickets, users, email threads.
- See [data-model.md](data-model.md) for schema details.

## Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| API-first | Frontend and any future integrations share the same contract |
| MongoDB | Flexible schema fits varied email/ticket metadata |
| Email as primary input | Tickets originate from and are replied to via email |

## Deployment

Helpdesk is typically deployed as docker containers, either with docker compose
or kubernetes. Look into `deployment/`directory for deployment examples.
