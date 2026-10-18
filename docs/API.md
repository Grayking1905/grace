# Grace API · development reference

Base path: `/api/v1`. Browser clients use HTTP-only session cookies. Every mutation requires `X-Grace-CSRF: 1`; cross-origin mutation requests are rejected unless their Origin matches `APP_ORIGIN`. Errors use `{ code, message }`.

This is a browser-session API for the development release. Scoped API tokens, complete OpenAPI schemas, all-entity cursor pagination, and public third-party API compatibility remain future work.

## Authentication

- `POST /auth/register`: email, password (10–128 characters), name, workspace; or invite_token instead of workspace.
- `POST /auth/login`: email and password, or employee_id, organization (workspace slug) and password.
- `POST /auth/demo`: local development only.
- `POST /auth/refresh`: rotates the refresh cookie.
- `POST /auth/logout`: invalidates the current server session.
- `GET /auth/me`: the signed-in profile and workspace role.
- `GET /auth/invite?token=...`: valid invitation summary, without accepting it.
- `POST /invites`: admin only; email and organization role; optional employee_id, team_id and team_role reserve an email-bound team assignment. Returns a single-use URL. Supplying an employee ID requires a team.
- `POST /invites/accept`: signed-in invited email accepts a token and enters the workspace.

## Workspace and projects

- `GET /bootstrap`: visible workspace records for the initial UI.
- `PATCH /workspace`: admin updates workspace name.
- `PATCH /members/:id`: profile/capacity; admin required for other people or role changes. Ownership transfer is rejected.
- `GET /projects`, `POST /projects`, `PATCH /projects/:id`: list/create/update/favorite/archive projects. Creation keys are 2–10 uppercase letters.
- `GET /audit`: workspace admin audit log (latest 200).

## Issues

- `GET /issues`: q, project_id, cursor (numeric offset), limit (up to 200); returns items, total, nextCursor.
- `POST /issues`: project_id, summary; optional description, type, status_id, priority, assignee_id, parent_id, sprint_id, labels, story_points, dates, flagged, rank.
- `GET /issues/:id`: id or key, issue detail plus comments/history/worklogs/attachments/links/watchers; X-Resource-Version includes the issue version. API responses use Cache-Control: no-store so changes to child records do not leave stale cached detail views.
- `PATCH /issues/:id`: changed fields and required integer version. Stale versions return 409 EDIT_CONFLICT. A partial update preserves every unspecified field.
- `DELETE /issues/:id`: soft-delete.
- `POST /issues/:id/restore`: admin restore within 30 days.
- `POST /issues/:id/clone`.
- `POST /issues/:id/comments`: body.
- `PATCH /issues/:id/comments/:commentId`: body, author/admin only.
- `POST /issues/:id/watch`: watching boolean for the current user.
- `POST /issues/:id/worklogs`: minutes (1–1440), note.
- `POST /issues/:id/links`: target_id and type (blocks / relates to / duplicates).
- `POST /issues/:id/attachments`: multipart field file, up to 25 MB.
- `GET /attachments/:id`: protected download.

## Planning and tools

- `POST /statuses`: admin, project_id/name/category.
- `PATCH /statuses/:id`: admin, name/wip_limit.
- `POST /sprints`: project_id, name, goal, start_date/end_date (YYYY-MM-DD).
- `POST /sprints/:id/start`: rejects another active sprint in the same project.
- `POST /sprints/:id/complete`: destination_id or null for backlog.
- `POST /search/gql`: query string; returns visible matching issues or 400 INVALID_QUERY.
- `POST /views`: name/query/sharing; `DELETE /views/:id`: owner/admin.
- `POST /notifications/read`: optional notification id; otherwise marks all current-user notifications read.
- `POST /pages`: title/project_id; `PATCH /pages/:id`: title/content/version. Updates return `{ ok: true, page }` with the canonical saved title, sanitized content, and new version. Clients retain the draft's original version for conflict checks and preserve typing made while a save is pending.
- `GET /pages/:id/versions`: prior saved page versions.
- `POST /standups`: yesterday/today/blockers for the current person.
- `POST /risks`: title/severity/project_id; `PATCH /risks/:id`: state.
- `POST /import/jira`: admin, project_id, content, format csv/json, confirm false/true. Preview does not write. Confirmation imports all valid rows in one transaction.

