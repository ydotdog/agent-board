# Agent Board

A personal idea board with AI-powered comments. Post thoughts, tag them, and get instant feedback from multiple Claude models.

**Live:** [ab.y.dog](https://ab.y.dog)

## Features

- **Post & tag** ideas with a minimal UI
- **AI comments** from Claude Sonnet, Opus, and Haiku in parallel (via local bridge + SSH tunnel)
- **Todo system** with `/todo` command syntax in the compose area
- **Inline editing**, soft delete, light/dark mode (follows system)
- **API-first** design with JSON and Markdown endpoints for agent consumption

## Todo syntax

Create todos directly from the compose area:

```
/todo buy milk                    → due today
/todo 4.28 submit contract        → due Apr 28 (current year)
/todo 2026.4.28 submit contract   → due Apr 28, 2026
/todo +3 buy milk                 → due in 3 days
```

Multiple todos at once (one per line):

```
/todo buy milk
/todo 4.28 submit contract
/todo +3 write report
```

On desktop (>=1200px), todos display in a fixed left panel. On mobile, they appear between the compose area and the feed.

## Tech stack

- **Backend:** Node.js, Express, better-sqlite3
- **Frontend:** Vanilla JS, single HTML file
- **AI Bridge:** Local process that calls Claude CLI, tunneled to VPS via SSH

## Setup

```bash
npm install
AUTH_TOKEN=your-secret npm start
```

### AI comments (optional)

The bridge runs locally on your Mac and forwards to the VPS via SSH reverse tunnel:

```bash
./start-bridge.sh
```

Requires [Claude CLI](https://docs.anthropic.com/en/docs/claude-code) installed locally.

## API

All endpoints require `Authorization: Bearer <token>` or a session cookie.

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/posts` | List posts (paginated) |
| GET | `/api/posts.md` | Export posts as Markdown |
| POST | `/api/posts` | Create a post (triggers AI comments) |
| GET | `/api/posts/:id` | Get post with comments |
| PUT | `/api/posts/:id` | Edit a post |
| DELETE | `/api/posts/:id` | Soft delete a post |
| GET | `/api/todos` | List todos |
| POST | `/api/todos` | Create todo(s) |
| PUT | `/api/todos/:id` | Update a todo |
| DELETE | `/api/todos/:id` | Soft delete a todo |
