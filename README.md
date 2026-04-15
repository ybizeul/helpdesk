# Helpdesk

Email-integrated ticketing system with AI agent capabilities.

## Overview

A helpdesk platform that converts incoming emails into support tickets, enables agent workflows, and provides a modern web interface for ticket management.

## Tech Stack

| Layer     | Technology          |
|-----------|---------------------|
| Backend   | Go (API-first)      |
| Frontend  | Vite + React + Mantine |
| Database  | MongoDB             |
| Email     | IMAP/SMTP integration |

## Project Structure

```
helpdesk/
├── docs/               # Project documentation
│   ├── architecture.md # System architecture & component overview
│   ├── api.md          # API design & endpoint reference
│   └── data-model.md   # MongoDB collections & schemas
├── backend/            # Go API server
│   ├── cmd/            # Entry points
│   ├── internal/       # Application logic
│   │   ├── api/        # HTTP handlers & routes
│   │   ├── email/      # Email ingestion & sending
│   │   ├── ticket/     # Ticket domain logic
│   │   └── store/      # MongoDB data access
│   └── go.mod
├── frontend/           # React SPA
│   ├── src/
│   │   ├── components/ # Mantine UI components
│   │   ├── pages/      # Route pages
│   │   ├── api/        # API client
│   │   └── App.tsx
│   ├── index.html
│   └── package.json
└── README.md
```

## Getting Started

### Requirements

- Up to date Go
- Docker for running MongoDB
- mise (https://mise.jdx.dev) for tasks execution
- VScode recommended for debug and tasks run

Local development environment will use a `./local` directory where data is
persisted, `.env` files, MongoDB data directory, ...

### Running the local environment

`mise front` runs the vite frontend with automatic reload to work with frontend
development

`mise database` runs the mongodb containers with persistence in the `/local/db`
directory

`mise server` runs the go backend with a dependency on database

You will also find VScode launch settings to debug frontend and server

## License

MIT
