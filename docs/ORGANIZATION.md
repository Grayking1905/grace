# Organization setup

Grace uses the existing SQL workspace as the organization boundary. An employee belongs to an organization, has an employee ID unique within that organization, and has an admin-assigned team dashboard and team role. Employee IDs are identifiers, not passwords.

## Start and assign teams

1. Register an organization, or open the local demo. An organization owner opens the organization overview after sign-in. New organizations start with Frontend, Backend, Quality assurance, Human resources, Administration and General dashboards.
2. Open **Settings → Teams & roles → Team dashboards** (also available through **More tools → Manage organization**). Create a custom team or configure its description, color and visible sections. Expand **Advanced role permissions** when editing capability rules.
3. Open **Employee assignments** to edit employee IDs, team assignments and team roles. Existing accounts receive stable generated IDs. Existing demo employees are assigned to demonstration teams; existing non-demo members start in General, with organization admins in Administration.
4. Use **Invite an employee** to reserve an employee ID, team and role before registration. Share the generated link with that employee. The link is bound to their email, expires after seven days and can be revoked from Administration. The invitation screen supplies the assigned ID; a registrant cannot select their own team or elevate their role.
5. Share the organization code shown on this page. Employees can sign in with **Employee ID + organization code + password** or with their email and password. Home shows their team overview; **Open team** opens the detailed team dashboard. An admin can open every team dashboard.

Team Managers oversee their own team: they can edit its dashboard layout, assign work, and change ordinary employees between lead/member/viewer roles. Only organization admins can appoint or demote managers, change employee IDs, transfer employees, invite employees, or change team capability rules. Managers cannot edit their own role, another manager, an organization admin, or another team’s employees. Dashboard and employee edits require the current version to prevent overwriting concurrent changes.

Team Managers, leads and members receive the editing capabilities configured for that team. Default managers and leads can edit all work types; members can edit project work, BRDs and daily tasks; viewers are read-only. Organization owners/admins retain full team access. Existing organization/project permissions still apply: a team role never grants access to a private project. Dashboard section visibility controls layout; editing capabilities control server-side mutations. Employees can edit work they own or created, while managers/leads/admins can edit other team items. Migration 8 adds manager capability defaults to existing teams without changing employee assignments or existing role rules.

Reassign or complete an employee’s open BRDs, daily tasks and versions before transferring them to another team. Organization roles and deactivation remain in Administration. Employee IDs can be reused in a different organization because sign-in includes the organization code.

## Work and creation

The global **Create** button and **C** shortcut open a chooser for issues, bugs, new features, BRDs, daily tasks and versions. Features are implemented as story issues with a Feature label. Team project work is grouped by the assignee’s team, falling back to the reporter’s team for unassigned work.

BRDs have a structured rich-text starting template. Daily tasks track an owner, date and state. Versions add a version tag and release notes; Done displays as Released. All three support optional project association, linked issues, server sanitization, stale-edit protection, and author/owner/lead/admin editing. Restricted project links remain hidden and are preserved when another authorized team member saves an item.

My Work combines issues, bugs, features, BRDs, daily tasks and versions in one searchable list. Use Type and View to switch between work types and assigned/created/completed work. Click anywhere on a work row to open it. The circle action completes an editable issue or daily task with the current version; completed tasks remain accessible in Completed. Team dashboards use Overview, Project work, Daily tasks, BRDs and Versions tabs according to their configured sections.

The sidebar keeps Home, My work, Projects, Teams/My team, Documents and Inbox prominent. Reports remain directly accessible; More tools opens Portfolio, Saved views, Issue templates, Team planning, People directory and permitted management tools. Advanced issue fields and daily-task notes are collapsible. Copy links and digests provide selectable text if automatic clipboard access fails.

Project board cards drag from their entire surface with a six-pixel mouse threshold or a short touch-and-hold. Enter opens a focused board card, Space starts/drops movement, arrow keys move it, and Escape cancels.

## Live Home overview

Admins see organization-wide issue completion, project coverage, team delivery, overdue work and connected members. Members, viewers, team leads and Team Managers receive a Home overview scoped to their assigned team and accessible projects. Team and project filters apply before aggregation; private projects remain restricted even when assigned to a team.

Use **Assign teams** on an admin Home project card to set explicit project ownership. These assignments are versioned and do not grant private-project access. Projects can also appear through existing member/lead assignments, team-owned issues or organization work; those cards say **Linked through people or work** until a team is explicitly assigned.

Completion percentages and status distribution describe current visible issues. BRDs, daily tasks and versions have a separate completion count. Delivery activity charts show issue creation and completed transitions, counting a given issue once per UTC day; an issue reopened and completed on different days contributes to each day's activity. Current project/team/access scope applies to historical issue activity, so moved issues follow their current scope. The 7/14/30-day selector controls the chart and activity feed; current progress counts cover all current work.

Activity includes successful sign-ins/sign-outs and supported work changes: issue/bug/feature creation, edits and status changes, comments, assignments, linked work, attachments, time logs, documents, BRDs, daily tasks, versions, projects, team configuration, cycles, modules, risks and check-ins. Click issue or team-work events to open their record; use type/member filters or **Load earlier activity** to browse the feed. Raw comment bodies, passwords, session credentials and audit details are excluded. Access is checked before pagination; earlier issue events are hidden if the issue moves into a restricted project.

Successful sign-ins are recorded from this update onward. Migration 9 imports up to 1,000 recent existing issue-history metadata records and adds project/team assignment and Home activity tables without changing saved work. It cannot reconstruct earlier sign-ins that were never recorded. **Online** means an authenticated, connected Grace browser session; multiple tabs count as one person. The feed is saved in SQL, while connected status is local to the running API instance. Home refreshes from real-time invalidation and every 15 seconds as a fallback, with reconnection checks after server interruptions. Multi-instance presence aggregation remains a later scaling task.

## Email and database operations

Configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_REQUIRE_TLS`, `SMTP_USER`, `SMTP_PASSWORD` and `SMTP_FROM` in `.env`, then restart the API. `APP_ORIGIN` determines verification/recovery links. Verification is enforced for writes in production; `AUTH_REQUIRE_VERIFIED=true` enables it locally. SMTP credentials and verification/reset tokens are never sent to the client as configuration. Pending invitations still use manually shared links.

Set a separate `BACKUP_KEY` of at least 32 characters before running `npm run db:backup -- create path.gracebackup`. Restore with `npm run db:backup -- restore path.gracebackup` against an empty target database. Restoring does not overwrite populated databases, reactivates no old sessions, and consumes outstanding account tokens. Back up `data/uploads` separately; the encrypted database backup contains SQL records only. Keep the key separately from the backup.

No deployment or Docker Compose configuration is required for this phase.
