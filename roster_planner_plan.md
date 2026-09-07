# Roster Planner — Implementation Plan

## 1. Overview

A fully serverless Progressive Web App (PWA) for preparing monthly staff rosters. Data is stored locally in IndexedDB and the static app can be hosted on GitHub Pages.

The system distinguishes a **proposal** from the **productive roster**. Generation and edits always happen in a proposal. A user explicitly accepts a validated proposal to promote it to productive status. Previous productive versions remain available as archived history.

Core requirements:

1. Import employee unavailability from the date chooser JSON format.
2. Generate or regenerate a proposal starting at a selected day of the month.
3. Allow manual proposal edits and preserve them, with minimal unnecessary changes, on regeneration.
4. Promote an accepted proposal to the productive roster without overwriting it during generation.

## 2. Technology

| Layer | Technology | Rationale |
| --- | --- | --- |
| Framework | Vanilla JS (ESM), HTML, CSS | Small, portable static application. |
| Build | Vite + `vite-plugin-pwa` | Good development experience and reliable production PWA output. |
| Routing | Hash routing | Compatible with GitHub Pages and no server configuration. |
| Storage | IndexedDB via `idb` | Browser-native, asynchronous persistence. |
| Import/export | JSON files | Portable local backups and availability-file import. |

## 3. Domain Rules

### 3.1 Calendar and availability

- All business dates are ISO calendar dates: `YYYY-MM-DD`; no time or timezone is stored.
- An employee is available by default. An availability entry makes a date or inclusive date range unavailable.
- Imported dates are unavailability dates.
- An employee assigned to a location may work only that location. An employee with `locationId: null` may work any location.
- An employee may have at most one shift on the same calendar day. Overnight-shift support is out of scope for v1; shifts belong to one roster date.

### 3.2 Staffing and targets

- `minStaff` is a coverage requirement. `maxStaff` is a limit.
- Employee work targets are balancing goals, not hard limits: when required coverage cannot otherwise be met, the generator may exceed a target and reports the deviation.
- The generator must never break availability, location, one-shift-per-day, locked-assignment, or `maxStaff` rules.
- A roster is ready to accept only when the user has reviewed coverage gaps, conflicts, and target deviations.

## 4. Data Model

Every persisted entity has a UUID `id` created with `crypto.randomUUID()`.

```ts
interface Location {
  id: string;
  name: string;
  createdAt: number;
}

interface Employee {
  id: string;
  name: string;                  // Display name; unique name is recommended for import matching
  locationId: string | null;     // null means the employee may work any location
  createdAt: number;
}

interface AvailabilityEntry {
  id: string;
  employeeId: string;
  startDate: string;             // YYYY-MM-DD, inclusive
  endDate: string;               // YYYY-MM-DD, inclusive
  status: 'unavailable';
  source: 'manual' | 'file-import';
  note?: string;
  importedAt?: number;
  createdAt: number;
}

interface ShiftRule {
  id: string;
  name: string;
  locationId: string | null;
  minStaff: number;
  maxStaff: number;
  appliesOn: {
    type: 'date-range' | 'weekdays';
    startDate?: string;
    endDate?: string;
    weekdays?: number[];         // 0–6, Sunday–Saturday
  };
}

interface ShiftInstance {
  id: string;
  date: string;                  // YYYY-MM-DD
  ruleId?: string;
  name: string;
  locationId: string | null;
  minStaff: number;
  maxStaff: number;
  assignments: ShiftAssignment[];
}

interface ShiftAssignment {
  id: string;
  employeeId: string;
  source: 'generated' | 'manual';
  locked: boolean;               // Never changed or removed by regeneration
  note?: string;
  createdAt: number;
  updatedAt: number;
}

interface Roster {
  id: string;
  name: string;
  year: number;
  month: number;                 // 1–12
  targetDaysWorked: number;
  daysWorkedTarget: Record<string, number>;
  productiveVersionId?: string;
  draftVersionId?: string;       // The editable current proposal, if one exists
  createdAt: number;
  updatedAt: number;
}

interface RosterVersion {
  id: string;
  rosterId: string;
  status: 'proposal' | 'productive' | 'archived';
  generatedFromDate?: string;    // First date affected by the last generation
  generatorSeed?: string;
  generatorConfig: GeneratorConfig;
  shifts: ShiftInstance[];
  coverageReport: CoverageReport;
  createdAt: number;
  updatedAt: number;
  acceptedAt?: number;
}

interface GeneratorConfig {
  preserveGeneratedAssignments: boolean; // “minimal changes” mode
}

interface CoverageReport {
  unfilledSlots: Array<{ shiftId: string; date: string; missing: number }>;
  conflicts: Array<{ assignmentId?: string; message: string }>;
  targetDeviation: Record<string, number>;
  generatedAt: number;
}
```