## Real time

Socket.IO uses the same authenticated access cookie. Each socket enters its current workspace room. A generic `workspace.updated` event causes clients to refetch through the API; sensitive record payloads are not broadcast. Sessions are rechecked every 30 seconds. Redis fan-out and event replay are not yet implemented.

## Organization teams and work

- `GET /organization`: the current employee assignment and accessible team dashboards. Owners/admins see every team; employees see their assigned team.
- `POST /organization/teams`: admin creates name, description, color, sections, permissions. Sections: issues/bugs/features/brds/daily/versions. Permissions map lead/member/viewer roles to work/brds/daily/versions editing capabilities; viewers remain read-only.
- `PATCH /organization/teams/:id`: admin supplies the full configuration and required version. Stale edits return 409.
- `GET /organization/employees`: admin employee directory with employee IDs, team assignments, organization roles, active state and assignment versions.
- `PUT /organization/employees/:id`: admin supplies employee_id, team_id, team_role and version. IDs are unique within the organization, including reservations from pending invitations. Changing teams requires reassignment/completion of open organization work.
- `GET /organization/work`: optional team_id, kind=brd/daily/version and mine=true. Returns the most recent 500 accessible items. Private-project access and team assignment are enforced before limiting results.
- `GET /organization/work/:id`: the accessible item, visible issue_ids and has_hidden_links. Hidden links are retained on edits.
- `POST /organization/work`: team_id, kind, title, owner_id; optional project_id, content (sanitized rich HTML), state, due_date, version_tag, issue_ids. States: draft/planned/active/review/done. Versions require version_tag. Project and linked-issue access are checked.
- `PATCH /organization/work/:id`: full work fields and required version; the team and kind cannot change. Author/owner/lead/admin and team capability checks apply.
- `DELETE /organization/work/:id?version=N`: same edit permissions and a matching version; removes the item and its traceability links, records an audit event, and broadcasts invalidation.

## Expansion endpoints

- `POST /auth/forgot-password`, `/auth/reset-password`, `/auth/verify-email`; `GET /account/security`; `POST /account/verification`.
- `POST /members/:id/deactivate` or `/reactivate`: admin only; owner/self safeguards and session revocation.
- `GET/PATCH /account/notifications`: per-event in-app/email preferences.
- `GET /issues/:id/people`, `PUT /issues/:id/watchers`, `DELETE /issues/:id/comments/:commentId`.
- `GET /project-templates`; `GET/POST/PATCH/DELETE /issue-templates`; template mutations require access and update/delete versions.
- `POST /issues/:id/move`: project_id, version, optional status_id; stable aliases preserve earlier keys. Hierarchy moves are rejected.
- `POST /issues/:id/rank`: version, before_id, after_id; validates adjacent anchors in the same project/cycle group.
- `GET/PUT /modules/:id/planning`: member assignment, dependency DAG and summary metrics; PUT requires version.
- `GET/POST /initiatives`, `PATCH /initiatives/:id`; `GET/PUT /sprints/:id/retrospectives`.
- `GET /search/issues?q=&project_id=&cursor=&limit=`: keyset pagination, max 200 results, MySQL full-text search.
- `GET /bootstrap?issue_limit=100&issue_cursor=...&project_id=...`: optional bounded issue page with issue_page.nextCursor. Omitting issue_limit retains the original complete bootstrap.
- `GET /reports/summary?project_id=&days=30`: scoped SQL aggregates; date window max 366 days.
