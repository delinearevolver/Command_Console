# Operations Management Panel Overview (Non-Technical)

## Why This Matters
- Gives leadership a simple way to add new initiatives, projects, and process checklists without waiting on developers.
- Keeps every screen in the Command Console instantly aligned so teams work from the same operating picture.
- Reduces risk of bad data by enforcing required links (each project must live under a program, each process under a project).

## What You Can Do Now
- Add a *Program* (top level mission or initiative) by typing the name and pressing **Create Program**.
- Add a *Project* by selecting the parent program first, then naming the project. The system remembers the relationship for reporting.
- Add a *Process* by choosing the parent project, naming the workflow, and optionally flagging a lead. Processes appear in dashboards and the Kanban board straight away.

## How It Works Behind the Scenes
1. You open the Operations Management panel from the dashboard (only visible to owners and admins).
2. The panel shows three short forms, labelled in whichever terminology set you picked (Standard or Imperial).
3. When you submit a form, the console quietly attaches your organisation ID so the record is scoped to your company.
4. Data is written into Firebase (our cloud database) with a timestamp for audit purposes.
5. Background monitors double-check new projects and processes. If something looks wrong (for example a missing parent project) the record is corrected or rejected before your team sees it.
6. The on-screen lists refresh automatically and a green confirmation message appears. No refresh button required.

## What You Will See
- A success banner when an item is created, or a yellow warning with guidance if anything failed.
- Dropdowns that only show valid parent options (you cannot create a project until a program exists, etc.).
- The Hierarchy, Kanban, and Gantt views update a few seconds after each submission.

## Safeguards in Place
- Role gating: only users flagged as Owner or Admin can access the panel.
- Automatic metadata fill: cloud functions ensure each record carries the correct organisation and parent references.
- Real time validation: if a parent item is missing, the panel prompts you to create it first instead of accepting incomplete data.

## Supporting Material
- BPMN process diagram: `docs/management-panel.bpmn` (open in Camunda Modeler for a visual walkthrough).
- Technical reference: see `src/App.jsx` around line 293 for the React component that powers the panel.

## Suggested Next Steps for Leadership
- Pilot the panel with one operational leader and capture feedback on terminology.
- Define naming conventions for Programs, Projects, and Processes to keep the hierarchy tidy.
- Review reporting dashboards after the first few entries to confirm the new items appear as expected.
- Align Firestore security rules to ensure only the intended roles can write to these collections.
