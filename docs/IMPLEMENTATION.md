# Grace implementation status

15 October 2026 · Development release 0.1.0 · Planning and administration milestone

The original PRD remains the source of product scope. This document records what is implemented and what still needs development. The aspiration to exceed Jira is a product direction, not a claim that this first release achieves feature parity.

## Delivered foundation and working flows

- React, TypeScript, Vite, TanStack Query, Tiptap, dnd-kit, Socket.IO, and an Express/TypeScript API.
- An original light theme with warm white, sage, lavender, local variable fonts, clearer navigation, consistent spacing, reusable controls, visible focus, responsive layouts, dialogs, toasts, skeletons, and shortcut help. The readable type scale uses a 15 px root, 14 px body controls and work-item text, 13 px secondary labels, 12 px captions, and 15 px reading text.
- MySQL and SQLite SQL adapters, parameterized queries, schema export, foreign keys, indexes, transactional mutations, version conflict checks, and atomic issue keys. Numbered additive migrations record the v2 planning baseline and v3 sprint lifecycle snapshots without resetting user records, custom statuses, or custom columns.
- Workspace signup and login, session refresh/logout, request validation, CSRF checks, rate limiting, HTML sanitization, workspace isolation, private projects, and basic workspace/project roles.
- Core project, issue, board, backlog, sprint, collaboration, notification, search, Pages, reports, import/export, and manager flows described in the README.
- Workspace creation and switching, single-use expiring invitation links bound to an email, invitation status/revocation, active-session inspection, individual session revocation, sign out of other sessions, and sign out everywhere. Switching rotates the current session into the selected workspace; regular login still initially selects the first membership.
- Project administration for names, descriptions, visibility, lead changes, explicit member/admin/viewer roles, member removal, archive, and restore. Workspace owners/admins retain their access; workspace viewers cannot gain write access through a project role. Issue trash exposes the 30-day admin recovery window and flags projects that must be restored first.
- Modules with names, descriptions, leads, dates, explicit lifecycle states, many-to-many issue membership, versioned edits, archive/restore, and server-computed issue/point progress. Completing a module rejects unfinished linked issues; its manual state and live issue progress remain distinct.
- Cycle planning with atomic mixed scope changes, one active cycle per project, carry-over, immutable start/completion snapshots, scope-change history, real daily burndown, and CSV export. Final scope includes unfinished work carried into the next cycle; later issue edits do not rewrite captured completion totals.
- Transactional bulk status, assignee, priority, cycle, label, and soft-delete operations. Every selected issue is permission-checked and version-checked; any invalid or stale item aborts the whole batch. Unspecified fields remain unchanged.
- Rich-editor slash commands, nested checklists, tables with row/column controls and resizing, link editing and validation, headings, formatting, quotes, lists, code blocks, and dividers. Descriptions and Pages use a shared server sanitizer that preserves supported editor nodes.
- Saved private/workspace Views can be created, applied, renamed, edited, shared, and deleted. GQL is validated before a view is saved. Private views are editable only by their owner; shared views by their owner or workspace admins. Viewer roles cannot mutate views.

## Deliberately limited first implementations

