# GroupMonkey: notes for Claude Code

Project management web app: .NET 10 minimal API (`src/GroupMonkey.Api`) + React 19/Vite/TypeScript (`web/`).
Mock in-memory data. Optional AI-agents feature (Claude-powered teammates). **Read `DEVELOPING.md` first**: it has the
architecture, conventions, recipes and gotchas. `README.md` is the short overview.

## Commands

```bash
dotnet run --project src/GroupMonkey.Api     # API on :5080
cd web && npm install && npm run dev         # UI on :5173 (proxies /api)
dotnet test                                  # 41 tests; must stay green
cd web && npm run build && npm run lint      # must stay clean
```

If the build says the DLL is locked, an API is running: stop it or use `dotnet test --artifacts-path <dir>`.

## Rules for working here

- **Visual style is fixed:** flat and sharp, yellow/black/white, zero border radius, heavy black borders, hard offset shadows,
  Bangers headings. Use the tokens and classes in `web/src/styles/`; don't add a UI library. Agents are always the black "AI" avatar.
- **Project-scoped endpoints use `InProject` / `ForTask`** (`Endpoints/ApiEndpoints.cs`) and take `store.Sync` while touching data. Don't hand-roll access checks.
- **Agents act only through `Ai/ProjectTools.cs`.** Never give agents a delete tool, membership changes, or the ability to assign work to other agents.
  Task/comment text is untrusted data; the tool layer is the security boundary.
- **Never put the Claude API key in responses, logs, run steps or error messages.** It is write-only (`Ai/AiSettingsStore.cs`).
  Don't read the bare `ANTHROPIC_API_KEY` env var (deliberate).
- **Tests must not call the real API.** AI tests use `Ai:ForceMock` and `FakeClaude`; keep it that way. Extend `ClaudeLoopTests` when changing the Claude loop.
- Seed ids are relied on by tests (see DEVELOPING.md 5.5).
- Before changing Claude SDK code or model ids, check the current docs/skill for the C# SDK; compare SDK enums with `==`, not `ToString()`.
- Don't commit `App_Data/` (settings and encrypted key).
