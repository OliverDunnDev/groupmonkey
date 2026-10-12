# GroupMonkey

Project management app. **Groups** are teams that managers set up with chosen members; each group owns **projects**, and each project's tasks are assigned to members of the group. Track progress and goals along the way.
.NET 10 minimal API + React 19 (Vite, TypeScript). Data is **mock and in-memory** (resets when the API restarts).

It also has an optional **AI agents** feature: Claude-powered teammates you can assign tasks to. See [AI agents](#ai-agents-optional).

**Live demo:** https://oliverdunndev.github.io/groupmonkey/ (the whole app running in your browser with sample data; nothing to install). See [the demo notes](DEVELOPING.md#14-the-static-demo-github-pages).

Continuing development? Start with **[DEVELOPING.md](DEVELOPING.md)**: setup, architecture, conventions, gotchas and roadmap.

## Run it

Two terminals from the repo root:

```bash
dotnet run --project src/GroupMonkey.Api
```

```bash
cd web 
npm install && npm run dev
```

Open http://localhost:5173. The API listens on http://localhost:5080 and the Vite dev server proxies `/api` to it
(set `API_URL` when starting Vite to point the proxy somewhere else).

## Mock logins (password `password123`)

| User | Email | Role |
| --- | --- | --- |
| Ava Admin | admin@groupmonkey.dev | Admin (sees every project, edits anything, manages AI settings) |
| Marcus Manager | manager@groupmonkey.dev | Manager (creates projects, groups, goals and agents; approves agent changes) |
| Priya Patel | member@groupmonkey.dev | Member (works tasks on their projects) |
| Sam Okafor | sam@groupmonkey.dev | Member |

## AI agents (optional)

Off by default. When an admin switches it on, agents behave like any other team member: they join projects and
groups, appear in workload and progress, and can be assigned tasks. Assigning a task to an agent starts a run in the
background. The agent reads the project, posts its work as a comment, and moves the card to Review.

**Try it in demo mode (no key needed):**

1. Log in as Ava Admin, open **AI settings**, and switch AI agents **ON**. You'll see a DEMO MODE banner.
2. Two demo agents appear, as members of the Web Team and Mobile Team groups: **Scout** (research, "Ask first") and **Patch** (QA, comments only).
3. Open a task on a board, assign it to Scout, save, then reopen the task to see the run timeline and comment.
   Scout's move to Review waits in **Awaiting your approval** (Dashboard, Agents page, or the task itself).
4. **Agents > New agent** creates your own from a template (Researcher, Writer, QA reviewer, Triage) or from scratch.

Demo mode uses a scripted stand-in, so replies are canned. It exists so the whole workflow can be explored without a key.

**Using real Claude:**

1. Create an API key in your Claude Console account.
2. As an admin, open **AI settings**, paste it under **Claude API key**, press **Save key**, then **Test connection**.
3. The banner changes to LIVE. New runs use Claude; the default model is Claude Opus 5.5 and can be changed there,
   or per agent.

Alternatively set `Anthropic:ApiKey` in server configuration (user-secrets or the `Anthropic__ApiKey` environment
variable). A key entered in the admin screen takes precedence. The bare `ANTHROPIC_API_KEY` variable is deliberately
**not** read, so a key on your machine can't silently turn on paid runs.

### How agents are kept safe

- **The key is write-only.** It is stored on the server encrypted (ASP.NET Data Protection, DPAPI on Windows) under
  `src/GroupMonkey.Api/App_Data/`, and is never returned by any endpoint or sent to the browser. The UI only shows the last 4 characters.
- **Autonomy per agent:** *Suggest* (comments only), *Ask first* (changes wait for a manager's approval), or *Autonomous*.
- **Limited tools.** Agents act only through a small tool layer (`src/GroupMonkey.Api/Ai/ProjectTools.cs`): read the
  project, comment, change the status of *their own* tasks, create tasks, assign tasks to people, and ask a question.
  There is no tool to delete anything, change group membership, or hand work to another agent. Marking work **Done**
  is reserved for Autonomous agents.
- **Scoped to one project per run**, and only projects the agent is a member of.
- **Bounded cost:** a daily run limit per agent, plus a cap on turns and tokens per run.
- **Auditable:** every run records its steps, tool calls and token use, shown on the task.
- Task text and comments are treated as untrusted data in the prompt; the tool layer, not the prompt, is the security boundary.

When AI is off, agents are hidden everywhere (users, members, assignees) and the agent endpoints return 404.

## Tests and checks

```bash
dotnet test
cd web && npm run build && npm run lint
```

The AI tests include a **fake Claude server** (`tests/GroupMonkey.Api.Tests/ClaudeLoopTests.cs`) that exercises the
real tool-use loop, including parallel tool calls, a rejected key, a refusal and a runaway model, without a key or network.
`Anthropic:BaseUrl` points the client at it (it can also point at a proxy).

## Layout

- `src/GroupMonkey.Api`: models, seed data (`Data/SeedData.cs`), progress calculations (`Services/Progress.cs`),
  endpoints (`Endpoints/`), JWT auth, and the AI feature in `Ai/` (settings store, tool layer, mock and Claude models, run service).
- `tests/GroupMonkey.Api.Tests`: API integration tests.
- `web/src`: `api/` (client + query hooks), `pages/`, `components/`, `styles/` (design tokens in `tokens.css`).

## Next: desktop

The UI has no server-side coupling, so wrapping it is mostly packaging:

- **Tauri** (small, Rust shell) or **Electron** (Node shell) can load the built `web/dist`.
- Set `VITE_API_URL` at build time to point at the API, since the dev proxy is not present in a packaged app. CORS already allows the `tauri://localhost` origin; add the Electron origin if you pick that.
- Either bundle the API as a sidecar process, or host it and replace the in-memory store with a database first.

## Ideas for further AI work

Plan-from-a-brief (spec to goals and tasks), a project copilot chat, standup and risk reports, and exposing the same
tool layer as an MCP server so Claude Code or Claude Desktop can drive the project.

## Known limits

Plain-text mock passwords, in-memory data (agents, runs and comments reset on restart; only AI settings persist),
no registration, and a development-only JWT signing key (override via `Jwt:Key`). Agent runs are held in memory and
are lost if the API restarts mid-run. Server-side refusal fallbacks are not configured, so a Claude refusal fails that run with a clear message.