`ShiftRule` is a reusable default. A roster version stores materialized `ShiftInstance`s, so later rule changes do not rewrite historical or productive schedules.

## 5. IndexedDB Schema

Database: `rosterPlanner`, initial version 1.

| Store | Key path | Useful indexes |
| --- | --- | --- |
| `locations` | `id` | — |
| `employees` | `id` | `name`, `locationId` |
| `availabilities` | `id` | `employeeId`, `startDate`, `endDate` |
| `shiftRules` | `id` | `locationId` |
| `rosters` | `id` | `[year, month]` |
| `rosterVersions` | `id` | `rosterId`, `[rosterId, status]` |
| `settings` | `key` | — |

```ts
interface GlobalSettings {
  key: 'global';
  defaultTargetDaysWorked: number;
  defaultShiftRules: ShiftRule[];
}
```

All schema upgrades use IndexedDB migrations. Writes that change a roster and its current version occur in one transaction.

## 6. Availability File Import

The source format is defined in `D:\dates_chooser\JSON_FORMAT.md`:

```json
{
  "employee_name": "Ada Lovelace",
  "selected_dates": ["2026-10-03", "2026-10-14"]
}
```

The file is UTF-8 JSON and may contain a BOM. `selected_dates` is an ordered array of ISO date-only values; an empty array is valid.

### Import workflow

1. Read the file as text, remove a leading BOM, and parse JSON.
2. Validate the expected types: non-empty `employee_name` string and `selected_dates` array of unique, valid `YYYY-MM-DD` dates.
3. Match `employee_name` against employees by normalized name (trimmed, case-insensitive, normalized whitespace).
4. If there is no match or more than one match, do not change data; ask the user to choose the employee. The mapping applies only to the current import.
5. Display a preview: matched employee, dates to add, already-recorded dates, and dates that overlap manual entries.
6. On confirmation, add only missing unavailable dates with `source: 'file-import'`. Consecutive imported dates may be compacted into ranges only when they do not cross a manual-entry boundary.
7. Perform the change transactionally. Invalid input never causes a partial import.

An import is additive by default. A separate, clearly labelled “replace imported availability for this employee and month” action may be offered later; it must never delete manual entries.

```ts
function previewAvailabilityImport(file: File): Promise<AvailabilityImportPreview>;
function applyAvailabilityImport(previewId: string, employeeId: string): Promise<ImportResult>;
```

## 7. Proposal Generation and Regeneration

### 7.1 Version lifecycle

```text
no version → generate → proposal → accept → productive
                              │                 │
                              └─ regenerate     └─ archived when superseded
```

- `generateProposal` creates an editable proposal. It never modifies the productive version.
- If a proposal already exists, it is updated only after presenting its change summary.
- `acceptProposal` validates the proposal, archives the existing productive version, and promotes the proposal in one transaction.
- The newly productive version is read-only. To revise it, create a proposal copied from it.

### 7.2 Generation from a date

The user selects any date within the roster month, for example `2026-10-15`.

- Shifts and assignments before that date are retained exactly.
- On and after that date, all locked/manual assignments are retained.
- In minimal-changes mode, still-valid generated assignments on and after that date are retained where possible; the generator fills open staffing slots first and changes generated assignments only where necessary.
- The generator counts retained assignments before the selected date when balancing the rest of the month.
- The result includes a diff: added, removed, moved, preserved, and newly unfilled assignments.

```ts
function generateProposal(
  rosterId: string,
  options?: { seed?: string; preserveGeneratedAssignments?: boolean }
): Promise<RosterVersion>;

function regenerateProposalFrom(
  rosterId: string,
  fromDate: string,
  options?: { seed?: string; preserveGeneratedAssignments?: boolean }
): Promise<RosterVersion>;
```

### 7.3 Generator rules

1. Materialize the roster month’s shift instances from its rules when creating a new proposal.
2. Build an availability lookup and a retained-assignment baseline.
3. Validate retained assignments. Do not silently remove locks that now conflict with availability or location; report them as manual conflicts.
4. Process the most constrained shifts first: fewest eligible candidates, then highest `minStaff / maxStaff` ratio.
5. Candidates must be available, location-eligible, not already assigned that day, and compatible with locked assignments.
6. Rank candidates by days worked divided by their target. Use a seeded tie-breaker for reproducible results.
7. Fill to `minStaff` first. It may exceed work targets only to avoid an otherwise unfilled minimum-staffing slot.
8. Never assign above `maxStaff`; return all unfilled slots and deviations in `CoverageReport`.

The seed and generator configuration are stored on the proposal, so results can be reproduced and explained.

## 8. Manual Editing

Editing is supported only in a proposal:

