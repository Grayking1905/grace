# Grace

A calm, independently built project and issue tracking platform. Grace follows the product requirements in `docs/PRD - Grace Jira-Style Project and Issue Tracking Platform.md` and starts the phased product plan with a working local application.

This is an initial development release. It does **not** claim complete Jira parity or production readiness. Deployment and Docker Compose are intentionally deferred.

## Start locally

Requires Node.js 22.13+ (tested with Node.js 24) and npm.

```powershell
npm install
if (!(Test-Path .env)) { Copy-Item .env.example .env }
npm run dev
```

The prepared local `.env` uses web port **5178** and API port **4008**, since port 5173 was occupied during setup. Open **http://127.0.0.1:5178** and choose **Explore the demo workspace**. A fresh copy of `.env.example` uses web port 5173 and API port 4000. The Vite terminal output gives the active URL.

The sample workspace has three projects, a team, sprint history, 28 starter issues, pages, and standup entries. Your interactions persist to disk. Registering a new account creates a separate empty workspace. Team administrators can create email-bound invitation links from **Team → Invite member**; invited people can register or sign in and join that workspace. Invitations are shared manually; no email is sent.

Demo login uses `alex@grace.local` / `GraceDemo2026!`. All seeded accounts share this development-only password. Turn off both `SEED_DEMO` and `DEMO_MODE` when starting an empty instance. Never use sample credentials for a real team.

## SQL database

MySQL 8+ is the intended primary service database, following section 9 of the PRD. A separate SQLite adapter makes local development possible without installing a database service. Application data is stored in SQL, not in browser local storage or an in-memory JavaScript store.

SQLite defaults to `data/grace.sqlite`, with foreign keys, WAL journaling, serialized writes, and transactions. Uploaded files live in `data/uploads`; access to each download is checked against workspace and project permissions. Both directories are ignored by Git.

To use MySQL, create a dedicated empty database with a UTF-8 charset and a dedicated application user, then update `.env`:

```dotenv
DB_DRIVER=mysql
DATABASE_URL=mysql://grace:your-password@127.0.0.1:3306/grace
SEED_DEMO=false
DEMO_MODE=false
```

URL-encode special characters in database credentials. Do not commit `.env`. Then run:

```powershell
npm run db:migrate
npm run dev
```

The same application routes use parameterized SQL through `server/db.ts`. The schema and indexes live in `server/schema.ts`. Generate inspectable SQL with `npm run db:schema`; generated files are in `database/mysql/001_initial.sql` and `database/sqlite/001_initial.sql`.

The initial schema creates missing tables and indexes idempotently and records migration version 1. Subsequent schema changes must use new numbered migrations. Switching drivers uses a separate database; it does not migrate existing SQLite records into MySQL. **Live MySQL execution has not been verified in this environment.**

Some earlier PRD paragraphs mention PostgreSQL, its full-text search, and row-level security. Grace follows the explicit MySQL recommendation in section 9. Tenant access is enforced in the server data layer; PostgreSQL RLS is not claimed.

## What works

- Email/password registration and login, bcrypt hashing, short-lived JWT access cookies, single-use rotating refresh tokens, server-side logout, CSRF checks, request validation, and rate limiting.
- Isolated workspaces, workspace roles, private project access checks, email-bound expiring invitations, member role changes, and profiles.
- Projects with unique uppercase keys, names, colors, templates, favorites, and project overviews. Template selection is stored; initial projects share the Simple workflow.
- Issues with atomic project numbering; task, story, bug, epic, and subtask types; parents and children; priorities; assignees; labels; points; sprint assignment; dates; flags; cloning; soft delete and admin restore.
- Sanitized rich text descriptions; inline property changes; explicit description saves; field history; watchers; comments and comment editing; links; file uploads; and work logs.
- Board drag-and-drop with fractional ranking, optimistic reconciliation and rollback, custom columns, WIP warnings, sprint selection, filters, card display controls, and keyboard alternatives through issue properties.
- Planned and active sprints, scope assignment, single active sprint per project, sprint completion, carry-over to a future sprint or backlog, and committed/completed point snapshots.
- Project issue lists, sorting, text filters, CSV/JSON export, keyboard search, and a constrained parsed Grace Query Language with saved private/shared views.
- Socket.IO workspace invalidation followed by permission-checked refetches. Notifications contain assignments, watched comments, and status updates; read state is persistent.
- Date-based issue timelines; workspace activity; current status/workload charts; created/completed activity charts; and completed sprint velocity.
- Pages with a rich text editor, explicit saves, optimistic version checks, previous versions, draft restoration, and HTML download.
- Two-week capacity estimates with an explicitly chosen hours-per-point assumption; daily check-ins; stale issue detection; risks; and an editable downloadable Markdown digest.
- Jira CSV/JSON preview and transactional import of supported fields. Original source keys are included in the description; Grace assigns new immutable keys. Invalid rows prevent confirmation. Re-importing creates new records rather than an upsert.

## Development commands

```powershell
npm run dev          # API + Vite, both on loopback
npm run check        # Strict TypeScript checks
npm test             # React editor/page regressions + API tests with isolated SQL databases
npm run build        # TypeScript + client production build, no deployment
npm run start        # API; also serves dist/ if it exists
npm run db:migrate   # Initialize the configured SQL database
npm run db:schema    # Export initial SQL for review
npm run format      # Format source
```

The network sandbox may require approval for installing dependencies, starting a reachable preview, and running HTTP integration tests. No Docker, hosting account, or external application connector is needed.

## Source layout

- `src/pages/`: workspace, project, collaboration, management, and settings screens.
- `src/components/`: shared controls, dialogs, issue details, and lazily loaded Tiptap editor.
- `src/lib/api.ts`: authenticated API requests, refresh coordination, CSV/JSON exports.
- `shared/types.ts`: shared request/result domain types.
- `server/app.ts`: versioned API routes, scoped authorization, Socket.IO, uploads, and input validation.
- `server/auth.ts`: sessions, cookies, JWTs, and permission helpers.
- `server/db.ts`, `server/schema.ts`: SQL adapters and the initial relational schema.
- `server/gql.ts`: tokenizer, parser, and allowlisted query evaluation. It never evaluates JavaScript or interpolates a query into SQL.
- `tests/`: tenant, authorization, concurrent write, auth, sprint, import, invitation, and document regression coverage.
- `docs/IMPLEMENTATION.md`: delivered scope, remaining PRD work, and current limitations.
- `docs/REFERENCES.md`: feature references and independent implementation policy.

## Boundaries before a real rollout

Email verification, password recovery, OAuth/SSO/MFA, SMTP delivery, fine-grained permission schemes, load testing, full accessibility audit, malware scanning, cloud file storage, integration credentials, and operational backups remain future work. A local instance should stay on loopback while these are developed. Demo authentication is disabled when `NODE_ENV=production`, and production startup requires a `JWT_SECRET` of at least 32 characters. Deployment itself is outside this phase.

The full PRD roadmap, including advanced workflow conditions, historical GQL, automation, integrations, full migration fidelity, portfolio planning, and advanced management tools, is preserved in the implementation document.
