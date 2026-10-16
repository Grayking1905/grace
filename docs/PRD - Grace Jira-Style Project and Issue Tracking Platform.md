# Grace: Product Requirements Document (PRD)

**Project name:** Grace **Version:** 1.0 Draft | **Date:** 15 October 2026 | **Status:** For review **Product type:** Web application (cloud SaaS and self-hosted)

---

## 1. Executive Summary

Grace is a web-based project and issue tracking platform that replicates the core of Jira: configurable projects, issues, workflows, Scrum and Kanban boards, backlogs and sprints, roadmaps, a powerful query language, reports and integrations. It also borrows proven ideas from five open-source projects (Section 3) so it is faster and simpler than Jira, can be self-hosted, and covers manager needs (capacity, standups, digests) that Jira leaves to add-ons.

**One-line pitch:** A fast, self-hostable, Jira-compatible work management platform with agile boards, planning, docs and team insights in one app.

## 2. Problem, Vision and Goals

### 2.1 Problem

- Jira is powerful but heavy: slow UI, complex administration, per-seat pricing, vendor-hosted data.
- Lightweight Kanban tools lack workflows, sprints, permissions and reporting.
- Managers juggle separate tools for tickets, capacity planning, docs and status reports.

### 2.2 Vision

One workspace where any team can plan, track, ship and report on work, with Jira-level depth and a modern, keyboard-first, real-time experience.

### 2.3 Goals

1. Parity with Jira core (issues, workflows, boards, sprints, query search, reports) by v1.0.
2. Page load under 1.5 s; board drag-and-drop feels instant (under 100 ms optimistic update).
3. Self-host in under 15 minutes using Docker Compose.
4. Import Jira CSV/JSON with at least 95% field fidelity.
5. Real-time collaboration on boards, issues and comments.

### 2.4 Non-Goals (v1)

- Copying Jira's branding, icons, logo or UI text (trademark and legal risk). Use the phrase 'Jira alternative' only in a descriptive way.
- Jira Service Management (ITSM/helpdesk), Confluence parity, code hosting.
- Native iOS/Android apps (responsive web and installable PWA only).
- Third-party app marketplace (REST API and webhooks only).

---

## 3. Reference Analysis of the Five Open-Source Projects

| Project | License | Stack | Features we adopt | What we avoid |
| --- | --- | --- | --- | --- |
| **ManagerOS** (elmadah) | MIT | React 18, Express, SQLite via sql.js, Tiptap, Recharts | Dashboard (project health, blockers, overdue todos), sprint analytics (carry-over / new / completed), standups with stale-story detection, capacity planning (leave, loaned time, utilization), risks and blockers, 1:1 notes, weekly Markdown digest, Jira CSV/JSON import with diff preview, JSON backup and restore, rich notes with slash commands | No authentication or multi-tenancy; single-file SQLite |
| **Plane** (makeplane) | AGPL-3.0 | React Router, Django, PostgreSQL, Redis | Work items with rich editor, Cycles (sprints) with burndown, Modules, saved and shareable Views, Pages (docs), Analytics, instance-admin 'God mode', Docker and Kubernetes deployment | Do not copy code (AGPL copyleft) |
| **Zyra** (Farhodoff) | Not stated | React, Vite, Zustand, Node/Express, MongoDB, Socket.IO, JWT, Cloudinary | Real-time Kanban sync via Socket.IO, project keys (e.g. PR-1) with brand colors, priorities (Low to Critical), comments with avatars, in-app notifications, Docker production compose | Only 3 fixed columns; Admin/User roles too coarse; MongoDB for relational data |
| **OpenProject** (opf) | GPL-3.0 | Ruby on Rails, Angular, PostgreSQL | Gantt charts, portfolio management, time tracking and cost reporting, meeting agendas and minutes, wiki, news, Scrum/SAFe support, GitHub/GitLab/Nextcloud integrations, data sovereignty positioning | Heavy enterprise UI; do not copy code (GPL) |
| **ProjectHub** (zachloh) | Not stated | React, React Query, Mantine, Node/Express, MongoDB, Passport/JWT, Zod, Chart.js | Issue types Task/Story/Bug, drag-and-drop between columns, filter by title or assignee, global issue search, roles Admin / Project Manager / Member, optimistic updates, form validation | Basic feature set only; its own to-do list asks for custom columns and sortable tables, which we include |

**Legal note:** Use these repos for feature inspiration only. Write all code independently. AGPL, GPL and unlicensed code must not be copied into a product you intend to distribute or sell. Confirm with a lawyer if in doubt.

---

## 4. Target Users and Personas

| Persona | Needs | Key features |
| --- | --- | --- |
| Developer / Engineer | Fast ticket updates, clear priorities, link to PRs | Board, keyboard shortcuts, GitHub link, my-work view |
| Product Manager | Backlog grooming, roadmap, release planning | Backlog, epics, roadmap, versions, reports |
| Scrum Master / Delivery Lead | Run sprints, track velocity and blockers | Sprints, burndown, velocity, retrospectives |
| Engineering Manager | Capacity, workload, 1:1s, status reports | Capacity planning, team dashboard, weekly digest |
| QA / Tester | Bug reports with steps, severity and attachments | Bug issue type, custom fields, attachments |
| Project Admin | Configure workflows, permissions, fields | Project settings, schemes, automation |
| Org / Instance Admin | Users, SSO, security, audit, billing | Admin console, SSO, audit log |
| Stakeholder / Client (read-only) | Visibility without noise | Viewer role, shared views, dashboards |