- **Workflows:** custom status columns, category mapping, naming, and WIP limits work. Every configured status can transition to every other status. Workflow graphs, role conditions, validators, post-functions, draft publishing, and migration between workflow versions are pending.
- **Boards:** one status-based board per project. Cross-column and in-column ranking use dnd-kit. Issue properties provide a keyboard alternative. Swimlanes, multiple boards, virtualized large boards, persistent board filters, and configurable status mappings remain pending.
- **Issue editing:** properties save inline, while descriptions and Pages use explicit saves. This release does not promise universal autosave or collaborative CRDT editing. Comments are plain text; descriptions and Pages are rich text.
- **Rich text:** the delivered editor supports slash commands, nested task lists, tables, headings, formatting, links, and code blocks. Image embeds, syntax highlighting, mentions, emoji picker, and concurrent shared editing remain pending. Checklists in descriptions/Pages do not create separate issues automatically.
- **Search:** workspace-scoped search and GQL run on server-loaded visible records. SQL full-text indexes and a scale-out search adapter are pending. Global search covers loaded issue keys/summaries/descriptions, projects, and page titles; comment text, fuzzy matching, and people search are pending.
- **GQL:** supports AND/OR/NOT, parentheses, comparisons, contains, lists, empty checks, one ORDER BY, currentUser(), openSprints(), now(), and startOfWeek(). Historical WAS/CHANGED operators, autocomplete, multiple sort columns, and full JQL compatibility are pending. Query length is bounded and inputs are parsed without eval or SQL interpolation.
- **Reports:** current status/workload, issue activity, closed-sprint velocity, cycle burndown, and scope history work. Burndown actuals begin at the v2 baseline and use recorded issue changes; earlier days and future days are null rather than invented. Newly observed sprint starts/completions have v3 lifecycle snapshots. Older completed cycles without such snapshots explicitly report current membership, not reconstructed final scope. The ideal burndown line is a planning guide. Cycle analytics is limited to date ranges of at most two years. Burnup, CFD, cycle/lead time, chart PNG export, time/cost reporting, custom dashboard gadgets, and performance instrumentation remain pending.
- **Timeline:** renders work with start/due dates and month/quarter ranges. Rescheduling happens in issue properties. Dependency routing, drag scheduling, baseline comparison, critical path, portfolio, releases, and a calendar view remain pending.
- **Jira import:** supports Summary, key, status, type, priority, simple description, and story points in CSV or JSON. Unknown status names map to the first configured status with a warning. It creates new issues after preview and preserves the original key in the description. Assignee mapping, epics/links/sprints, Atlassian Document Format, attachments, diff/upsert, direct Jira APIs, and the PRD’s 95% fidelity target remain pending. Re-import is not deduplicated.
- **Manager suite:** basic capacity estimates, standups, stale work, risk state, and Markdown digest work. Capacity uses an explicit hours-per-point assumption and a two-week horizon; it is not time tracking. Leave, loaned time, calendar availability, private 1:1 notes, personal todos, meeting management, and scheduled digests remain pending.
- **Templates:** Scrum/Kanban/Bug/Basic metadata are stored; each new project currently uses the same initial issue types and Simple workflow. Distinct configuration templates remain pending.
- **Real time:** authenticated workspace rooms send invalidation events without record contents. Clients refetch through access-checked endpoints. Redis fan-out, missed-event replay, presence/typing indicators, and horizontal scaling remain pending.
- **Permissions:** workspace roles, private project membership, project role administration, view ownership, module/cycle access, bulk-item checks, and recovery administration are enforced. Issue-level security, configurable permission schemes, team/group assignment, member deactivation, and a complete instance-admin surface remain pending.
- **Attachments:** protected local download and a 25 MB upload limit work. Orphan cleanup, virus scanning, image previews, quotas, and S3-compatible object storage remain pending.

## Next milestone: close core MVP gaps

1. Complete email verification, password recovery, SMTP delivery, and member deactivation.
2. Add distinct project configuration templates, issue templates, issue moves with stable key aliases, and backlog ranking.
3. Add watcher assignment, comments deletion and mentions, notification preference/trigger coverage, and rich issue templates.
4. Extend modules with member assignment, dependencies, broader analytics, and portfolio/initiative planning; add cycle retrospectives and richer reports.
5. Exercise the MySQL adapter and incremental migrations in integration CI against a real MySQL 8 instance; add database backup/restore and MySQL full-text search.
6. Paginate bootstrap data, virtualize large lists/boards, add bounded query execution and report endpoints, then measure the PRD’s performance targets.
7. Add frontend interaction automation, real-time multi-client regression coverage, attachment tests, accessibility auditing, and broader security review.

## Later PRD milestones

- **Deeper issue tracking:** visual workflows and permission schemes, components and releases, custom fields, advanced GQL/history, Jira migration fidelity, sprint retrospectives, and expanded sprint reports. Existing bulk edits cover the documented standard fields rather than arbitrary custom fields or issue moves.
- **Planning and collaboration:** dependency-aware Gantt, cross-project initiatives and portfolio, advanced module reporting, time/cost reporting, nested collaborative docs, automation rules and execution logs, GitHub/GitLab/Slack/Teams, signed outgoing webhooks, API tokens/OpenAPI coverage, OAuth/SSO/MFA.
- **Management:** leave/loaned capacity, confidential 1:1 records, meetings, todos, recurring digests, budgets/costs, and optional AI with explicit data boundaries.
- **Operations:** deployment, Docker Compose, container images, queues/Redis, observability, CI/CD, backups/PITR, PWA, localization, scaling, and production readiness review. Deployment and Docker were explicitly postponed by the user.

## Verification boundaries

React component regressions exercise the rich editor under StrictMode, switching documents, read-only descriptions, tables/checklists, draft preservation, and undo. Page-save tests cover canonical saved HTML, typing during pending saves, and conflict checking after another member edits a page. Browser verification covers opening, editing, saving, and reloading Pages and opening the issue editor in development and the built app.

Strict TypeScript and a client production build are part of local verification. Integration tests use a fresh isolated SQLite database; they do not touch the running demo database. Browser checks exercise the local app. MySQL runtime, production hosting, third-party integrations, email delivery, load targets, and formal WCAG compliance have not been verified. Passing core tests is not a production security certification.
