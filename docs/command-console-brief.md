# Command Console Briefing

## Executive Snapshot
- Mission control layer for owners and operators managing programs, projects, processes, and tasks across a single Firebase organization.
- Real time Firestore feeds drive Hierarchy, Kanban, Gantt, and P&L views so leaders see the same truth their teams update.
- Workflow and governance are encoded in BPMN (`docs/command-console.bpmn`) for Camunda Modeler; automation hooks already live in Cloud Functions.

## Stakeholder Roles
- Owner: creates the organization during sign up, sets lexicon, and has full access to admin and automation features.
- Admin: shares owner privileges on user governance and operations curation, but cannot change owner level settings.
- Manager: plans and executes within assigned projects and processes; moves work on Kanban and timelines.
- Worker: actioning individual tasks; visibility scoped to assigned workstreams.
- Automation: Firebase Cloud Functions that harden data, propagate metadata, and sync Google Calendar signals.

## Customer Journey Highlights
1. User lands on the React console, authenticates with Firebase Auth, or provisions a new org via the onboarding batch write.
2. The UI subscribes to `programs`, `projects`, `processes`, `tasks`, and `users` collections filtered by `orgId` for live updates.
3. Hierarchy dashboard surfaces the nested roadmap while P&L stays visible on the right rail for budget conversations.
4. Operators execute on the Kanban board; dragging cards writes status updates that ripple through the hierarchy and Gantt.
5. Admins flip to the Admin Control Panel to assign project/process access and, when authorized, grow into multi-org management via callable functions.
6. Automations enforce metadata integrity (`ensureUserDefaults`, `hardenProjectContext`, `syncProcessMetadata`, `syncTaskMetadata`) and sync Google Calendar inbox items every 15 minutes once tokens are stored.

## Core Product Surfaces
- Authentication & Terminology: login or owner signup with Firestore batch seeding; terminology toggle switches between Standard and Imperial lexicon without data churn.
- Hierarchy Dashboard: expandable programs with project and process drill downs; shows unassigned tasks so nothing falls through.
- Kanban Board: drag and drop across To Do, In Progress, Done columns backed by Firestore `status` field updates.
- Gantt Dashboard: calculated timeline using task start/end metadata with "now" rail and unscheduled counter.
- Admin Control Panel: roster view plus clearance toggles that call `updateDoc` on user assignments.
- Accounts View: guarded by `delinearevolver@gmail.com` to create orgs (`createOrganization`) and assign admins (`assignOrganization`).
- P&L Display: reserved sidecard for financial telemetry (component stubbed as `PLDisplay`).
- RAG Console (optional): callable Functions backed chat entry point for retrieval augmented responses already scaffolded.

## Data & Automation Architecture
- Firebase Auth stores user identity; Firestore persists org scoped content under collections (`orgs`, `users`, `programs`, `projects`, `processes`, `tasks`, `organizations`).
- React providers (`AuthProvider`, `DataProvider`, `TerminologyProvider`) hydrate context and normalize roles (owner/admin/manager/worker).
- Firestore listeners stream into state; batched writes keep org creation atomic; `updateDoc` manipulates assignments and Kanban transitions.
- Callable Functions mediate privileged actions: organization creation/assignment, Google OAuth URL generation, RAG queries.
- Scheduled Function `syncCalendarEvents` hydrates company inbox feeds with calendar events for connected users.

## Security & Governance
- Role normalization enforces capability checks: only owner/admin reach admin panes; only specific email can spawn organizations through Functions.
- Cloud Functions validate referential integrity and sanitize status values to keep analytics consistent.
- Firestore rules (see `firestore.rules`) should mirror the in-app role logic; callable Functions double check server side auth claims.

## KPIs & Business Outcomes
- Operational velocity: cycle time per status hop (Kanban) and schedule variance (Gantt) surfaced to leadership.
- Workforce engagement: active users by role, tasks touched per day, number of clearance changes.
- Expansion leverage: organizations created, cross-org assignments, integrations activated.
- Automation lift: calendar events ingested, defaulting corrections made by Functions, response times from RAG console when enabled.

## Risks & Next Steps
- Frontend currently imports `db` from `App.jsx` without export; expose `export const db` to stabilize Admin panel interactions.
- `ManagementPanel` reference is unresolved; implement or remove to avoid runtime errors in Hierarchy dashboard.
- Build out `PLDisplay` to surface standardized revenue, cost, margin metrics for exec reporting.
- Harden UI pathways for Google OAuth connect/disconnect so the automation lane translates into user facing value.
- Validate Firestore security rules against the updated multi-role model before broad rollout.

## How To Use This Asset
- Load `docs/command-console.bpmn` in Camunda Modeler to walk stakeholders through the lifecycle during enablement.
- Pair the BPMN with this brief when pitching to prospects: start with Executive Snapshot, then trace the journey, then zero in on the KPIs they care about.
- Feed learnings back into backlog: unresolved risks above are the first follow ups before GA or partner demos.
