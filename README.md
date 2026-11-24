<div align="center">

<img src="public/grace.svg" width="68" height="68" alt="Grace Logo" />

# Grace

### The Calm, Powerful Work Management & Team Intelligence Platform

*A modern, unified operating system for high-performing engineering, product, and operations teams to plan, build, and deliver exceptional work with clarity and velocity.*

---

[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D22.13-brightgreen.svg?style=flat-square&logo=node.js)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue.svg?style=flat-square&logo=typescript)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19-61dafb.svg?style=flat-square&logo=react)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-7-purple.svg?style=flat-square&logo=vite)](https://vitejs.dev/)
[![MySQL](https://img.shields.io/badge/MySQL-8.4-orange.svg?style=flat-square&logo=mysql)](https://www.mysql.com/)
[![License](https://img.shields.io/badge/license-Private-red.svg?style=flat-square)](#)

</div>

<br />

## Overview

**Grace** is an independently crafted, full-stack work management platform designed from the ground up to eliminate clutter, reduce cognitive overhead, and bring flow back to team collaboration. 

Instead of juggling disconnected issue boards, fragmented documentation, and opaque analytics, Grace unifies agile planning, specification documents, team operating dashboards, administrative insights, and testing sandboxes into one fast, reactive, and responsive workspace.

---

## ✨ Key Features

### 🚀 1. Agile Project Execution
- **Scrum & Kanban Workflows**: Interactive drag-and-drop boards powered by fractional ranking, real-time optimistic updates, and WIP (Work in Progress) limits.
- **Sprint Management**: Plan iterations, manage commitments, track velocity snapshots, and handle sprint carry-overs with atomic rollbacks.
- **Hierarchical Work Breakdown**: Full support for Epics, Stories, Tasks, Bugs, and Subtasks with parent-child relationships, story points, due dates, flags, and custom issue types.
- **Backlog & Prioritization**: Efficient backlog grooming with keyboard navigation (`G then B` for Board, `G then K` for Backlog) and customizable filters.

### 🧭 2. Unified "My Work" Command Center
- **Cross-Project Aggregation**: Consolidated view of everything assigned to you or created by you across all projects and teams.
- **Attention & Deadline Intelligence**: Automatic identification of overdue deliverables, high-priority blockers, and tasks due today.
- **Daily Standup Briefs**: Auto-generated, formatted standup notes detailing recent accomplishments and active focus, ready to copy with one click.
- **Quick-Add Actions**: Instantly capture daily tasks and work items without leaving your flow.

### 📊 3. Admin Insights & Organizational Intelligence
- **Adoption & Usage Metrics**: Monitor active members, 30-day adoption trends, total activity, and project health in real time.
- **App & Feature Adoption**: Visual breakdown of which capabilities (Boards, Backlogs, Sprints, Documents, Views) drive the most team value.
- **Data-Driven Access Management**: Identify inactive accounts and idle members to optimize workspace licensing and access.
- **Security Posture Evaluation**: Evaluate organizational safety based on two-step verification adoption with visual risk scoring and per-member status audits.

### 🧪 4. Isolated Sandbox Environments
- **Zero Production Risk**: Spin up isolated copies of your workspace to test integrations, schema updates, or configuration changes safely.
- **Instant Environments**: Create, sync, experiment with, and delete sandbox instances without impacting active production data.
- **App Update Testing**: Validate new tools and workflows in an isolated testbed before deploying them across your organization.

### 📝 5. Native Collaborative Docs & BRDs
- **Rich Document Editor**: Tiptap-powered rich text editing with live formatting, callouts, tables, checklists, and code blocks.
- **Business Requirement Documents (BRDs)**: Formally define product specifications, assign owners, track review states, and link directly to delivery issues.
- **Version History & Restore**: Track document revisions with optimistic concurrency control, draft restoration, and clean HTML/Markdown exports.

### 🔍 6. Grace Query Language (GQL)
- **Structured Search Engine**: AST-tokenized, type-safe query parser that evaluates complex queries securely without raw SQL interpolation.
- **Saved & Shared Views**: Create custom multi-project views and share tailored filtered perspectives across teams.
- **Global Quick Search**: Instant keyboard-driven command palette (`Ctrl/⌘ + K` or `/`) to navigate issues, documents, and projects instantly.

### 🏢 7. Multi-Tenant Enterprise Architecture
- **Flexible Workspaces**: Isolate departments, client engagements, or distinct business units under separate workspaces with one unified account.
- **Team Operating System**: Dedicated team-level dashboards, customizable section visibility, and employee directory management with employee ID binding.
- **Role-Based Access Control (RBAC)**: Fine-grained permissions (Owner, Admin, Member, Viewer) with per-project privacy controls.

### ⚡ 8. Real-Time Collaboration Engine
- **Live Synchronization**: Built on Socket.IO for sub-second workspace cache invalidation and live updates across open browser tabs.
- **Team Presence & Notifications**: Real-time notifications for mentions, assignments, status transitions, and issue watches.

---

## 🏗️ Architecture & Tech Stack

Grace is engineered for performance, reliability, and deterministic data integrity:

```
┌────────────────────────────────────────────────────────┐
│                      Client Layer                      │
│     React 19 · TypeScript · Vite · TanStack Query      │
│     Recharts · Tiptap · Lucide Icons · @dnd-kit        │
└───────────────────────────▲────────────────────────────┘
                            │ REST APIs + WebSockets (Socket.IO)
┌───────────────────────────▼────────────────────────────┐
│                      Server Layer                      │
│    Express 5 · Node.js 24 · Zod Validation · Helmet    │
│    JWT Auth (HttpOnly Cookies) · Rate Limiting · CSRF   │
└───────────────────────────▲────────────────────────────┘
                            │ Parameterized Relational Queries
┌───────────────────────────▼────────────────────────────┐
│                     Database Layer                     │
│    MySQL 8+ (Production)  /  SQLite 3 (Development)    │
│    Relational Schema · Full-Text Indexes · Backups     │
└────────────────────────────────────────────────────────┘
```

- **Frontend**: React 19, TypeScript 5.9, Vite 7, TanStack React Query v5, Recharts, Tiptap editor, `@dnd-kit` for accessible drag-and-drop.
- **Backend**: Express 5 on Node.js 22.13+ (Node 24 recommended), TypeScript with strict mode, Zod input validation, Socket.IO.
- **Security**: Strict CSRF tokens, secure HttpOnly cookie sessions, rotating refresh tokens, bcrypt password hashing, and rate limiting.
- **Data Layer**: Dual database support:
  - **MySQL 8+**: High-concurrency production database with InnoDB, foreign keys, and full-text search.
  - **SQLite 3**: Zero-dependency local development with WAL mode and transactions.

---

## 🏁 Quickstart

### Prerequisites

- **Node.js**: `>= 22.13.0` (Recommended: Node.js 24)
- **npm**: `>= 10.0.0`

### 1. Clone & Install Dependencies

```bash
git clone https://github.com/Grayking1905/grace.git
cd grace
npm install
```

### 2. Configure Environment

Copy the example configuration to initialize your local `.env`:

```bash
# On Windows (PowerShell)
if (!(Test-Path .env)) { Copy-Item .env.example .env }

# On macOS / Linux
cp -n .env.example .env
```

### 3. Start the Development Server

```bash
npm run dev
```

This concurrently launches:
- **API Server**: `http://127.0.0.1:4000` (or your configured `PORT`)
- **Web Application**: `http://127.0.0.1:5173` (or your configured `WEB_PORT`)

Open your browser at the displayed URL and click **Explore the demo workspace** to preview Grace with preloaded sample projects, sprint history, and team data.

---

## 💾 Database Configuration

Grace uses a unified, parameterized schema adapter (`server/db.ts`) that guarantees identical behavior across both SQLite and MySQL.

### Using SQLite (Default for Local Development)

No database installation required. SQLite automatically creates and manages its database file in `data/grace.sqlite` with WAL mode enabled.

### Using MySQL 8+ (Recommended for Production)

1. Provision an empty MySQL 8 database with UTF-8 character encoding:
   ```sql
   CREATE DATABASE grace_prod CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
   ```

2. Update your `.env` configuration:
   ```dotenv
   DB_DRIVER=mysql
   DATABASE_URL=mysql://username:password@127.0.0.1:3306/grace_prod
   SEED_DEMO=false
   DEMO_MODE=false
   ```

3. Run migrations and start:
   ```bash
   npm run db:migrate
   npm run dev
   ```

---

## 🛠️ Development Scripts

| Command | Description |
|---|---|
| `npm run dev` | Runs both the Express API and the Vite frontend with hot reload |
| `npm run dev:api` | Starts the Express server in watch mode using `tsx` |
| `npm run dev:web` | Starts the Vite development server |
| `npm run check` | Executes strict TypeScript compilation verification (`tsc -b`) |
| `npm test` | Runs the full Vitest suite (unit, component, and API integration tests) |
| `npm run test:mysql` | Executes MySQL 8 integration suite against a dedicated database |
| `npm run build` | Compiles TypeScript and creates optimized production assets in `dist/` |
| `npm start` | Launches the production server serving both the API and client bundle |
| `npm run db:migrate` | Applies relational schema migrations idempotently |
| `npm run db:schema` | Exports canonical SQL definitions to `database/` |
| `npm run db:backup` | Generates an encrypted backup of the workspace data |
| `npm run format` | Formats all code with Prettier |

---

## 📁 Repository Layout

```
grace/
├── database/              # Canonical, exportable MySQL and SQLite SQL schemas
├── docs/                  # Architectural documentation, setup guides, and references
├── server/
│   ├── features/          # Modular feature endpoints (planning, organization, insights, sandboxes, etc.)
│   ├── app.ts             # Express application assembly, middleware, and route registration
│   ├── auth.ts            # Authentication, sessions, cookies, JWT, and permission guards
│   ├── db.ts              # Unified SQL database client supporting SQLite & MySQL 8
│   ├── gql.ts             # Grace Query Language AST tokenizer and parser
│   └── schema.ts          # Relational table specifications and foreign key definitions
├── shared/                # Universal TypeScript types and models shared between client & server
├── src/
│   ├── components/        # Reusable UI controls, modal dialogs, and editors
│   ├── pages/             # Core views (MyWork, Project, AdminInsights, Sandbox, etc.)
│   ├── lib/               # Client-side API client, WebSocket hooks, and state utilities
│   ├── App.tsx            # Main application routing and Shell container
│   └── main.tsx           # React DOM root initialization and global styles
└── tests/                 # Comprehensive integration test suites
```

---

## 🔒 Security & Data Integrity

- **Strict Tenant Isolation**: Every database query is strictly scoped by workspace and user permissions in the server layer.
- **Stateless & State-Safe Auth**: Short-lived access JWTs paired with cryptographic refresh tokens stored in secure, `HttpOnly`, `SameSite` cookies.
- **CSRF Defense**: Non-safe HTTP verbs require dedicated verification headers alongside origin validation.
- **Zero-Injection Query Engine**: GQL safely tokenizes expressions through an AST parser without executing raw strings or injecting arbitrary SQL.
- **Encrypted Workspace Backups**: Automated database exports encrypted with AES-256 for disaster recovery and safe migration.

---

## 📄 License

This repository and its codebase are private and proprietary. All rights reserved.
