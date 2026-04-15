# Data Model

MongoDB collections and their document schemas.

## Collections

### `tickets`

```json
{
  "_id": "ObjectId",
  "subject": "string",
  "status": "open | pending | resolved | closed",
  "priority": "low | normal | high | urgent",
  "assignee_id": "ObjectId | null",
  "requester": {
    "name": "string",
    "email": "string"
  },
  "messages": [
    {
      "from": "string",
      "body": "string",
      "html": "string | null",
      "attachments": ["ObjectId"],
      "created_at": "datetime"
    }
  ],
  "tags": ["string"],
  "email_thread_id": "string",
  "created_at": "datetime",
  "updated_at": "datetime"
}
```

### `users`

```json
{
  "_id": "ObjectId",
  "name": "string",
  "email": "string",
  "role": "admin | agent",
  "created_at": "datetime"
}
```

### `attachments`

```json
{
  "_id": "ObjectId",
  "ticket_id": "ObjectId",
  "filename": "string",
  "content_type": "string",
  "size": "int",
  "storage_path": "string",
  "created_at": "datetime"
}
```

### `settings`

```json
{
  "_id": "string",
  "email": {
    "imap_host": "string",
    "imap_port": "int",
    "imap_tls": "bool",
    "imap_user": "string",
    "imap_password": "string",
    "smtp_host": "string",
    "smtp_port": "int",
    "smtp_tls": "bool",
    "smtp_user": "string",
    "smtp_password": "string",
    "poll_interval_seconds": "int"
  },
  "llm": {
    "endpoint": "string",
    "api_key": "string",
    "model": "string",
    "enabled": "bool"
  },
  "auth": {
    "oidc_issuer": "string | null",
    "oidc_client_id": "string | null",
    "oidc_client_secret": "string | null",
    "group_role_mappings": "object | null"
  },
  "updated_at": "datetime"
}
```

## Indexes

| Collection   | Index                        | Purpose                   |
|-------------|------------------------------|---------------------------|
| tickets     | `{ status: 1, updated_at: -1 }` | Filter & sort by status  |
| tickets     | `{ assignee_id: 1 }`         | Agent workload queries    |
| tickets     | `{ email_thread_id: 1 }`     | Email thread lookup       |
| tickets     | `{ "requester.email": 1 }`   | Requester history         |
| users       | `{ email: 1 }` (unique)      | Login / lookup            |
| attachments | `{ ticket_id: 1 }`           | Fetch ticket attachments  |
