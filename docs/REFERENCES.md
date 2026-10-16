# Feature references and original implementation

Grace’s UI and application code were written independently for this workspace. No source repository was cloned, vendored, or used as a component implementation. References were used to understand product features and the PRD’s intended direction. Installing normal reusable dependencies is separate from copying another product’s application code.

## The five PRD references

- [ManagerOS](https://github.com/elmadah/manager-os): manager overview, capacity planning, standups, blockers, digest, and preview-first import. Grace starts these as small SQL-backed tools; advanced leave, private 1:1s, backup/restore, and direct Jira sync remain on the roadmap.
- [Plane](https://github.com/makeplane/plane), [work items](https://docs.plane.so/work-items/overview), and [saved views](https://docs.plane.so/core-concepts/views): issue-centered planning, cycles/sprints, configurable views, and project pages. Modules, advanced analytics, and an instance-admin console are planned.
- [Zyra](https://github.com/Farhodoff/zyra): real-time Kanban collaboration, project keys/colors, comments, and notification patterns. Grace uses relational SQL storage and workspace/project access checks.
- [OpenProject](https://github.com/opf/openproject) and its [user guide](https://www.openproject.org/docs/user-guide/): timeline planning, documentation, and logged time. Full Gantt dependencies, portfolio, meetings, cost reports, and integrations are later phases.
- [ProjectHub / project-management-app](https://github.com/zachloh/project-management-app): task/story/bug work, issue search, filters, roles, validation, and optimistic updates. Grace adds configurable columns, hierarchy, sprints, and field history.

This is not an assertion that every referenced feature is complete. See `IMPLEMENTATION.md` for the delivered scope and the remaining work. Reference licenses do not grant permission to reuse application code automatically; no such code was imported. Grace’s own distribution license remains a product-owner decision.

## Direct dependencies

The installed npm dependencies and exact versions are recorded in `package-lock.json`. Each dependency retains its own license. Lucide supplies the icon set; Tiptap supplies the rich text editor framework; dnd-kit supplies drag-and-drop; Recharts supplies charts. DM Sans and Manrope are bundled from Fontsource with their OFL-1.1 licenses rather than requested from a remote font service.