- Add an employee to a shift, remove an employee, swap two assignments, or reassign an employee to another same-day shift.
- Every user-created or changed assignment becomes `source: 'manual'` and `locked: true` by default.
- The editor validates availability, location, daily duplicate assignment, and maximum staffing. The user may explicitly override a validation warning only with a recorded note.
- A user may unlock an assignment to make it generator-managed again.
- Before accepting or regenerating, show conflicts rather than modifying manual entries silently.

```ts
function editProposalAssignment(versionId: string, change: AssignmentChange): Promise<RosterVersion>;
function setAssignmentLock(versionId: string, assignmentId: string, locked: boolean): Promise<RosterVersion>;
function acceptProposal(versionId: string): Promise<RosterVersion>;
```

## 9. Application Architecture

```text
src/
  db/                 IndexedDB opening, migrations, entity repositories
  core/
    availability.js   Date-range checks and import normalization
    import.js         File parsing, validation, previews, transactional apply
    generator.js      Deterministic proposal generation and diff calculation
    validation.js     Coverage and assignment validation
    versions.js       Proposal, acceptance, archive lifecycle
  components/         Header, modal, table, roster grid, diff panel
  views/              Locations, Employees, Availability, Rosters, RosterDetail, Settings
  state.js            Small pub/sub state layer
  utils.js            UUID, ISO-date, seed, and immutable-copy helpers
```

Routes:

```text
#/locations
#/employees
#/availability
#/rosters
#/roster/:id
#/roster/:id/proposal/:versionId
#/settings
```

## 10. User Interface

### Availability

- Show manual and imported unavailable dates distinctly.
- Provide “Import availability JSON”, preview, employee-match resolution, confirmation, and result summary.
- Continue to support manual range entry.

### Roster list

- Show the productive version status, whether a proposal is pending, and coverage status.
- Actions: create roster, create proposal from productive version, open proposal, and view productive version.

### Proposal detail

- Calendar grid with dates as columns and employees as rows.
- Separate actions: “Generate whole month”, “Regenerate from date”, “Review changes”, and “Accept proposal”.
- Make locked/manual cells visually distinct.
- Show coverage gaps, conflicts, target deviations, and the generated-change diff before acceptance.

### Productive detail

- Read-only calendar grid, version metadata, and option to create a new proposal based on it.

## 11. Backup Import and Export

Export all application entities with a schema version and timestamp. Include roster versions, not only a single mutable roster.

Backup import must validate the schema before writing. It should offer:

- **Replace all data** — clearly warned, after automatically downloading a safety backup.
- **Cancel** — leaves all data unchanged.

Do not use the application-backup importer for availability chooser files; they are different formats and have separate UI actions.

## 12. PWA and Deployment

Use Vite with `vite-plugin-pwa`; it generates the service worker and precache manifest from the build output. Configure the Vite `base` to the GitHub repository path and deploy `dist` via GitHub Actions.

The PWA should notify users when a new version is available and avoid caching obsolete IndexedDB migration code indefinitely.

## 13. Implementation Order

| Phase | Tasks | Deliverable |
| --- | --- | --- |
| 1. Foundation | Vite, PWA, IndexedDB opening/migrations, base UI | Installable app shell. |
| 2. Master data | Location and employee CRUD, name uniqueness warning | Usable employee catalogue. |
| 3. Availability | Manual availability, date-chooser JSON import preview/apply | Safe availability management. |
| 4. Shift rules | Reusable rules and roster-month materialization | Correct shift instances. |
| 5. Version model | Roster/version repositories and productive/proposal lifecycle | No in-place production mutation. |
| 6. Generator | Seeded generation, validation, coverage report, full-month proposal | Reviewable generated proposal. |
| 7. Regeneration | From-date regeneration, locked baseline, minimal-change diff | Safe partial regeneration. |
| 8. Manual editing | Edit/swap/reassign/lock UI and validation | Preserved human decisions. |
| 9. Acceptance | Acceptance checks, atomic promotion, archive history | Productive roster workflow. |
| 10. Backup and polish | Backup/restore, responsive layout, errors, accessibility, print view | Production-ready PWA. |

## 14. Important Edge Cases

| Scenario | Expected behavior |
| --- | --- |
| No eligible employee for a shift | Leave slot unfilled and flag it. |
| Duplicate employee names in availability file | Require user mapping; never guess. |
| Empty `selected_dates` | Valid no-op import, shown in preview. |
| Invalid date or duplicate date in file | Reject before any data is changed. |
| Imported date overlaps a manual range | Preserve manual entry and show duplicate/no-op information. |
| Manual assignment becomes unavailable | Retain it, flag conflict; do not silently delete it. |
| Re-generation starts mid-month | Preserve prior dates and locked decisions; balance using prior workload. |
| New productive version accepted | Archive the prior productive version in the same transaction. |
| Multiple browser tabs | Notify through `BroadcastChannel` and reload stale views before editing. |
| IndexedDB write failure | Abort the transaction and show an actionable error. |
