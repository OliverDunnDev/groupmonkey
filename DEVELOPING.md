# GroupMonkey: developer guide

Everything you need to pick this project up cold: how to run it, how it is put together, why it is the way it is,
the traps already hit, and where to take it next. For a short overview and the demo walkthrough see [README.md](README.md).

Contents: [1 Status](#1-status) · [2 Setup](#2-setup-on-a-new-machine) · [3 Repo map](#3-repo-map) · [4 Architecture](#4-architecture) ·
[5 Backend](#5-backend) · [6 Frontend](#6-frontend) · [7 AI agents](#7-ai-agents) · [8 Testing](#8-testing) ·
[9 Gotchas](#9-gotchas-and-lessons-learned) · [10 Configuration](#10-configuration-reference) · [11 Roadmap](#11-roadmap) ·
[12 Recipes](#12-recipes) · [13 Troubleshooting](#13-troubleshooting)

---

## 1. Status

A working web app: .NET 10 minimal API + React 19 (Vite, TypeScript). **All data is mock and in-memory** (it resets
whenever the API restarts), logins are seeded demo users, and there is no database.

| Area | State |
| --- | --- |
| Projects, groups, tasks (kanban with drag and drop), goals, progress tracking | Done |
| Mock login (JWT), roles Admin / Manager / Member, access rules | Done |
| Flat, sharp, comic-book UI (yellow / black / white, heavy borders) | Done |
| Optional AI agents: assign tasks to Claude-powered teammates, approvals, run timeline, admin key screen | Done |
| Real Claude calls | **Written and tested against a fake server only.** Never run with a live key. Do this first at home. |
| Persistence (database) | Not started |
| Real auth (hashing, registration, SSO) | Not started |
| Desktop packaging (Tauri/Electron) | Not started (web version was the first goal) |
| CI | A GitHub Actions workflow is included (`.github/workflows/ci.yml`) but has not run on GitHub yet |

Verified at hand-off: `dotnet test` 54 passing; `npm run build` and `npm run lint` clean.

---

## 2. Setup on a new machine

**Prerequisites**

- .NET SDK **10.0** (`dotnet --version` should print 10.x). The project targets `net10.0`.
- Node.js **22+** (built and tested with 24).
- git.

**Run**

```bash
git clone <your-repo-url> groupmonkey && cd groupmonkey

# terminal 1: API on http://localhost:5080
dotnet run --project src/GroupMonkey.Api

# terminal 2: UI on http://localhost:5173 (proxies /api to the API)
cd web
npm install
npm run dev
```

Open http://localhost:5173 and pick a demo user on the login page (all use password `password123`):

| User | Email | Role |
| --- | --- | --- |
| Ava Admin | admin@groupmonkey.dev | Admin |
| Marcus Manager | manager@groupmonkey.dev | Manager |
| Priya Patel | member@groupmonkey.dev | Member |
| Sam Okafor | sam@groupmonkey.dev | Member |

**Check everything works**

```bash
dotnet test                                  # 54 tests
cd web && npm run build && npm run lint
```

**First things to try**

1. Log in as Ava, drag cards on a project board, watch progress change on the Overview tab.
2. Open **AI settings**, switch AI **ON**, assign a task to **Scout**, reopen the task to see the run (demo mode).
3. Paste a real Claude API key under AI settings, press **Test connection**, repeat step 2 for a real run.

**Editor notes.** The solution file is `GroupMonkey.slnx` (the new XML solution format, supported by recent Visual Studio,
Rider and `dotnet`). VS Code with the C# Dev Kit works. `.claude/launch.json` holds dev-server definitions used by Claude Code's preview pane; it is harmless otherwise.

---

## 3. Repo map

```
GroupMonkey.slnx
README.md                    short overview + demo walkthrough
DEVELOPING.md                this file
CLAUDE.md                    context for Claude Code sessions
.github/workflows/ci.yml     build + test + lint on push/PR

src/GroupMonkey.Api/         .NET 10 minimal API
  Program.cs                 composition root: DI, JWT, CORS, Data Protection, route mapping
  Models/
    Models.cs                core entities + enums (User, Group, Project, TaskItem, Goal)
    AiModels.cs              AI entities (AgentConfig, AgentRun, RunStep, ProposedAction, TaskComment) + AgentTools names
    Dtos.cs                  request/response records, including AI DTOs
  Data/
    DataStore.cs             the in-memory "database": lists, id counters, one lock
    SeedData.cs              demo users, projects, tasks, goals, demo agents and their history
  Services/
    Auth.cs                  JWT creation + the Access rules (CanView / CanEdit / CanManage)
    Progress.cs              progress/summary calculations and entity -> DTO mapping
  Endpoints/
    ApiEndpoints.cs          auth, users, projects, groups, tasks, goals
    AiEndpoints.cs           AI settings, agents, comments, runs, approvals
  Ai/
    AiSettingsStore.cs       feature flag, default model, API key (encrypted at rest)
    ProjectTools.cs          THE tool layer agents use + ToolCatalog (tool schemas)
    AgentModels.cs           IAgentModel, MockAgentModel, ClaudeAgentModel, AgentRunContext
    AgentRunService.cs       background queue/executor for runs
  Properties/launchSettings.json   `http` profile on :5080

tests/GroupMonkey.Api.Tests/
  ApiTests.cs                core API behaviour (11 tests)
  GroupTests.cs              groups: membership, visibility, project creation, assignment rules (13 tests)
  AiTests.cs                 AI feature + tool-layer safety (25 tests)
  ClaudeLoopTests.cs         real Claude loop against a FakeClaude server (5 tests)

web/                         React 19 + Vite 8 + TypeScript
  vite.config.ts             dev server :5173, proxy /api -> API_URL or :5080
  src/
    main.tsx, App.tsx        entry, router, QueryClient
    auth.tsx                 AuthProvider / useAuth
    types.ts                 TS mirrors of API DTOs + label tables
    api/client.ts            fetch wrapper, token storage, error handling
    api/hooks.ts             ALL TanStack Query hooks (core + AI)
    components/              Shell, ui primitives, modals, TaskActivity, Approvals
    pages/                   Login, Dashboard, Groups (top level), ProjectPage (+ tabs), Agents, AiSettings
    styles/tokens.css        design tokens
    styles/global.css        every style in the app (single file, plain CSS)
```

---

## 4. Architecture

```
Browser (React)                           .NET API (src/GroupMonkey.Api)
┌───────────────────────┐   /api/*        ┌──────────────────────────────────────────┐
│ pages + components    │ ─────────────▶  │ JWT auth ─▶ Endpoints (ApiEndpoints,      │
│ TanStack Query hooks  │  (Vite proxy    │             AiEndpoints)                  │
│ api/client.ts (fetch) │   in dev)       │   │                                       │
└───────────────────────┘ ◀─────────────  │   ▼ lock(store.Sync)                      │
                                          │ DataStore (in-memory lists)  ◀── SeedData │
                                          │   ▲                                       │
                                          │   │ tools (ProjectTools)                  │
                                          │ AgentRunService (BackgroundService)       │
                                          │   └─▶ MockAgentModel | ClaudeAgentModel ──┼─▶ Claude API
                                          └──────────────────────────────────────────┘
```

Key decisions:

- **One in-memory store, one lock.** `DataStore` holds plain `List<T>`s. Every endpoint takes `lock (store.Sync)` while
  it reads or writes, usually through the helpers `InProject` / `ForTask` (see 5.3). Simple and correct for a single process;
  it is the first thing to replace when you add a database (11.1). The AI runner runs on background threads and takes the
  same lock for each tool call; it never holds it while waiting on the network.
- **Entities are mutable classes, DTOs are records.** Endpoints mostly map entities to DTOs. Exceptions: task endpoints return
  the `TaskItem` entity directly.
- **JSON enums are strings** (`JsonStringEnumConverter` in `Program.cs`), so the front end sees `"InProgress"`, not `1`.
- **The browser only ever talks to `/api`.** In dev Vite proxies it; in production serve the built `web/dist` from the same origin
  (or set `VITE_API_URL` at build time and rely on CORS).
- **Auth** is a JWT (`sub`, `role`, `name` claims) issued by `POST /api/auth/login`, stored in `localStorage`, sent as a
  Bearer token. A 401 anywhere signs the user out (`api/client.ts` fires an event that `auth.tsx` listens for).

---

## 5. Backend

### 5.1 Domain model (`Models/Models.cs`)

| Entity | Notes |
| --- | --- |
| `User` | `Kind` is `Human` or `Agent`. Agents are users with no password and cannot log in. Passwords are **plain text** (mock only). |
| `Group` | **The top level.** A team: `Name`, `Description`, `Color`, `OwnerId` (the manager who created it), `MemberIds` (people, and agents when AI is on). Managers set groups up and choose the members. |
| `Project` | Lives in **exactly one group** (`GroupId`, fixed at creation). `OwnerId` is the creator. It has **no member list of its own**: its members are its group's members (`DataStore.MembersOf`). Status `Planning/Active/OnHold/Completed`, dates. |
| `TaskItem` | `Status` (`Todo/InProgress/Review/Done`), `Priority`, optional `AssigneeId` (must be a member of the project's group), `GoalId`, `DueDate`. |
| `Goal` | Per project. Progress is **derived** from linked tasks (done / total). It stores no percentage. |

```
Group (team + members)  ──┬─ Project ──┬─ Task  (assigned to a member of the group)
                          │            └─ Goal  (progress from its tasks)
                          └─ Project ...
```

This mirrors Azure DevOps-style structure. (An earlier version had "groups" as sub-teams *inside* a project; that concept was removed,
and `Task.GroupId` no longer exists.)

Progress (`Services/Progress.cs`): group / project / goal percent = rounded `done / total` of the relevant tasks (a group rolls up all its projects);
`ProjectSummary` adds per-status counts, per-member workload (the group's members), and the overdue count (not Done and due before today).

### 5.2 Roles and access (`Services/Auth.cs`)

| Rule | Who |
| --- | --- |
Access is decided **by the group**; projects inherit it (`Access.CanView/CanManage/CanEdit(store, user, project)` just look up the project's group).

| Rule | Who |
| --- | --- |
| `CanViewGroup` (and so see its projects, tasks, goals) | Admin, the group's owner, or a member |
| `CanManageGroup` (change members, edit the group, create/edit/delete **projects** and **goals** in it, approve agent proposals, put agents in it) | Admin, the owner, or a **Manager** who is a member |
| `CanEditGroup` (delete the group) | Admin or the owner only |
| Create a group | Admin or Manager (not Member). The creator becomes owner and is added as a member. |
| Create a project | Must `CanManageGroup` the target group |
| Create/edit/move/delete tasks, comment | Anyone who can view the project (group members) |
| Assign a task | Only to members of the project's group |
| AI settings | Admin only |
| Create agents | Admin or Manager (into groups they manage); edit/delete an agent: Admin, or the Manager who created it |

Anything you cannot view returns **404** (not 403) so existence isn't leaked. Failing a manage/edit check while able to view returns 403.
For projects, `Level.Edit` and `Level.Manage` are the same check (can manage the group).
Removing someone from a group **unassigns their tasks** in that group's projects (the work itself is untouched). The owner can't be removed.

### 5.3 Endpoint conventions

`ApiEndpoints.InProject(store, principal, projectId, level, (me, project) => result)` does: take the lock, resolve the
current user, find the project, 404 if the user can't view it (via its group), 403 if they lack the required `Level`
(`View` / `Manage` / `Edit`), then runs your delegate **inside the lock**. `ForTask` does the same starting from a task id,
`InGroup` does it for group endpoints, and `ForGoal` for goals. New endpoints should use these, not hand-roll the checks.
Cascades live on the store: `DataStore.DeleteTask` / `DeleteProject` also remove comments, agent runs and proposals.

### 5.4 Endpoint reference

All routes are under `/api` and need a Bearer token unless marked anonymous.

| Method + path | Purpose | Access |
| --- | --- | --- |
| `POST /auth/login` | email + password -> `{token, user}` | anonymous; humans only |
| `GET /auth/me` | current user | any |
| `GET /users` | all users (agents only while AI is on) | any |
| `GET /groups`, `POST /groups` | groups you belong to (with project/task rollups); create (owner = creator) | view / Admin+Manager |
| `GET /groups/{id}` | one group | view |
| `PUT /groups/{id}` | edit name/description/colour; `memberIds` replaces the member list (owner always kept) | Manage |
| `DELETE /groups/{id}` | delete the group **and its projects**, tasks and goals | owner / Admin |
| `POST/DELETE /groups/{id}/members/{userId}` | add / remove a member (removing unassigns their tasks) | Manage |
| `GET /projects`, `POST /projects` | projects in groups you can see; create (body needs `groupId`) | view / Manage the group |
| `GET /projects/{id}` | read (includes `groupId`, `groupName`, derived `memberIds`) | view |
| `PUT/DELETE /projects/{id}` | edit (group can't change) / delete (cascades) | Manage |
| `GET /projects/{id}/summary` | `ProjectSummary` | view |
| `GET/POST /projects/{id}/tasks` | list / create (assigning to an agent starts a run) | view |
| `PUT/DELETE /tasks/{id}` | edit / delete | view |
| `PATCH /tasks/{id}/status`, `PATCH /tasks/{id}/assignee` | board drag; reassign (may start a run) | view |
| `GET/POST /projects/{id}/goals` | list (with progress) / create | view / Manage |
| `PUT/DELETE /goals/{id}` | edit / delete (tasks are unlinked) | Manage |
| **AI** (all return 404 unless AI is enabled, except where noted) | | |
| `GET /ai/status` | `{enabled, mode}`; works whether or not AI is on | any |
| `GET/PUT /admin/ai`, `POST /admin/ai/test` | settings (key write-only), connection test | Admin |
| `GET /agents/templates` | the four starter templates | any |
| `GET/POST /agents`, `PUT/DELETE /agents/{id}` | list / create / edit / delete agents | see 5.2 |
| `GET/POST /tasks/{id}/comments` | thread; a human reply can resume an agent that asked a question | view |
| `POST /tasks/{id}/run`, `GET /tasks/{id}/runs` | run the assigned agent now; run history (with steps, actions) | view |
| `GET /runs/recent`, `GET /runs/{id}`, `POST /runs/{id}/cancel` | activity feed; one run; cancel | view |
| `GET /approvals`, `POST /approvals/{id}/approve` or `/reject` | pending proposals; decide | Manage |

### 5.5 Seed data (`Data/SeedData.cs`)

Tests and docs rely on these ids, so change them with care:

- Users: 1 Ava (Admin), 2 Marcus (Manager), 3 Priya, 4 Sam, **5 Scout** and **6 Patch** (agents).
- Groups: **1 Web Team** (owner Marcus; Ava, Marcus, Priya, Sam, Scout, Patch), **2 Mobile Team** (owner Marcus; Marcus, Priya, Sam, Scout, Patch),
  **3 Platform & Ops** (owner Ava; Ava, Marcus, Sam; no agents).
- Projects: 1 Website Relaunch (Web Team; tasks 1-10), 2 Mobile App v2 (Mobile Team; tasks 11-18), 3 Internal Tooling (Platform & Ops; tasks 19-23).
  Priya sees projects 1 and 2; Sam and Marcus see all three; Ava (Admin) sees everything.
- Task 7 "Write redirect map" is assigned to Scout and 17 "Device matrix test plan" to Patch, with a seeded run, comments, and one pending
  proposal (Scout wants to move task 7 to Review). Task 8 "Image optimisation pipeline" (Todo, assigned to Sam) is the usual test target.
- Dates are relative to today, so the "1 overdue" in project 1 (Accessibility audit) stays true.

---

## 6. Frontend

### 6.1 Structure and data flow

- **Routing** (`App.tsx`): `/login`; everything else sits under `Shell` (sidebar + auth guard that redirects to `/login` and back).
  `/groups` is the top-level group page. `/projects/:id` renders `ProjectPage` with tab routes `index` (Overview), `board`, `goals`. `/agents` and `/admin/ai` are the AI pages.
- **Server state is TanStack Query only.** There is no other global store. All hooks live in `api/hooks.ts`.
  - Query-key convention: project data is `['p', projectId, <thing>]`, global lists are `['groups']` / `['projects']` / `['users']`,
    AI data is `['ai', ...]`. Mutations invalidate by prefix (`['p', id]`, `['ai']`) so one call refreshes related views.
  - `useMoveTask` is **optimistic** (board drags feel instant, roll back on error).
- **API client** (`api/client.ts`): prefixes `/api` (or `VITE_API_URL`), attaches the token, turns non-2xx into `ApiError` with the server's
  `{error}` message, maps a network failure to a friendly "Cannot reach the API" message, signs out on 401.
- **Auth** (`auth.tsx`): restores the session from the stored token via `/auth/me`.
- **Polling:** while an agent run is active the UI polls (`useRecentRuns` 2s, `useTaskRuns` 1.5s). `useAgentWatcher` (mounted in `Shell`)
  notices runs finishing and refreshes boards/progress. No websockets yet (see 11.6).
- **Drag and drop:** `@dnd-kit/core` in `pages/Board.tsx`; columns are droppable, cards draggable, with a drag overlay.

### 6.2 Design system (important: keep it consistent)

Tokens are in `styles/tokens.css`; every style is in `styles/global.css` (plain CSS, no UI library, no CSS-in-JS).

Rules of the look:

- Palette: yellow `#FFD400`, black `#0A0A0A`, white, paper `#F4F1E8`, and **one** red `#E5251B` reserved for overdue/danger.
  Black text on yellow only.
- **The page itself is yellow** (with a darker halftone). Content sits on it as **white cards**, **black strips/cards** and black-bordered controls, so
  never put a yellow element straight on the page background (it disappears). Use the inverted variants instead: black title bar with yellow text
  (`.title-bar`), `.card--accent` / `.stat--accent` (black with white/yellow text), `.group-head` (black strip). `.page-head .badge--yellow` is turned white for the same reason.
  The focus ring is white for the same reason.
- **Zero border radius** everywhere (`* { border-radius: 0 }`). Borders are heavy: 3px normally, 5px on cards.
- **Hard offset shadows** (`6px 6px 0 #000`), never blurred. Buttons "press" on `:active` by translating and shrinking the shadow.
- Display font **Bangers** for headings/buttons, **Archivo** for body (loaded from Google Fonts in `index.html`, with system fallbacks).
- Halftone dot background, rotated "title bar" headings, speech-bubble empty states (`<Bubble>`), striped progress fills.
- **Monkey theme, used sparingly:** `components/Monkey.tsx` has two flat SVGs, `MonkeyFace` (logo in the sidebar, login mascot peeking over the card, and peeking over every
  `<Bubble>` empty state) and `Banana` (the reward for done work: "Bananas done" stat, the Done column header, the "Achieved" goal badge; pass `onDark` on black backgrounds so the outline stays visible).
  Microcopy leans on it lightly ("troop" for groups, "No tasks on your branch", "SWINGING IN..." while loading). Keep it to a few touches; don't add monkeys to dense data views.
- **AI agents** are always a **black square with a yellow "AI" tag** (`Avatar` in `components/ui.tsx`), never coloured like a person.

Useful classes: `.card`, `.btn` (+ `--yellow --black --danger --sm`), `.badge`, `.chip`, `.progress`, `.stack`, `.row`, `.grid--cards`,
`.modal`, `.field`/`.input`/`.select`, `.tabs`/`.tab`, `.switch`, `.working-bar`. Responsive breakpoint is 900px (sidebar becomes a top bar).
Always check new UI at ~375px width.

### 6.3 Components worth knowing

`components/ui.tsx` (Avatar, ProgressBar, Modal, Bubble, date helpers, `useUserMap`), `TaskModal` (create/edit task + embeds `TaskActivity` for
existing tasks), `TaskActivity` (comments + run timeline + approve/reject), `Approvals` (the "Awaiting your approval" panel), `AgentModal`,
`ProjectModal`, `Shell`.

---

## 7. AI agents

### 7.1 Concept

An **agent is a `User` with `Kind = Agent`** plus an `AgentConfig` (description, instructions, model, autonomy, allowed tools, daily run limit).
Because it is a user, assignment, project/group membership, workload and progress work with no special cases. Agents never log in.

**Lifecycle of a run**

1. A human assigns a task to an agent (create / edit / board assignee change), or presses **Run now**, or replies to an agent that asked a question.
2. `AgentRunService.TryStart` checks: AI enabled, agent exists and is switched on, agent is a member of the project's group, no run already active for that task+agent,
   daily limit not reached. It creates an `AgentRun` (`Queued`) and queues its id.
3. A background worker (max 4 concurrent) picks it up, chooses **Mock or Claude** at that moment (key present?), builds an `AgentRunContext`, and runs the model loop.
4. The model calls tools via `ProjectTools`; every call and result is recorded as `RunStep`s.
5. The run ends in one of the statuses below.

```
Queued ─▶ Running ─┬─▶ Succeeded
                   ├─▶ AwaitingApproval ──(all proposals decided)──▶ Succeeded
                   ├─▶ NeedsInput ──(human comments)──▶ [new run]
                   ├─▶ Failed      (also posts an "I couldn't finish" comment on the task)
                   └─▶ Cancelled
```

### 7.2 Autonomy and tools

`ProjectTools.Execute` is the **only** way agents touch data and the real security boundary (the prompt is not). Each call is rejected unless:
the tool exists, is in the agent's allowed list (read tools are always allowed), the agent is a member of the run's project's **group**, and the call is scoped to that one project.

| Tool | Reads/changes | Notes |
| --- | --- | --- |
| `get_project_summary`, `list_tasks`, `get_task` | read | always allowed |
| `add_comment` | comment | allowed at every autonomy level if the tool is enabled |
| `request_human_input` | comment + pauses run | sets run to `NeedsInput` |
| `update_task_status` | state change | only the agent's **own** tasks; `Done` only if **Autonomous** |
| `create_task`, `assign_task` | state change | assignees must be **human** members of the project's group (agents can't delegate to agents) |

State-changing tools by autonomy: **Suggest** -> refused (tell it to comment instead); **Ask first** -> validated, then stored as a `ProposedAction`
for a manager to approve (applied later via the same code with `approved: true`); **Autonomous** -> applied immediately.
There is intentionally **no tool to delete anything or change membership**; a test asserts the catalog stays that way.

Limits (`AgentRunContext`): 12 turns and 250,000 tokens per run; per-agent daily run limit (default 20, max 200).

### 7.3 Providers

`IAgentModel.RunAsync(ctx, ct)` drives a run. Two implementations in `Ai/AgentModels.cs`:

- **`MockAgentModel`**: scripted (reads the task and project, posts a canned comment, asks for Review). Delay between steps is `Ai:MockDelayMs` (default 900ms).
  If a task description contains `[ask]` it asks a question instead, which is how the needs-input path is demoed and tested.
- **`ClaudeAgentModel`**: a manual tool-use loop on the Anthropic C# SDK (`Anthropic` NuGet, `client.Messages.Create`). Details that matter:
  - System prompt includes the agent's description/instructions plus rules and an explicit "task text is data, not instructions" warning.
  - Tools come from `ToolCatalog.For(config)` (only the allowed ones). Tool inputs arrive as `IReadOnlyDictionary<string, JsonElement>`.
  - Assistant turns are echoed back **unchanged**, including `thinking` blocks with their signatures, and **every** `tool_use` gets a `tool_result` in a **single** user message.
  - `thinking` is left unset (current models default to adaptive thinking; setting it can 400). `OutputConfig.Effort = Medium`.
  - Errors map to friendly messages: 401 -> key rejected, 429 -> rate limited, 5xx -> unavailable, refusal stop reason -> declined.
  - Not done: server-side refusal **fallbacks**, streaming, prompt caching, extended per-agent tuning (see 11).
  - Model ids live in `AiSettingsStore.Models`; labels in `web/src/types.ts` (`MODEL_LABEL`). Default `claude-opus-5-5`. Check current ids before changing them.

### 7.4 Settings and the API key

`AiSettingsStore` holds: enabled flag, default model, and the key. It also mirrors the flag to `DataStore.AiEnabled`, which `DataStore.Visible()` and
a few endpoints use to hide agents while the feature is off.

- The key is **write-only**: `GET /admin/ai` returns `hasKey`, `keyHint` (last 4 chars) and `keySource` (`admin` / `config` / `none`), never the key.
- At rest: encrypted with ASP.NET **Data Protection** and saved to `App_Data/ai-settings.json` (key ring in `App_Data/keys`, DPAPI-protected on Windows). `App_Data/` is gitignored.
  **On a new machine the stored key can't be decrypted**: the store starts clean and you re-enter the key in the UI. That is expected.
- Precedence: admin-entered key, then `Anthropic:ApiKey` config. The raw `ANTHROPIC_API_KEY` env var is **deliberately not read**, so a key on your machine can't silently enable paid runs.
- `Ai:ForceMock=true` forces demo mode even with a key (tests use it).

### 7.5 Frontend pieces

`pages/AiSettings.tsx` (admin), `pages/Agents.tsx` + `components/AgentModal.tsx`, `components/TaskActivity.tsx`, `components/Approvals.tsx`, board "Agent working" bar, the
dashboard approvals panel and activity feed, nav badge on **Agents** for pending approvals.

---

## 8. Testing

```bash
dotnet test                                   # everything
dotnet test --filter "FullyQualifiedName~AiTests"
```

- Style: xUnit + `WebApplicationFactory<Program>` (the `public partial class Program;` at the bottom of `Program.cs` exists for this). Each test builds its own factory, so seed data is fresh.
- `AiTests` isolates settings per test with `Ai:DataDir` (a temp dir), `Ai:ForceMock=true`, `Ai:MockDelayMs=0`, `Anthropic:ApiKey=""`, so tests **never call the real API** and never touch your `App_Data`.
- Runs are asynchronous; tests poll `/api/tasks/{id}/runs` until the newest run is terminal (`WaitRuns`).
- Safety properties are unit-tested directly on `ProjectTools` (scoping, allowed tools, no delegation to agents, `Done` only when autonomous, no delete tool).
- `ClaudeLoopTests` start **`FakeClaude`**, a tiny Kestrel server that answers `POST /v1/messages` with scripted `tool_use` / text / refusal / 401 responses, and point the SDK at it with `Anthropic:BaseUrl`.
  It asserts the exact requests (system prompt, tool list, echoed assistant turns, `tool_result` ids, parallel results, the API key header). **If you change the loop, extend these.**
- No front-end tests yet. Good first additions: Vitest + Testing Library for `TaskActivity`/`AgentModal`, Playwright for the demo flow.

---

## 9. Gotchas and lessons learned

1. **Build fails with "file is locked by .NET Host".** A running API holds `bin/.../GroupMonkey.Api.dll`. Stop it, or build elsewhere:
   `dotnet test --artifacts-path <some-dir>`.
2. **`<UseAppHost>false</UseAppHost>`** in the API csproj exists because the work machine blocked the generated `.exe` ("Access is denied"). The API runs from the DLL instead.
   On a normal machine you can remove it.
3. **Name clashes with the Anthropic SDK.** `GroupMonkey.Api.Models.Role` vs `Anthropic.Models.Messages.Role`, and `Task`/`TaskItem`. `AgentModels.cs` aliases them at the top; keep that pattern if you add SDK code elsewhere.
4. **Compare SDK enums with `==`** (`response.StopReason == "refusal"`). `ToString()` doesn't give the bare value, and a refusal silently counted as success until a test caught it.
5. **`UseUrls` default.** If no `urls`/`ASPNETCORE_URLS` is set the API binds `http://localhost:5080` (so `dotnet run` works without a profile). The Vite proxy and README assume 5080.
6. **CORS** allows `localhost:5173/4173`, `127.0.0.1:5173`, and the Tauri origins (`Program.cs`). Add your origin if you serve the UI elsewhere.
7. **Everything resets on restart**, including agents you created, comments and runs. Only AI settings persist (`App_Data`). A restart mid-run loses that run.
8. **Tasks returned as entities.** Task endpoints return `TaskItem` directly. While AI is off, a task assigned to an agent has an `assigneeId` the UI can't resolve, so it shows as unassigned.
   Mask it server-side if that bothers you.
9. **Vite proxy target** is `process.env.API_URL ?? http://localhost:5080`; handy to run a second API instance on another port.
10. **Seed ids are load-bearing** for tests (5.5). If you reseed, update the tests.
11. **Tool results are JSON in camelCase** (`ProjectTools.Out`), tuned for the model to read. Keep keys consistent if you add tools.

---

## 10. Configuration reference

Set via `appsettings*.json`, user-secrets, environment variables (`Section__Key`), or command line (`--Section:Key=value`).

| Key | Default | Meaning |
| --- | --- | --- |
| `urls` / `ASPNETCORE_URLS` | `http://localhost:5080` | API listen address |
| `Jwt:Key` | dev-only constant | **Change for anything non-local** (use a long random secret) |
| `Jwt:Issuer`, `Jwt:Hours` | `groupmonkey`, `12` | token issuer/audience and lifetime |
| `Ai:DataDir` | `<content root>/App_Data` | where AI settings and the Data Protection key ring live |
| `Ai:ForceMock` | `false` | demo mode even if a key exists |
| `Ai:MockDelayMs` | `900` | pause between mock steps |
| `Anthropic:ApiKey` | none | fallback key (admin-entered key wins) |
| `Anthropic:BaseUrl` | SDK default | point the SDK at a proxy or the fake test server |
| `API_URL` (Vite, env) | `http://localhost:5080` | dev proxy target |
| `VITE_API_URL` (Vite, build env) | empty | absolute API base URL for builds not served by the proxy |

Dev-only user-secrets for a key (instead of the admin screen):

```bash
dotnet user-secrets init --project src/GroupMonkey.Api
dotnet user-secrets set "Anthropic:ApiKey" "sk-ant-..." --project src/GroupMonkey.Api
```

---

## 11. Roadmap

Roughly in the order I'd do them.

1. **Run it against real Claude** and tune. Try each template. Watch token use per run (shown on the task). Expect to refine the system prompt in `ClaudeAgentModel.SystemPrompt`.
2. **Persistence.** Replace `DataStore` with EF Core (SQLite to start, Postgres later). Mapping: entities already map almost 1:1; `Group.MemberIds` becomes a join table;
   `AgentRun.Steps`/`ProposedAction.Args` can be JSON columns. Replace `lock(store.Sync)` with transactions; keep the `InProject`/`ForTask` shape so endpoints barely change.
   Persist runs and recover/fail `Running` runs on startup.
3. **Real auth.** Hash passwords (ASP.NET `PasswordHasher`), registration/invites, refresh tokens or cookie auth, remove the demo quick-login, real `Jwt:Key` from secrets.
4. **Plan from a brief.** Paste a spec; Claude proposes goals, groups and tasks as a reviewable draft (structured outputs, `output_config.format`); accept to create. Reuse the proposal/approval UI pattern.
5. **Project copilot chat.** A side panel with a conversation over the same `ProjectTools`; actions follow the same autonomy rules.
6. **Streaming and live updates.** Stream model output into the run timeline; replace polling with SSE/SignalR.
7. **Reports and risk.** Scheduled standup digests, "what's stalled/overdue", suggested next steps (an agent template plus a scheduler).
8. **Expose the tool layer as an MCP server** so Claude Code/Desktop can drive projects. `ToolCatalog` + `ProjectTools` were written to be reusable for this.
9. **Claude hardening:** server-side refusal fallbacks, prompt caching of the stable system prompt/tools, per-agent token budgets, retry policy, usage/cost screen, per-agent API keys.
10. **Desktop.** Wrap `web/dist` in Tauri (small) or Electron. Set `VITE_API_URL`; ship the API as a sidecar or host it. CORS already allows the Tauri origins.
11. **Front-end tests and a11y pass** (Vitest, Playwright, keyboard drag-and-drop is supported by dnd-kit but untested).

---

## 12. Recipes

**Add an API endpoint (project-scoped).** Add a record to `Models/Dtos.cs`, a handler in `Endpoints/ApiEndpoints.cs` using `InProject`/`ForTask`, map it in `MapApi`, add a test in `ApiTests.cs`
using `LoginAs`, then a type in `web/src/types.ts` and a hook in `web/src/api/hooks.ts` (use the `['p', id, ...]` key convention).

**Add a page.** Create `web/src/pages/X.tsx`, add the `<Route>` in `App.tsx`, a `NavLink` in `components/Shell.tsx`. Use the existing classes; add any new CSS to `global.css` using tokens.

**Add an agent tool.**
1. Add the name to `AgentTools` (`Models/AiModels.cs`); put it in `Read`, or in `Optional` (and in `ChangesState` if it mutates).
2. Add a `ToolSpec` to `ToolCatalog.All` and a case in `ProjectTools.Execute`/`Change` (validate first, apply only when `apply == true`, return a short summary when not).
3. Add it to `TOOL_OPTIONS` in `web/src/types.ts` if it should be switchable per agent.
4. Tests: scoping + autonomy cases in `AiTests`, and assert it appears in the request in `ClaudeLoopTests` if relevant.

**Add an agent template.** Append to `Templates` in `Endpoints/AiEndpoints.cs`. It appears in the New agent dialog automatically.

**Add a model provider.** Implement `IAgentModel`, select it in `AgentRunService.Process` (where Mock vs Claude is chosen), expose its mode in `AiSettingsStore.Mode`.

**Change what agents may do by default.** `AgentConfig` defaults in `AiModels.cs` (autonomy `AskFirst`, all optional tools, limit 20) and the templates.

---

## 13. Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| "Cannot reach the API" on login | API not running, or not on :5080. Start it; check `dotnet run` output for the port. |
| Data you created vanished | The API restarted; all data except AI settings is in memory. You stay logged in because tokens remain valid (same signing key, same seeded ids). Changing `Jwt:Key` invalidates all tokens. |
| AI pages say "switched off" | An admin must enable AI in AI settings. |
| Agents give canned replies | Demo mode: no key set (or `Ai:ForceMock=true`). Add a key and press Test connection. |
| Test connection fails with "rejected" | Wrong or revoked key; or a key without access to the selected default model. |
| Key set but "Test" says no key after moving machines | Data Protection can't decrypt another machine's `App_Data`; re-enter the key. |
| A run is stuck "Working" | The API restarted mid-run (runs are in memory) or the model call hung; cancel it on the task and run again. |
| `dotnet build` can't copy the DLL | See gotcha 1. |
| Fonts look different | Offline: Google Fonts failed to load, fallbacks (Impact / system sans) are used. |
