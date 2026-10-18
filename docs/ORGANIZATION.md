# Organization setup

Grace uses the existing SQL workspace as the organization boundary. An employee belongs to an organization, has an employee ID unique within that organization, and has an admin-assigned team dashboard and team role. Employee IDs are identifiers, not passwords.

## Start and assign teams

1. Register an organization, or open the local demo. An organization owner opens the organization overview after sign-in. New organizations start with Frontend, Backend, Quality assurance, Human resources, Administration and General dashboards.
2. Open **Teams & privileges → Team dashboards**. Create a custom team or configure its description, color, visible sections and lead/member editing privileges.
3. Open **Employee assignments** to edit employee IDs, team assignments and team roles. Existing accounts receive stable generated IDs. Existing demo employees are assigned to demonstration teams; existing non-demo members start in General, with organization admins in Administration.
4. Use **Invite an employee** to reserve an employee ID, team and role before registration. Share the generated link with that employee. The link is bound to their email, expires after seven days and can be revoked from Administration. The invitation screen supplies the assigned ID; a registrant cannot select their own team or elevate their role.
5. Share the organization code shown on this page. Employees can sign in with **Employee ID + organization code + password** or with their email and password. The home route takes members to their assigned dashboard. An admin can open every team dashboard.

Team leads and members receive the capabilities configured for that team. Default leads can edit all work types; members can edit project work, BRDs and daily tasks; viewers are read-only. Organization owners/admins retain full team access. Existing organization/project permissions still apply: a team role never grants access to a private project. Dashboard section visibility controls layout; editing capabilities control server-side mutations. Employees can edit work they own or created, while leads/admins can edit other team items.

Reassign or complete an employee’s open BRDs, daily tasks and versions before transferring them to another team. Organization roles and deactivation remain in Administration. Employee IDs can be reused in a different organization because sign-in includes the organization code.

## Work and creation

The global **Create** button and **C** shortcut open a chooser for issues, bugs, new features, BRDs, daily tasks and versions. Features are implemented as story issues with a Feature label. Team project work is grouped by the assignee’s team, falling back to the reporter’s team for unassigned work.

BRDs have a structured rich-text starting template. Daily tasks track an owner, date and state. Versions add a version tag and release notes; Done displays as Released. All three support optional project association, linked issues, server sanitization, stale-edit protection, and author/owner/lead/admin editing. Restricted project links remain hidden and are preserved when another authorized team member saves an item.

My Work provides assigned, created and completed views, search, and separate sections for every work type. Click anywhere on a work card to open it. Project board cards drag from their entire surface with a six-pixel mouse threshold or a short touch-and-hold. Enter opens a focused board card, Space starts/drops movement, arrow keys move it, and Escape cancels.

## Email and database operations

Configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_REQUIRE_TLS`, `SMTP_USER`, `SMTP_PASSWORD` and `SMTP_FROM` in `.env`, then restart the API. `APP_ORIGIN` determines verification/recovery links. Verification is enforced for writes in production; `AUTH_REQUIRE_VERIFIED=true` enables it locally. SMTP credentials and verification/reset tokens are never sent to the client as configuration. Pending invitations still use manually shared links.

Set a separate `BACKUP_KEY` of at least 32 characters before running `npm run db:backup -- create path.gracebackup`. Restore with `npm run db:backup -- restore path.gracebackup` against an empty target database. Restoring does not overwrite populated databases, reactivates no old sessions, and consumes outstanding account tokens. Back up `data/uploads` separately; the encrypted database backup contains SQL records only. Keep the key separately from the backup.

No deployment or Docker Compose configuration is required for this phase.