---

## 5. Release Phasing Summary

| Phase | Target | Theme | Highlights |
| --- | --- | --- | --- |
| **MVP (M1)** | Month 1-3 | Core issue tracking | Auth, workspaces, projects, issues, Kanban board, comments, basic search, notifications |
| **v1.0 (M2)** | Month 4-6 | Jira parity | Custom workflows, Scrum (backlog, sprints), epics, query language, reports, RBAC, Jira import, REST API |
| **v1.5 (M3)** | Month 7-9 | Planning and collaboration | Roadmap/Gantt, time tracking, Pages (docs), automation, integrations, SSO |
| **v2.0 (M4)** | Month 10-12 | Management and intelligence | Capacity planning, standups, 1:1s, digests, portfolio, AI assistant, advanced analytics |

Priority key: **P0** = must ship in phase, **P1** = should, **P2** = nice to have.

---

## 6. Functional Requirements

### 6.1 Authentication and Account Management

- **FR-AUTH-01 (P0)** Register and log in with email and password (min 10 chars, hashed with Argon2id or bcrypt). Email verification required.
- **FR-AUTH-02 (P0)** Short-lived JWT access token plus rotating refresh token in httpOnly secure cookie; logout invalidates the session.
- **FR-AUTH-03 (P0)** Forgot/reset password via expiring single-use email link.
- **FR-AUTH-04 (P1)** OAuth login with Google and GitHub.
- **FR-AUTH-05 (P1)** Two-factor authentication (TOTP) and recovery codes.
- **FR-AUTH-06 (P1)** Enterprise SSO: SAML 2.0 and OpenID Connect; SCIM user provisioning (P2).
- **FR-AUTH-07 (P0)** Profile: name, avatar, timezone, language, theme (light/dark/system), notification preferences.
- **FR-AUTH-08 (P1)** Personal API tokens (scoped, revocable). Session list with remote sign-out.
- **FR-AUTH-09 (P1)** Brute-force protection: rate limit and temporary lockout.

### 6.2 Organizations, Workspaces and Teams

- **FR-ORG-01 (P0)** A user can create or join one or more workspaces (organizations); all data is tenant-isolated by workspace ID.
- **FR-ORG-02 (P0)** Invite members by email link; invite expiry; bulk invite (P1).
- **FR-ORG-03 (P1)** Teams/groups (e.g. Backend, QA) usable in permissions, assignments and filters.
- **FR-ORG-04 (P1)** Workspace settings: name, logo, default language, working days and hours, holidays.
- **FR-ORG-05 (P2)** Instance admin console for self-hosted installs (user management, SMTP, storage, feature flags), inspired by Plane's God mode.

### 6.3 Roles and Permissions (RBAC)

- **FR-RBAC-01 (P0)** Workspace roles: Owner, Admin, Member, Guest. Project roles: Project Admin, Project Manager, Developer/Member, Viewer.
- **FR-RBAC-02 (P1)** Permission schemes: per project, assign who can browse, create, edit, delete, assign, transition, comment, manage sprints, administer.
- **FR-RBAC-03 (P1)** Issue-level security levels (restrict an issue to a group).
- **FR-RBAC-04 (P0)** Server-side enforcement on every API call; the UI hides disallowed actions but never relies on that alone.
- **FR-RBAC-05 (P1)** Project visibility: Private, Workspace-internal, Public-read (optional).

### 6.4 Projects

- **FR-PRJ-01 (P0)** Create project with name, unique key (2-10 uppercase letters, e.g. WEB), description, lead, icon/color, default assignee.
- **FR-PRJ-02 (P0)** Project templates: Scrum, Kanban, Bug Tracking, Basic Task, Blank. Each preloads issue types, workflow, board and fields.
- **FR-PRJ-03 (P0)** Project types: team-managed (own config, simple) and company-managed (shared schemes) - P1 for company-managed.
- **FR-PRJ-04 (P0)** Archive, restore and delete (soft delete with 30-day recovery).
- **FR-PRJ-05 (P0)** Project members management with role assignment.
- **FR-PRJ-06 (P1)** Components, labels, versions/releases and categories per project.
- **FR-PRJ-07 (P1)** Project overview/summary page: status, recent activity, sprint progress, workload.
- **FR-PRJ-08 (P1)** Favorite/star projects; recent projects list.
- **FR-PRJ-09 (P2)** Clone project (config only, or with issues).

### 6.5 Issues (Work Items)

- **FR-ISS-01 (P0)** Issue key format PROJECT-N (e.g. WEB-142), unique and immutable; keys survive moves via redirect.
- **FR-ISS-02 (P0)** Default issue types: Epic, Story, Task, Bug, Sub-task. Admin can add custom types with icon and color.
- **FR-ISS-03 (P0)** Core fields: summary (required, max 255), description (rich text), type, status, priority (Lowest, Low, Medium, High, Highest/Critical), assignee, reporter, labels, components, fix version, affects version, due date, start date, original estimate, remaining estimate, story points, sprint, epic/parent, environment, attachments.
- **FR-ISS-04 (P0)** Create issue from global Create button (shortcut C), board column, backlog, or inline in list. Quick-create (summary only) and full-create dialog.
- **FR-ISS-05 (P0)** Issue detail view: full page and side-panel modes; inline editing of every field; autosave with visible save state.
- **FR-ISS-06 (P0)** Rich text editor (Tiptap): headings, lists, task lists, tables, code blocks with syntax highlighting, links, images paste/drag, @mentions, slash commands, emoji, Markdown shortcuts.
- **FR-ISS-07 (P0)** Hierarchy: Epic > Story/Task/Bug > Sub-task. Parent progress rolls up from children (done/total and story points).
- **FR-ISS-08 (P1)** Issue links with types: blocks / is blocked by, relates to, duplicates / is duplicated by, causes / is caused by. Blocked issues show a visible flag.
- **FR-ISS-09 (P0)** Attachments: drag-and-drop, up to 25 MB per file (configurable), image preview, virus scan hook (P1).
- **FR-ISS-10 (P1)** Custom fields: text, long text, number, date, datetime, single select, multi select, checkbox, user picker, URL, labels; configurable per project and issue type, required/optional, default values, validation (Zod/JSON schema).
- **FR-ISS-11 (P0)** Watchers: add self or others; auto-watch on create, assign, comment.
- **FR-ISS-12 (P0)** Clone, move to another project, convert type (e.g. Task to Bug, Story to Sub-task), delete (with confirm; soft delete), and restore (admin).
- **FR-ISS-13 (P1)** Bulk operations: multi-select to change status, assignee, priority, labels, sprint, move, delete.
- **FR-ISS-14 (P0)** Activity tabs per issue: Comments, History (field-level audit with old and new values, actor, time), Work log, Linked pull requests.
- **FR-ISS-15 (P1)** Voting and flagging/impediment marking. Rank (manual ordering) using fractional indexing (LexoRank-style).
- **FR-ISS-16 (P1)** Templates for issues (e.g. Bug template with steps to reproduce, expected, actual).
- **FR-ISS-17 (P0)** Shareable permalink; copy key and link shortcuts; deep links open the right panel.
- **FR-ISS-18 (P2)** Duplicate detection suggestions while typing a new summary.

### 6.6 Workflows

- **FR-WF-01 (P0)** Each issue type maps to a workflow of statuses and transitions. Status categories: To Do, In Progress, Done (drive board columns, reports and resolution).
- **FR-WF-02 (P0)** Default workflows: Simple (To Do > In Progress > Done) and Dev (Backlog > Selected > In Progress > In Review > QA > Done).
- **FR-WF-03 (P1)** Visual workflow designer (drag nodes, draw transitions). Transitions have names, from-status set (or Any), and a target.
- **FR-WF-04 (P1)** Transition conditions (who can run it), validators (required fields such as resolution or comment), and post-functions (assign to reporter, set field, trigger webhook).
- **FR-WF-05 (P1)** Resolutions (Done, Won't Do, Duplicate, Cannot Reproduce) set when moving to a Done-category status.
- **FR-WF-06 (P1)** Workflow versioning, draft vs published, and safe migration of issues when a status is removed.
- **FR-WF-07 (P0)** API and UI reject invalid transitions with a clear explanation.

### 6.7 Boards (Kanban and Scrum)

- **FR-BRD-01 (P0)** Board columns map to one or more workflow statuses; add, rename, reorder and delete columns.
- **FR-BRD-02 (P0)** Drag-and-drop cards across columns (triggers workflow transition) and within a column (re-rank). Use a maintained DnD library (dnd-kit or @hello-pangea/dnd).
- **FR-BRD-03 (P0)** Real-time sync: when one user moves a card, all connected users see it within 1 second without refresh (WebSocket).
- **FR-BRD-04 (P0)** Card shows key, summary, type icon, priority, assignee avatar, labels, story points, due date, flagged/blocked state, sub-task progress.
- **FR-BRD-05 (P0)** Quick filters: my issues, recently updated, by assignee, label, epic, type, text search. Save filters per board.
- **FR-BRD-06 (P1)** Swimlanes by assignee, epic, priority, story, or custom query.
- **FR-BRD-07 (P1)** WIP limits per column with visual warning (column turns red when exceeded).
- **FR-BRD-08 (P1)** Card display customization and card colors by priority/type/label.
- **FR-BRD-09 (P1)** Kanban: backlog column, done-column auto-hide after N days. Scrum: active-sprint-only board with 'Complete sprint' action.
- **FR-BRD-10 (P1)** Multiple boards per project; board scope defined by a saved query.
- **FR-BRD-11 (P0)** Optimistic UI updates with rollback and toast on failure.
- **FR-BRD-12 (P2)** Table/list view and calendar view of the same filtered issue set.

### 6.8 Backlog and Sprints

- **FR-SPR-01 (P0)** Backlog view: ordered list of unsprinted issues; drag to rank; drag into sprints; inline create.
- **FR-SPR-02 (P0)** Create, edit, start, and complete sprints with name, goal, start and end dates (default 1, 2, 3 or 4 weeks).
- **FR-SPR-03 (P0)** Only one active sprint per board by default (configurable for multiple, P2).
- **FR-SPR-04 (P0)** Complete sprint dialog: unfinished issues move to backlog or next sprint; carry-over tracked (inspired by ManagerOS).
- **FR-SPR-05 (P1)** Estimation: story points, hours, or issue count; sprint total and per-assignee workload shown in the sprint header.
- **FR-SPR-06 (P1)** Epic panel and version panel in the backlog with progress bars and filter-by-click.
- **FR-SPR-07 (P1)** Sprint scope-change log (issues added or removed after start) feeding the burndown.
- **FR-SPR-08 (P1)** Sprint retrospective page: what went well, to improve, action items (converted into issues).
- **FR-SPR-09 (P2)** Planning poker session for estimation (real-time).

### 6.9 Epics, Roadmap and Gantt

- **FR-RDM-01 (P1)** Roadmap (timeline) of epics with start and end dates, progress bars from child issues, zoom (week/month/quarter), drag to reschedule.
- **FR-RDM-02 (P1)** Release/version timeline with release dates and status (Unreleased, Released, Archived); release notes auto-generated from fixed issues.
- **FR-RDM-03 (P2)** Gantt chart (inspired by OpenProject): tasks with start/due dates, dependencies (finish-to-start), critical path highlight, baseline comparison.
- **FR-RDM-04 (P2)** Modules / initiatives grouping multiple epics or projects (inspired by Plane Modules); cross-project portfolio roadmap.
- **FR-RDM-05 (P1)** Calendar view with issues by due date.

### 6.10 Search, Filters and Query Language

- **FR-SRC-01 (P0)** Global search (shortcut /): by issue key, text in summary/description/comments, project, people, pages; instant results with keyboard navigation.
- **FR-SRC-02 (P0)** Basic filter UI: project, type, status, assignee, reporter, priority, label, component, version, sprint, dates, text.
- **FR-SRC-03 (P1)** Advanced query language, called GQL (Grace Query Language), similar to JQL. Example: `project = WEB AND status in ('In Progress','In Review') AND assignee = currentUser() ORDER BY priority DESC`.
- **FR-SRC-04 (P1)** GQL supports operators (=, !=, \~, in, not in, is empty, >, <, was, changed), functions (currentUser(), openSprints(), startOfWeek(), now()), AND/OR/NOT and parentheses, with autocomplete and syntax errors shown inline.
- **FR-SRC-05 (P1)** Saved filters/Views: private, shared with team or workspace; subscribe by email on a schedule.
- **FR-SRC-06 (P1)** Issue list/table view with sortable, resizable, reorderable columns; export to CSV, XLSX, JSON.
- **FR-SRC-07 (P1)** Search implementation: PostgreSQL full-text search in MVP, with an adapter for OpenSearch/Meilisearch at scale.

### 6.11 Collaboration: Comments, Mentions, Activity

- **FR-COL-01 (P0)** Comments with rich text, edit and delete (with 'edited' marker), timestamps, avatars, reactions (P1), and internal-only visibility (P2).
- **FR-COL-02 (P0)** @mention users or teams; mention notifies and auto-watches.
- **FR-COL-03 (P0)** Real-time comment updates and typing/presence indicators (who is viewing this issue) (P1).
- **FR-COL-04 (P1)** Project and workspace activity stream with filters.
- **FR-COL-05 (P1)** Concurrent edit protection: warn on conflicting edits to the same field; description supports collaborative editing via CRDT (Yjs) in P2.

### 6.12 Notifications

- **FR-NTF-01 (P0)** In-app notification center with unread count, mark read, mark all read, deep link to the issue.
- **FR-NTF-02 (P0)** Triggers: assigned to me, mentioned, comment on watched issue, status change, due date approaching or overdue, sprint started/completed, added to project.
- **FR-NTF-03 (P1)** Email notifications with per-event preferences, digest mode (instant, hourly, daily), and one-click unsubscribe. Reply-by-email to comment (P2).
- **FR-NTF-04 (P1)** Web push and browser notifications (PWA); Slack/Teams notifications through integrations.
- **FR-NTF-05 (P1)** Notification scheme per project (who gets notified on which event).

### 6.13 Time Tracking and Worklogs

- **FR-TIM-01 (P1)** Estimates (original, remaining) and work logs (time spent, date, description) on issues; formats like 2h 30m or 1d.
- **FR-TIM-02 (P2)** Timer start/stop; weekly timesheet per user; approval workflow.
- **FR-TIM-03 (P2)** Time and cost reports by project, user, epic, period; hourly rates and budgets (inspired by OpenProject cost reporting).

### 6.14 Reports, Dashboards and Analytics

- **FR-RPT-01 (P1)** Sprint burndown and burnup, velocity chart (committed vs completed), sprint report (completed, not completed, added mid-sprint, carry-over).
- **FR-RPT-02 (P1)** Cumulative flow diagram, control chart (cycle time), lead time and cycle time distribution, created vs resolved.
- **FR-RPT-03 (P1)** Version/release burndown, epic progress, workload by assignee, issues by status/priority/type/component (pie, bar).
- **FR-RPT-04 (P1)** Customizable dashboards with drag-and-drop gadgets: filter results, assigned to me, activity stream, sprint health, chart gadgets, text/markdown. Dashboards can be shared.
- **FR-RPT-05 (P1)** Workspace analytics (inspired by Plane): trends, throughput, overdue, blockers, team summary.
- **FR-RPT-06 (P2)** Weekly digest generator: Markdown status report for a date range (completed, in progress, blocked, risks), with copy, download and scheduled email (inspired by ManagerOS).
- **FR-RPT-07 (P0)** Every chart supports date-range filter, legend, tooltip and export as PNG/CSV.

### 6.15 Automation

- **FR-AUT-01 (P1)** No-code rule builder: Trigger > Condition > Action.
- **FR-AUT-02 (P1)** Triggers: issue created/updated/transitioned, field changed, comment added, scheduled (cron), sprint started/completed, webhook received.
- **FR-AUT-03 (P1)** Actions: set field, transition, assign, add comment, create sub-task, send email/Slack message, call webhook, clone issue.
- **FR-AUT-04 (P1)** Execution log, enable/disable, per-rule rate limit, and loop prevention.
- **FR-AUT-05 (P2)** Template rules (auto-assign by component, auto-close stale, move parent to Done when all sub-tasks are Done).

### 6.16 Pages and Documentation

- **FR-DOC-01 (P1)** Project pages/wiki (inspired by Plane Pages and OpenProject wiki): nested pages, rich text, embedded issue lists, tables, version history, page-level permissions.
- **FR-DOC-02 (P1)** Convert any text selection into an issue; link pages to issues and sprints.
- **FR-DOC-03 (P2)** Meeting notes with agenda, attendees, action items that become issues (inspired by OpenProject meetings). Project news/announcements.

### 6.17 Team Management, Capacity and Insights (Manager Suite)

Inspired by ManagerOS. This module is optional per workspace.

- **FR-MGR-01 (P2)** Team member profiles: role, level, skills, active/inactive status, team assignments, current work, velocity.
- **FR-MGR-02 (P2)** Capacity planning per sprint: weekday grid, leave ranges (planned vs unplanned), loaned time, excluded members, points or hours, utilization percentage, global capacity settings; compare plan against committed scope.
- **FR-MGR-03 (P2)** Standup log per person with stale-issue detection (no status change for N days) and sprint pulse indicators.
- **FR-MGR-04 (P2)** 1:1 notes with date, talking points, action items and sentiment; visible only to the manager and the report.
- **FR-MGR-05 (P2)** Risks and blockers register with severity, status, owner and links to projects/issues.
- **FR-MGR-06 (P2)** Personal to-do list with drag-and-drop ordering, priority, due dates and links to issues.

### 6.18 Integrations and Extensibility

- **FR-INT-01 (P0 for API)** Public REST API (OpenAPI 3 documented) covering all entities; API tokens; pagination, filtering, rate limits.
- **FR-INT-02 (P1)** Outgoing webhooks with HMAC signature, retries with backoff, delivery log, and event filter.
- **FR-INT-03 (P1)** GitHub and GitLab: link branches, commits and pull requests by issue key; show PR status on the issue; transition issue on PR merge.
- **FR-INT-04 (P1)** Slack and Microsoft Teams: notifications, unfurl issue links, create issue from message (P2).
- **FR-INT-05 (P1)** Email-in: create issues by sending email to a project address.
- **FR-INT-06 (P1)** Calendar: iCal feed for sprints, due dates and releases; Google Calendar sync (P2).
- **FR-INT-07 (P2)** File storage links (Google Drive, OneDrive, Nextcloud). CI/CD status (GitHub Actions) on issues.
- **FR-INT-08 (P2)** Zapier/Make connector; plugin SDK for custom gadgets and fields.

### 6.19 Import, Export and Backup

- **FR-IMP-01 (P1)** Import from Jira CSV and JSON export: map fields (key, summary, sprint, status, assignee, story points, resolved date, type, epic key, epic name), preview a diff, assign new items to projects, then confirm (inspired by ManagerOS).
- **FR-IMP-02 (P2)** Direct import via Jira Cloud/Data Center API using a token (projects, issues, comments, attachments, users, sprints); Trello, Asana, GitHub Issues and Linear importers (P2).
- **FR-IMP-03 (P1)** Export issues to CSV/XLSX/JSON/PDF; export a project as a ZIP archive.
- **FR-IMP-04 (P1)** Workspace backup and restore (full JSON/SQL dump) with a warning before overwrite; scheduled backups for self-hosted installs.
- **FR-IMP-05 (P1)** GDPR tools: export a user's data and delete or anonymize a user on request.

### 6.20 Administration and Audit

- **FR-ADM-01 (P0)** User directory: invite, deactivate, change role, reset 2FA.
- **FR-ADM-02 (P1)** Global settings: custom fields, issue types, workflows, priorities, resolutions, screens/layouts, notification schemes.
- **FR-ADM-03 (P1)** Immutable audit log (who, what, when, IP) for security-relevant actions; filter and export; retention policy.
- **FR-ADM-04 (P1)** Usage and storage quotas; email (SMTP) and object storage configuration; branding (logo, colors) for self-hosted.
- **FR-ADM-05 (P2)** Billing and plans (SaaS): seats, trial, invoices via Stripe.

### 6.21 AI Assistant (Optional, v2)

- **FR-AI-01 (P2)** Draft an issue description or acceptance criteria from a one-line summary; summarize long comment threads; suggest labels, component and assignee.
- **FR-AI-02 (P2)** Natural-language search that converts text to a GQL query ('bugs assigned to me from last week').
- **FR-AI-03 (P2)** Auto-generate sprint summary, release notes and weekly digest. All AI features can be disabled per workspace, and no customer data is used for model training.

---

## 7. Key User Flows

1. **Onboarding:** sign up > verify email > create workspace > choose project template > invite teammates > sample data > guided tour.
2. **Create and work an issue:** press C > type summary > pick type and assignee > Create > card appears on board in real time > assignee drags to In Progress > comments and logs time > moves to Done and sets resolution.
3. **Run a sprint:** groom backlog > estimate > create sprint > drag issues in > Start sprint > daily board use and burndown > Complete sprint > review report > retrospective.
4. **Migrate from Jira:** Settings > Import > upload CSV > map fields > review diff preview > assign to project > confirm > verification report.
5. **Manager weekly report:** open Digest > choose date range > review generated Markdown > edit > copy, download or email.

---

## 8. Data Model (Core Entities)

| Entity | Key fields | Relations |
| --- | --- | --- |
| User | id, email, name, avatar, timezone, locale, status, 2FA | Memberships, Notifications |
| Workspace | id, name, slug, plan, settings | Has Projects, Members, Teams |
| Membership | user\_id, workspace\_id, role | Links User and Workspace |
| Team | id, workspace\_id, name | Many users |
| Project | id, workspace\_id, key, name, lead\_id, template, visibility, archived\_at | Has Issues, Sprints, Boards, Versions, Components |
| ProjectMember | project\_id, user\_id, role |  |
| IssueType | id, project\_id, name, icon, hierarchy\_level |  |
| Issue | id, project\_id, number, key, type\_id, summary, description (JSON), status\_id, priority, assignee\_id, reporter\_id, parent\_id, sprint\_id, story\_points, estimates, due\_date, rank, resolution, created\_at, updated\_at, deleted\_at | Comments, Attachments, Links, Worklogs, History |
| Workflow / Status / Transition | workflow\_id, status category, from/to, conditions, validators, post-functions | Mapped to issue types |
| IssueLink | source\_id, target\_id, link\_type |  |
| Comment | id, issue\_id, author\_id, body, edited\_at | Mentions, Reactions |
| Attachment | id, issue\_id, file\_key, size, mime, uploader\_id | Object storage |
| Worklog | id, issue\_id, user\_id, seconds, started\_at, note |  |
| Sprint | id, board\_id, name, goal, state (future/active/closed), start, end | Sprint-Issue history |
| Board | id, project\_id, type (scrum/kanban), query, columns, swimlanes, wip\_limits |  |
| Version, Component, Label | project-scoped | Issue many-to-many |
| CustomField / FieldValue | type, config, project/type scope |  |
| SavedFilter / Dashboard / Gadget | owner, query, sharing |  |
| AutomationRule / RuleRun | trigger, conditions, actions, status |  |
| Page | id, project\_id, parent\_id, content, version |  |
| Notification | id, user\_id, event, issue\_id, read\_at |  |
| AuditLog | id, actor, action, target, ip, at | Append-only |
| Webhook / ApiToken / Integration | secrets encrypted |  |
| Manager Suite: CapacityPlan, Leave, Standup, OneOnOne, Risk | per workspace | Optional module |

Design notes: every table carries workspace\_id for tenant isolation (and Postgres row-level security as defense in depth); soft delete where noted; issue history is append-only; ranking uses fractional indexing to avoid mass re-ordering.

---

## 9. Architecture and Technology Recommendation

| Layer | Recommendation | Rationale |
| --- | --- | --- |
| Frontend | React 18 + TypeScript, Vite, React Router, TanStack Query (server state), Zustand (UI state), Tailwind CSS + shadcn/ui (or Mantine), dnd-kit, Tiptap, Recharts or ECharts, Zod + React Hook Form | Matches stacks of ManagerOS, Zyra and ProjectHub; optimistic updates via Query |
| Backend | Node.js + TypeScript with NestJS (or Fastify/Express), REST + OpenAPI; WebSocket gateway (Socket.IO) | Same language as frontend; Socket.IO proven in Zyra |
| Database | **mySQL** (primary). Prisma or Drizzle ORM | Issues, workflows, links and reports are relational; MongoDB (used by Zyra and ProjectHub) makes joins, reporting and transactions harder. Plane and OpenProject also use PostgreSQL |
| Cache / queues | Redis: sessions, rate limits, pub/sub for real-time fan-out, BullMQ for jobs (email, webhooks, automation, imports) |  |
| Search | mySQL FTS first; OpenSearch or Meilisearch later | Keep MVP simple |
| File storage | S3-compatible (AWS S3, MinIO for self-host) with pre-signed uploads | Avoid vendor lock-in (Zyra uses Cloudinary) |
| Auth | JWT + refresh rotation, Passport/OIDC libraries |  |
| Deployment | Docker Compose (self-host), Kubernetes Helm chart, CI/CD with GitHub Actions; environments dev, staging, prod |  |
| Observability | OpenTelemetry, Prometheus + Grafana, Sentry, structured logs |  |

**Architecture style:** modular monolith (clear domain modules: auth, projects, issues, workflow, boards, search, notifications, automation, integrations) deployable as one service plus worker processes; split into services only when load demands.

**Real-time design:** client subscribes to rooms (workspace, project, board, issue); server publishes domain events through Redis pub/sub; clients apply patches and reconcile with server state; reconnect with missed-event replay.

---

## 10. API Outline (REST, versioned under /api/v1)

| Area | Example endpoints |
| --- | --- |
| Auth | POST /auth/register, /auth/login, /auth/refresh, /auth/logout, /auth/forgot-password |
| Workspaces | GET/POST /workspaces, /workspaces/:id/members, /invites |
| Projects | GET/POST /projects, GET/PATCH/DELETE /projects/:key, /projects/:key/members |
| Issues | GET/POST /issues, GET/PATCH/DELETE /issues/:key, POST /issues/:key/transitions, /comments, /attachments, /links, /worklogs, GET /issues/:key/history |
| Boards and sprints | GET /boards/:id, PATCH /boards/:id/columns, POST /sprints, POST /sprints/:id/start, /complete, PUT /issues/:key/rank |
| Search | GET /search?q=, POST /search/gql, GET/POST /filters |
| Reports | GET /reports/burndown?sprintId=, /velocity, /cfd, /created-vs-resolved |
| Admin | /workflows, /fields, /issue-types, /permission-schemes, /audit-logs |
| Integrations | /webhooks, /integrations/github, POST /import/jira |
| Real-time | WebSocket /ws with events issue.updated, issue.moved, comment.added, sprint.started |

API standards: cursor pagination, consistent error format (code, message, details), idempotency keys for creates, ETag/If-Match for optimistic concurrency, rate limits (default 600 req/min/user), and webhooks signed with HMAC-SHA256.

---

## 11. Non-Functional Requirements

| Category | Requirement |
| --- | --- |
| Performance | p95 API latency under 300 ms; board with 500 cards renders under 1.5 s (virtualize long lists); search results under 500 ms |
| Scalability | 10,000 users and 5 million issues per workspace-cluster in v1; horizontal scaling of API and workers |
| Availability | 99.9% monthly (SaaS); zero-downtime deploys; automated health checks |
| Reliability | Daily backups, point-in-time recovery, RPO 15 min, RTO 1 hour |
| Security | OWASP ASVS L2 target (details in Section 12) |
| Accessibility | WCAG 2.2 AA; full keyboard navigation (including drag-and-drop alternative); screen-reader labels; color-contrast safe |
| Browser support | Latest two versions of Chrome, Edge, Firefox, Safari; responsive from 360 px width |
| Internationalization | UI strings externalized (i18n), UTF-8 and RTL-ready, locale-aware dates and number formats; English at launch, Hindi and others later |
| Maintainability | TypeScript strict mode, linting and formatting in CI, 80%+ unit coverage on core modules, contract tests for the API |
| Testing | Unit (Vitest/Jest), integration (Supertest + test DB), E2E (Playwright), load (k6), security (SAST/DAST, dependency scanning) |
| Data | Soft delete and recovery for 30 days; data residency option for self-host and EU region |

---

## 12. Security and Compliance

- Transport: TLS 1.2+ everywhere; HSTS; secure, httpOnly, SameSite cookies.
- Application: input validation on every endpoint (Zod), output encoding, sanitize rich text (DOMPurify / schema-based) to prevent XSS, CSRF protection, SQL-injection safe ORM queries, SSRF guard for webhooks and imports, upload type and size checks, rate limiting.
- Secrets: third-party tokens (GitHub, Slack, Jira PAT) encrypted at rest (AES-256-GCM, key from KMS/env) and never sent to the browser (a pattern ManagerOS uses for its Jira token).
- Tenant isolation: workspace\_id enforced in the data-access layer plus Postgres row-level security.
- Audit: append-only audit log; admin actions and permission changes recorded.
- Privacy: GDPR/CCPA support (consent, export, deletion), data processing agreement, cookie policy.
- Compliance roadmap: SOC 2 Type II readiness and ISO 27001 for the SaaS offering (post-v1.5).
- Dependency and supply-chain hygiene: lockfiles, Dependabot/Renovate, container image scanning, SBOM.

---

## 13. UX and Design Requirements

- **Layout:** collapsible left sidebar (Home, My Work, Projects, Filters, Dashboards, Pages, Team), top bar with global search, Create button, notifications, and profile; project sidebar (Board, Backlog, Roadmap, List, Reports, Pages, Settings).
- **Design system:** original visual identity; tokens for color, spacing, type; light and dark themes; reusable component library (Button, Select, Avatar, Badge, Modal, Drawer, Tabs, Table, Toast, Empty states).
- **Speed and feel:** skeleton loaders, optimistic updates, no full-page reloads, autosave, undo toast for destructive actions.
- **Keyboard shortcuts:** C create issue, / search, G then B go to board, G then K backlog, A assign, M comment, . quick actions menu, ? shortcut help, Cmd/Ctrl+K command palette.
- **Empty and error states:** helpful copy with a primary action; offline banner and retry.
- **Responsive:** board scrolls horizontally on mobile, issue view becomes full screen, bottom navigation (PWA).
- **Onboarding:** sample project, checklist, contextual tips; in-app help links.

---

## 14. Success Metrics

| Metric | Target (6 months after v1.0) |
| --- | --- |
| Activation: new workspace creates 5+ issues in first 7 days | 60% |
| Weekly active users / total users | 50%+ |
| Time to create first issue | Under 2 minutes |
| Median board load | Under 1.2 s |
| Jira import success rate (no manual fix) | 90%+ |
| Self-host install success on first try | 85%+ |
| NPS | 40+ |
| Support tickets per 100 active users per month | Under 5 |
| Uptime | 99.9% |

Instrument product analytics (privacy-respecting, opt-out for self-hosted): funnel events for onboarding, issue creation, board use, sprint completion, and search usage.

---

## 15. Roadmap and Milestones (Indicative)

| Milestone | Deliverables | Exit criteria |
| --- | --- | --- |
| **M0 - Foundations (Weeks 1-3)** | Repo, CI/CD, design system, DB schema, auth skeleton, Docker Compose | Dev environment one-command; auth demo |
| **M1 - MVP (Months 1-3)** | Auth, workspaces, projects, issues, Kanban board with real-time sync, comments, notifications, basic search and filters, attachments, roles (Admin/Member/Viewer) | Internal dogfooding by 10 users; P0 bugs closed |
| **M2 - v1.0 (Months 4-6)** | Workflows, backlog and sprints, epics, sub-tasks, links, GQL, saved filters, reports (burndown, velocity), RBAC schemes, Jira CSV import, REST API, email notifications | Closed beta with 20 teams; performance and security review passed |
| **M3 - v1.5 (Months 7-9)** | Roadmap and Gantt, time tracking, Pages, automation, GitHub/GitLab/Slack, SSO, webhooks, dashboards | Public beta; 99.9% uptime over 30 days |
| **M4 - v2.0 (Months 10-12)** | Manager Suite (capacity, standups, 1:1s, digests), portfolio, AI assistant, advanced analytics, Jira API import | General availability |

Rough team: 1 PM, 1 designer, 3-4 full-stack engineers, 1 QA/DevOps (scale up from M2).

---

## 16. Risks and Mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Scope: 'full clone of Jira' is enormous (Jira has had 20+ years of development) | Delays, burnout | Strict phasing; ship core parity first; defer ITSM, marketplace and native apps |
| Copyright, trademark and license violations | Legal action | Original code and UI; no Jira branding; do not copy AGPL/GPL/unlicensed repo code; license review of all dependencies |
| Workflow engine complexity | Bugs, data corruption | Start with fixed status categories, add designer in v1.0; heavy automated tests |
| Real-time conflicts and performance | Poor UX | Optimistic updates with server reconciliation; ETags; load tests on boards with 1,000 cards |
| Search and reporting scale | Slow queries | Proper indexes, materialized views for reports, search adapter |
| Migration fidelity from Jira | Adoption blocker | Early importer, field-mapping UI, diff preview and dry-run |
| Security incident in multi-tenant data | Severe trust loss | RLS, tenant tests, pen test before public beta, bug bounty after GA |
| Competition (Jira, Linear, Plane, ClickUp) | Weak differentiation | Focus on speed, self-hosting, manager suite and migration ease |

---

## 17. Open Questions (Please Confirm)

1. Who is the primary buyer: startups, agencies, enterprises, or internal company use only?
2. SaaS, self-hosted only, or both? Will there be a paid plan, and which license (MIT, AGPL, proprietary) will Grace itself use?
3. Team size and timeline: is the 12-month plan realistic, or should the scope be cut to MVP plus v1.0?
4. Is the Manager Suite (capacity, 1:1s) in scope or a later add-on?
5. Preferred stack: confirm TypeScript with PostgreSQL, or do you want to stay on MongoDB as in Zyra and ProjectHub?
6. Is Jira compatibility (import, API shape, JQL syntax) a hard requirement or only a nice-to-have?
7. Required compliance certifications and data-residency regions?
8. Languages needed at launch (English only, or also Hindi and others)?

---

## 18. Sample Acceptance Criteria

**Move a card (FR-BRD-02, FR-BRD-03, FR-WF-07)**

- Given a board with an issue in To Do, when a Developer drags it to In Progress, then the card moves immediately (optimistic), the server records the transition and a history entry, and other users on the board see the change within 1 second.
- If the workflow does not allow the transition, the card snaps back and a toast explains why.
- If the user lacks Transition permission, drag is disabled and a tooltip explains the reason.

**Complete a sprint (FR-SPR-04)**

- Given an active sprint with 3 unfinished issues, when the Scrum Master selects Complete sprint, then a dialog asks where to move them (backlog or a chosen sprint); after confirming, the sprint is closed, the sprint report is generated, the issues are marked as carry-over, and velocity is updated.

**Jira import (FR-IMP-01)**

- Given a Jira CSV with 500 issues, when uploaded, then a preview shows new, changed and unmapped items; unmapped users can be mapped or created as placeholders; confirming creates the issues with original keys stored as external references; a report lists any rows that failed with reasons.

**Permissions (FR-RBAC-04)**

- A Viewer calling the Create Issue API receives HTTP 403 and no data is written, regardless of what the UI shows.

---

## Appendix A: Glossary

- **Issue / Work item:** a unit of work (task, bug, story, etc.).
- **Epic:** a large body of work broken into stories.
- **Sprint / Cycle:** a time-boxed iteration (called Cycle in Plane).
- **Backlog:** the prioritized list of work not yet scheduled.
- **Workflow:** the set of statuses and allowed transitions for an issue type.
- **GQL:** Grace Query Language, a JQL-like search syntax.
- **Velocity:** story points completed per sprint.
- **WIP limit:** maximum number of issues allowed in a column.
- **RBAC:** role-based access control.
- **CRDT:** data structure enabling conflict-free collaborative editing.

## Appendix B: Source Repositories Reviewed

- https://github.com/elmadah/manager-os
- https://github.com/makeplane/plane
- https://github.com/Farhodoff/zyra
- https://github.com/opf/openproject
- https://github.com/zachloh/project-management-app


as for diagram for better understanding:
- https://gitdiagram.com/elmadah/manager-os?utm_source=chatgpt.com
- https://gitdiagram.com/makeplane/plane?utm_source=chatgpt.com
- https://gitdiagram.com/farhodoff/zyra?utm_source=chatgpt.com
- https://gitdiagram.com/opf/openproject?utm_source=chatgpt.com
- https://gitdiagram.com/zachloh/project-management-app?utm_source=chatgpt.com
