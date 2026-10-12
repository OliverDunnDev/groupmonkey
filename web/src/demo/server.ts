// In-browser implementation of the GroupMonkey API, used by the static GitHub Pages demo.
// It mirrors src/GroupMonkey.Api (endpoints, access rules, DTO shapes, mock agent runs). When you change the .NET API,
// change this too: see "Demo" in DEVELOPING.md. Written to run in Node as well, for the parity check.

import type { ProposedAction, Run, RunStatus, RunStep, WorkStatus } from '../types.ts'
import {
  addDays, db, MODELS, nowIso, OPTIONAL_TOOLS, todayStr,
  type ActionE, type AgentCfg, type GroupE, type GoalE, type ProjectE, type RunE, type TaskE, type UserE,
} from './db.ts'

export interface DemoResult { status: number; data?: unknown }
type Body = Record<string, any>
interface Ctx { me: UserE; params: string[]; body: Body }
type Handler = (ctx: Ctx) => DemoResult

const ok = (data?: unknown, status = 200): DemoResult => ({ status, data })
const fail = (status: number, error?: string): DemoResult => ({ status, data: error ? { error } : undefined })
const bad = (error: string) => fail(400, error)
const NOT_FOUND = fail(404)
const FORBID = fail(403)

// ---------------------------------------------------------------- helpers

const pct = (done: number, total: number) => (total === 0 ? 0 : Math.round((done * 100) / total))
const isAgent = (id: number) => db.users.some((u) => u.id === id && u.kind === 'Agent')
const userName = (id: number | null) => (id === null ? 'Unassigned' : db.users.find((u) => u.id === id)?.name ?? `User ${id}`)
const visible = (ids: number[]) => (db.aiEnabled ? [...ids] : ids.filter((id) => !isAgent(id)))
const clip = (s: string, n: number) => (s.length <= n ? s : s.slice(0, n))
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)
const num = (v: unknown): number | undefined => {
  if (typeof v === 'number' && Number.isInteger(v)) return v
  if (typeof v === 'string' && /^-?\d+$/.test(v)) return Number(v)
  return undefined
}
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

// ---------------------------------------------------------------- access (mirrors Services/Auth.cs)

const canViewGroup = (u: UserE, g: GroupE) => u.role === 'Admin' || g.ownerId === u.id || g.memberIds.includes(u.id)
const canEditGroup = (u: UserE, g: GroupE) => u.role === 'Admin' || g.ownerId === u.id
const canManageGroup = (u: UserE, g: GroupE) => canEditGroup(u, g) || (u.role === 'Manager' && g.memberIds.includes(u.id))
const groupOf = (p: ProjectE) => db.groups.find((g) => g.id === p.groupId)
const membersOf = (p: ProjectE) => groupOf(p)?.memberIds ?? []
const isMember = (p: ProjectE, userId: number) => membersOf(p).includes(userId)
const canViewProject = (u: UserE, p: ProjectE) => { const g = groupOf(p); return !!g && canViewGroup(u, g) }
const canManageProject = (u: UserE, p: ProjectE) => { const g = groupOf(p); return !!g && canManageGroup(u, g) }

// ---------------------------------------------------------------- DTOs (mirrors Services/Progress.cs)

function projectDto(p: ProjectE, viewer: UserE) {
  const tasks = db.tasks.filter((t) => t.projectId === p.id)
  const done = tasks.filter((t) => t.status === 'Done').length
  const manage = canManageProject(viewer, p)
  return {
    id: p.id, name: p.name, description: p.description, status: p.status, startDate: p.startDate, dueDate: p.dueDate,
    ownerId: p.ownerId, groupId: p.groupId, groupName: groupOf(p)?.name ?? '', memberIds: visible(membersOf(p)),
    taskCount: tasks.length, doneCount: done, percent: pct(done, tasks.length), canManage: manage, canEdit: manage,
  }
}

function groupDto(g: GroupE, viewer: UserE) {
  const projectIds = new Set(db.projects.filter((p) => p.groupId === g.id).map((p) => p.id))
  const tasks = db.tasks.filter((t) => projectIds.has(t.projectId))
  const done = tasks.filter((t) => t.status === 'Done').length
  return {
    id: g.id, name: g.name, description: g.description, color: g.color, ownerId: g.ownerId, memberIds: visible(g.memberIds),
    projectCount: projectIds.size, taskCount: tasks.length, doneCount: done, percent: pct(done, tasks.length),
    canManage: canManageGroup(viewer, g), canEdit: canEditGroup(viewer, g),
  }
}

function goalDto(g: GoalE) {
  const tasks = db.tasks.filter((t) => t.goalId === g.id)
  const done = tasks.filter((t) => t.status === 'Done').length
  return {
    id: g.id, projectId: g.projectId, title: g.title, description: g.description, targetDate: g.targetDate,
    taskCount: tasks.length, doneCount: done, percent: pct(done, tasks.length),
  }
}

function summary(p: ProjectE) {
  const tasks = db.tasks.filter((t) => t.projectId === p.id)
  const today = todayStr()
  const done = tasks.filter((t) => t.status === 'Done').length
  const byStatus: Record<WorkStatus, number> = { Todo: 0, InProgress: 0, Review: 0, Done: 0 }
  for (const t of tasks) byStatus[t.status]++
  const members = visible(membersOf(p)).map((userId) => {
    const mine = tasks.filter((t) => t.assigneeId === userId)
    const d = mine.filter((t) => t.status === 'Done').length
    return { userId, total: mine.length, done: d, percent: pct(d, mine.length), kind: isAgent(userId) ? 'Agent' : 'Human' }
  })
  const overdue = tasks.filter((t) => t.status !== 'Done' && t.dueDate !== null && t.dueDate < today).length
  return { projectId: p.id, total: tasks.length, done, percent: pct(done, tasks.length), overdue, byStatus, members }
}

const userDto = (u: UserE) => ({ id: u.id, name: u.name, email: u.email, role: u.role, color: u.color, kind: u.kind })

const taskTitle = (id: number) => db.tasks.find((t) => t.id === id)?.title ?? '(deleted task)'

const actionDto = (a: ActionE): ProposedAction => ({
  id: a.id, runId: a.runId, agentId: a.agentId, projectId: a.projectId, taskId: a.taskId, taskTitle: taskTitle(a.taskId),
  tool: a.tool, summary: a.summary, state: a.state, decidedBy: a.decidedBy, createdAt: a.createdAt,
})

function runDto(r: RunE): Run {
  const { actionIds, ...rest } = r
  return { ...rest, steps: r.steps.map((s) => ({ ...s })), actions: actionIds.map((id) => db.actions.find((a) => a.id === id)).filter((a): a is ActionE => !!a).map(actionDto) }
}

// ---------------------------------------------------------------- scoping helpers

type Level = 'View' | 'Manage'

function inGroup(ctx: Ctx, id: number, level: Level | 'Edit', act: (g: GroupE) => DemoResult): DemoResult {
  const g = db.groups.find((x) => x.id === id)
  if (!g || !canViewGroup(ctx.me, g)) return NOT_FOUND
  if (level === 'Manage' && !canManageGroup(ctx.me, g)) return FORBID
  if (level === 'Edit' && !canEditGroup(ctx.me, g)) return FORBID
  return act(g)
}

function inProject(ctx: Ctx, id: number, level: Level, act: (p: ProjectE) => DemoResult): DemoResult {
  const p = db.projects.find((x) => x.id === id)
  if (!p || !canViewProject(ctx.me, p)) return NOT_FOUND
  if (level !== 'View' && !canManageProject(ctx.me, p)) return FORBID
  return act(p)
}

function forTask(ctx: Ctx, id: number, act: (p: ProjectE, t: TaskE) => DemoResult): DemoResult {
  const t = db.tasks.find((x) => x.id === id)
  return t ? inProject(ctx, t.projectId, 'View', (p) => act(p, t)) : NOT_FOUND
}

function forGoal(ctx: Ctx, id: number, act: (p: ProjectE, g: GoalE) => DemoResult): DemoResult {
  const g = db.goals.find((x) => x.id === id)
  return g ? inProject(ctx, g.projectId, 'Manage', (p) => act(p, g)) : NOT_FOUND
}

function validateTaskRefs(p: ProjectE, assigneeId: number | null | undefined, goalId: number | null | undefined): string | null {
  if (assigneeId != null && !isMember(p, assigneeId)) return "Tasks can only be assigned to members of this project's group."
  if (assigneeId != null && !db.aiEnabled && isAgent(assigneeId)) return 'AI agents are not enabled.'
  if (goalId != null && !db.goals.some((g) => g.id === goalId && g.projectId === p.id)) return 'Goal not found in this project.'
  return null
}

function removeFromGroup(g: GroupE, userId: number) {
  g.memberIds = g.memberIds.filter((m) => m !== userId)
  const projectIds = new Set(db.projects.filter((p) => p.groupId === g.id).map((p) => p.id))
  for (const t of db.tasks) if (projectIds.has(t.projectId) && t.assigneeId === userId) t.assigneeId = null
}

function deleteTask(t: TaskE) {
  db.comments = db.comments.filter((c) => c.taskId !== t.id)
  db.actions = db.actions.filter((a) => a.taskId !== t.id)
  db.runs = db.runs.filter((r) => r.taskId !== t.id)
  db.tasks = db.tasks.filter((x) => x.id !== t.id)
}

function deleteProject(p: ProjectE) {
  for (const t of db.tasks.filter((x) => x.projectId === p.id)) deleteTask(t)
  db.goals = db.goals.filter((g) => g.projectId !== p.id)
  db.projects = db.projects.filter((x) => x.id !== p.id)
}

const cleanMembers = (ids: number[], ownerId: number) => [
  ...new Set([...ids.filter((id) => db.users.some((u) => u.id === id && (u.kind === 'Human' || db.aiEnabled))), ownerId]),
]

// ---------------------------------------------------------------- mock agent runs

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const STEP_DELAY_MS = 700
const READ_TOOLS = ['get_project_summary', 'list_tasks', 'get_task']
const STATE_TOOLS = ['update_task_status', 'create_task', 'assign_task']
const ALL_TOOLS = [...READ_TOOLS, 'add_comment', ...STATE_TOOLS, 'request_human_input']

function addStep(run: RunE, type: RunStep['type'], content: string) {
  run.steps.push({ type, content: content.length > 4000 ? content.slice(0, 4000) + '...' : content, at: nowIso() })
}

function tryStart(taskId: number, agentId: number, triggeredBy: string): { run?: RunE; error?: string } {
  if (!db.aiEnabled) return { error: 'AI agents are not enabled.' }
  const agent = db.users.find((u) => u.id === agentId && u.kind === 'Agent')
  const cfg = db.agents.find((a) => a.userId === agentId)
  if (!agent || !cfg) return { error: 'That agent no longer exists.' }
  if (!cfg.enabled) return { error: `${agent.name} is switched off.` }
  const task = db.tasks.find((t) => t.id === taskId)
  if (!task) return { error: 'Task not found.' }
  const project = db.projects.find((p) => p.id === task.projectId)
  if (!project || !isMember(project, agentId)) return { error: `${agent.name} is not a member of this project's group.` }
  if (db.runs.some((r) => r.taskId === taskId && r.agentId === agentId && (r.status === 'Queued' || r.status === 'Running')))
    return { error: `${agent.name} is already working on this task.` }
  const startOfDay = new Date(); startOfDay.setUTCHours(0, 0, 0, 0)
  if (db.runs.filter((r) => r.agentId === agentId && new Date(r.createdAt) >= startOfDay).length >= cfg.dailyRunLimit)
    return { error: `${agent.name} has reached its limit of ${cfg.dailyRunLimit} runs today.` }

  const run: RunE = {
    id: ++db.ids.run, agentId, taskId, projectId: project.id, status: 'Queued', createdAt: nowIso(), startedAt: null, endedAt: null,
    provider: 'Mock', model: null, inputTokens: 0, outputTokens: 0, error: null, triggeredBy, steps: [], actionIds: [],
  }
  db.runs.push(run)
  void executeRun(run)
  return { run }
}

function finish(run: RunE, status: RunStatus, error: string | null = null) {
  run.status = status
  run.endedAt = nowIso()
  run.error = error
}

function settle(run: RunE) {
  if (run.status !== 'AwaitingApproval') return
  const pending = run.actionIds.some((id) => db.actions.some((a) => a.id === id && a.state === 'Pending'))
  if (!pending) run.status = 'Succeeded'
}

interface ToolResult { content: string; isError: boolean; needsInput?: boolean }
const tr = (content: string, isError = false): ToolResult => ({ content, isError })

/** The tool layer for demo runs. Mirrors Ai/ProjectTools.cs for the tools the scripted agent uses. */
function runTool(run: RunE, name: string, args: Record<string, unknown>, approved = false): ToolResult {
  const agent = db.users.find((u) => u.id === run.agentId)
  const cfg = db.agents.find((a) => a.userId === run.agentId)
  const project = db.projects.find((p) => p.id === run.projectId)
  if (!ALL_TOOLS.includes(name)) return tr(`Unknown tool '${name}'.`, true)
  if (!agent || !cfg) return tr('The agent no longer exists.', true)
  if (!READ_TOOLS.includes(name) && !cfg.allowedTools.includes(name)) return tr(`The tool '${name}' is not enabled for you.`, true)
  if (!project || !isMember(project, agent.id)) return tr("You are not a member of this project's group.", true)

  const findTask = () => {
    const id = num(args.task_id)
    return id === undefined ? undefined : db.tasks.find((t) => t.id === id && t.projectId === project.id)
  }

  if (STATE_TOOLS.includes(name) && !approved) {
    if (cfg.autonomy === 'Suggest')
      return tr('Your autonomy level is Suggest: you can read and comment but not change tasks. Describe the change you recommend in a comment instead.', true)
    const check = changeTool(name, args, false)
    if (check.isError) return check
    if (cfg.autonomy === 'AskFirst') {
      const action: ActionE = {
        id: ++db.ids.action, runId: run.id, agentId: agent.id, projectId: project.id, taskId: num(args.task_id) ?? run.taskId,
        tool: name, args: { ...args }, summary: check.content, state: 'Pending', decidedBy: null, createdAt: nowIso(),
      }
      db.actions.push(action)
      run.actionIds.push(action.id)
      return tr(`Held for human approval (proposal #${action.id}): ${check.content}. Do not repeat it; carry on with the rest of your work.`)
    }
  }

  function changeTool(tool: string, a: Record<string, unknown>, apply: boolean): ToolResult {
    if (tool !== 'update_task_status') return tr(`The '${tool}' tool isn't available in the static demo.`, true)
    const t = findTask()
    if (!t) return tr('Task not found in this project.', true)
    if (t.assigneeId !== agent!.id) return tr('You can only change the status of tasks assigned to you.', true)
    const status = ['Todo', 'InProgress', 'Review', 'Done'].find((s) => same(s, str(a.status) ?? ''))
    if (!status) return tr('Status must be Todo, InProgress, Review or Done.', true)
    if (status === 'Done' && cfg!.autonomy !== 'Autonomous') return tr('You can move work to Review; a person marks it Done.', true)
    const text = `Move task #${t.id} "${t.title}" from ${t.status} to ${status}`
    if (apply) t.status = status as WorkStatus
    return tr(apply ? `Task #${t.id} is now ${status}.` : text)
  }

  switch (name) {
    case 'get_project_summary': {
      const sum = summary(project)
      const group = groupOf(project)
      return tr(JSON.stringify({
        project: { id: project.id, name: project.name, description: project.description, status: project.status, start: project.startDate, due: project.dueDate },
        progress: { total: sum.total, done: sum.done, percent: sum.percent, overdue: sum.overdue, byStatus: sum.byStatus },
        goals: db.goals.filter((g) => g.projectId === project.id).map(goalDto)
          .map((g) => ({ id: g.id, title: g.title, description: g.description, target: g.targetDate, taskCount: g.taskCount, doneCount: g.doneCount, percent: g.percent })),
        group: group ? { id: group.id, name: group.name, description: group.description } : null,
        team: membersOf(project).map((id) => ({ id, name: userName(id), kind: isAgent(id) ? 'Agent' : 'Human' })),
      }))
    }
    case 'get_task': {
      const t = findTask()
      if (!t) return tr('Task not found in this project.', true)
      return tr(JSON.stringify({
        id: t.id, title: t.title, description: t.description, status: t.status, priority: t.priority, assignee: userName(t.assigneeId), due: t.dueDate,
        goal: db.goals.find((g) => g.id === t.goalId)?.title ?? null,
        comments: db.comments.filter((c) => c.taskId === t.id).slice(-20).map((c) => ({ author: userName(c.authorId), kind: isAgent(c.authorId) ? 'Agent' : 'Human', at: c.createdAt, body: c.body })),
      }))
    }
    case 'add_comment': {
      const t = findTask()
      if (!t) return tr('Task not found in this project.', true)
      const body = str(args.body)?.trim()
      if (!body) return tr('The comment body is empty.', true)
      db.comments.push({ id: ++db.ids.comment, taskId: t.id, authorId: agent.id, body: clip(body, 8000), createdAt: nowIso() })
      return tr(`Comment posted on task #${t.id}.`)
    }
    case 'request_human_input': {
      const question = str(args.question)?.trim()
      if (!question) return tr('The question is empty.', true)
      db.comments.push({ id: ++db.ids.comment, taskId: run.taskId, authorId: agent.id, body: '**I need your input:** ' + clip(question, 4000), createdAt: nowIso() })
      return { content: 'Question posted. Stop working now; the team will reply on the task and you will be re-run.', isError: false, needsInput: true }
    }
    default:
      return changeTool(name, args, true)
  }
}

function callTool(run: RunE, name: string, args: Record<string, unknown>): ToolResult {
  addStep(run, 'ToolCall', `${name} ${JSON.stringify(args)}`)
  const result = runTool(run, name, args)
  addStep(run, 'ToolResult', (result.isError ? 'Error: ' : '') + result.content)
  return result
}

/** The scripted "demo mode" agent: same steps as Ai/AgentModels.cs MockAgentModel, with real delays so the UI shows it working. */
async function executeRun(run: RunE) {
  await sleep(400)
  if (run.status !== 'Queued') return
  const agent = db.users.find((u) => u.id === run.agentId)
  const cfg = db.agents.find((a) => a.userId === run.agentId)
  const project = db.projects.find((p) => p.id === run.projectId)
  const task = db.tasks.find((t) => t.id === run.taskId)
  if (!agent || !cfg || !project || !task) { finish(run, 'Failed', 'The agent, project or task no longer exists.'); return }

  run.status = 'Running'
  run.startedAt = nowIso()
  const alive = () => run.status === 'Running'

  addStep(run, 'Thought', 'Demo mode: this is a scripted response and no AI model is called.')
  await sleep(STEP_DELAY_MS); if (!alive()) return
  callTool(run, 'get_task', { task_id: task.id })
  await sleep(STEP_DELAY_MS); if (!alive()) return
  callTool(run, 'get_project_summary', {})
  await sleep(STEP_DELAY_MS); if (!alive()) return

  let needsInput = false
  if (task.description.toLowerCase().includes('[ask]')) {
    needsInput = !!callTool(run, 'request_human_input', { question: 'Which audience is this for, and what is the deadline?' }).needsInput
  } else {
    const goal = db.goals.find((g) => g.id === task.goalId)?.title
    let brief = task.description.trim() || '(no description provided)'
    if (brief.length > 240) brief = brief.slice(0, 240) + '...'
    const body =
      `**Demo response from ${agent.name}**\n\n` +
      `I've picked up **${task.title}** (${task.priority} priority) for the **${project.name}** project.` +
      (goal ? ` It contributes to the goal "${goal}".` : '') + '\n\n' +
      `Role: ${cfg.description}\n\n` +
      '**Plan**\n1. Review the brief and any open questions.\n' +
      `2. Draft the deliverable against the description: "${brief}"\n` +
      '3. Hand it back to a person for review.\n\n' +
      '_This is a scripted demo reply. Run the app locally with a Claude API key to use real agents._'
    callTool(run, 'add_comment', { task_id: task.id, body })
    await sleep(STEP_DELAY_MS); if (!alive()) return
    callTool(run, 'update_task_status', { task_id: task.id, status: 'Review' })
  }

  if (!alive()) return
  const pending = run.actionIds.some((id) => db.actions.some((a) => a.id === id && a.state === 'Pending'))
  finish(run, needsInput ? 'NeedsInput' : pending ? 'AwaitingApproval' : 'Succeeded')
}

function kickAgent(t: TaskE, previous: number | null, by: UserE) {
  if (t.assigneeId !== null && t.assigneeId !== previous && isAgent(t.assigneeId)) tryStart(t.id, t.assigneeId, `Assigned by ${by.name}`)
}

// ---------------------------------------------------------------- agents (mirrors Endpoints/AiEndpoints.cs)

const AGENT_COLORS = ['#0A0A0A', '#FFD400', '#FFFFFF', '#E5251B', '#FFB800']

const TEMPLATES = [
  { key: 'researcher', name: 'Researcher', description: 'Digs into questions and writes up findings with sources and open questions.',
    instructions: 'You research topics for the team. Gather what is known from the project context, structure your findings with clear headings, state assumptions, and list open questions. Keep it practical and concise.',
    autonomy: 'AskFirst', allowedTools: ['add_comment', 'update_task_status', 'request_human_input'], color: '#0A0A0A' },
  { key: 'writer', name: 'Writer', description: "Drafts copy, docs and announcements in the team's voice.",
    instructions: "You draft written content: copy, documentation and updates. Match the tone of the project description, keep drafts easy to scan, and offer one alternative headline or opening where it helps.",
    autonomy: 'AskFirst', allowedTools: ['add_comment', 'update_task_status', 'request_human_input'], color: '#0A0A0A' },
  { key: 'qa', name: 'QA reviewer', description: 'Reviews work and writes test plans. Comments only; never changes tasks.',
    instructions: 'You review work for gaps and risks. Produce a short checklist of things to verify, edge cases to test, and anything unclear in the task. You only comment; people decide what to change.',
    autonomy: 'Suggest', allowedTools: ['add_comment', 'request_human_input'], color: '#0A0A0A' },
  { key: 'triage', name: 'Triage assistant', description: 'Breaks large tasks into follow-ups and suggests owners. Changes need approval.',
    instructions: 'You help organise work. Break big tasks into small follow-up tasks with clear titles, suggest sensible owners based on who is on the team, and flag anything blocked or overdue.',
    autonomy: 'AskFirst', allowedTools: ['add_comment', 'create_task', 'assign_task', 'request_human_input'], color: '#0A0A0A' },
]

function agentDto(c: AgentCfg, viewer: UserE) {
  const user = db.users.find((u) => u.id === c.userId)!
  const startOfDay = new Date(); startOfDay.setUTCHours(0, 0, 0, 0)
  const runs = db.runs.filter((r) => r.agentId === c.userId)
  const last = [...runs].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
  return {
    userId: c.userId, name: user.name, color: user.color, description: c.description, instructions: c.instructions, model: c.model,
    autonomy: c.autonomy, allowedTools: [...c.allowedTools], enabled: c.enabled, dailyRunLimit: c.dailyRunLimit,
    groupIds: db.groups.filter((g) => g.memberIds.includes(c.userId) && canViewGroup(viewer, g)).map((g) => g.id),
    runsToday: runs.filter((r) => new Date(r.createdAt) >= startOfDay).length,
    lastRunStatus: last?.status ?? null, lastRunAt: last?.createdAt ?? null,
    activeRuns: runs.filter((r) => r.status === 'Queued' || r.status === 'Running').length,
    canEdit: canEditAgent(viewer, c),
  }
}

const canEditAgent = (me: UserE, c: AgentCfg) => me.role === 'Admin' || (me.role === 'Manager' && c.createdBy === me.id)

function validateAgent(b: Body, selfId: number | null): string | null {
  const name = (str(b.name) ?? '').trim()
  if (name.length < 2 || name.length > 40) return 'Give the agent a name of 2 to 40 characters.'
  if (db.users.some((u) => u.id !== selfId && same(u.name, name))) return 'Someone on the team already has that name.'
  if ((str(b.description)?.length ?? 0) > 400) return 'Description is too long (400 characters max).'
  if ((str(b.instructions)?.length ?? 0) > 6000) return 'Instructions are too long (6000 characters max).'
  if (str(b.model) && !MODELS.includes(b.model)) return 'Unknown model.'
  if (Array.isArray(b.allowedTools) && b.allowedTools.some((t: string) => !OPTIONAL_TOOLS.includes(t))) return 'Unknown tool in the allowed list.'
  if (b.dailyRunLimit != null && (b.dailyRunLimit < 1 || b.dailyRunLimit > 200)) return 'Daily run limit must be between 1 and 200.'
  if (b.color != null && !AGENT_COLORS.some((c) => same(c, String(b.color)))) return 'Unknown colour.'
  return null
}

function syncGroups(me: UserE, agentId: number, wanted: number[]) {
  for (const g of db.groups.filter((x) => canManageGroup(me, x))) {
    const member = g.memberIds.includes(agentId)
    if (wanted.includes(g.id) && !member) g.memberIds.push(agentId)
    else if (!wanted.includes(g.id) && member) removeFromGroup(g, agentId)
  }
}

// ---------------------------------------------------------------- routes

const routes: { method: string; re: RegExp; auth: boolean; fn: Handler }[] = []
function route(method: string, pattern: string, fn: Handler, auth = true) {
  routes.push({ method, re: new RegExp('^' + pattern.replace(/:[a-z]+/gi, '([^/]+)') + '$'), auth, fn })
}
const id = (ctx: Ctx, i = 0) => Number(ctx.params[i])
const aiOff = () => !db.aiEnabled

// ---- auth
route('POST', '/auth/login', ({ body }) => {
  const u = db.users.find((x) => same(x.email, String(body.email ?? '').trim()))
  if (!u || u.kind !== 'Human' || u.password !== body.password) return fail(401, 'Invalid email or password.')
  return ok({ token: `demo.${u.id}`, user: userDto(u) })
}, false)
route('GET', '/auth/me', ({ me }) => ok(userDto(me)))
route('GET', '/users', () => ok(db.users.filter((u) => db.aiEnabled || u.kind === 'Human').map(userDto)))

// ---- groups
route('GET', '/groups', ({ me }) => ok(db.groups.filter((g) => canViewGroup(me, g)).map((g) => groupDto(g, me))))
route('POST', '/groups', ({ me, body }) => {
  if (me.role === 'Member') return FORBID
  const name = (str(body.name) ?? '').trim()
  if (name.length < 2 || name.length > 60) return bad('Give the group a name of 2 to 60 characters.')
  if (db.groups.some((g) => same(g.name, name))) return bad('A group with that name already exists.')
  const g: GroupE = {
    id: ++db.ids.group, name, description: (str(body.description) ?? '').trim(), color: str(body.color) ?? '#FFD400', ownerId: me.id,
    memberIds: cleanMembers(Array.isArray(body.memberIds) ? body.memberIds : [], me.id),
  }
  db.groups.push(g)
  return ok(groupDto(g, me), 201)
})
route('GET', '/groups/:id', (ctx) => inGroup(ctx, id(ctx), 'View', (g) => ok(groupDto(g, ctx.me))))
route('PUT', '/groups/:id', (ctx) => inGroup(ctx, id(ctx), 'Manage', (g) => {
  const name = (str(ctx.body.name) ?? '').trim()
  if (name.length < 2 || name.length > 60) return bad('Give the group a name of 2 to 60 characters.')
  if (db.groups.some((x) => x.id !== g.id && same(x.name, name))) return bad('A group with that name already exists.')
  g.name = name
  g.description = str(ctx.body.description)?.trim() ?? g.description
  g.color = str(ctx.body.color) ?? g.color
  if (Array.isArray(ctx.body.memberIds)) {
    const members = cleanMembers(ctx.body.memberIds, g.ownerId)
    if (!db.aiEnabled) for (const m of g.memberIds) if (isAgent(m) && !members.includes(m)) members.push(m)
    for (const removed of g.memberIds.filter((m) => !members.includes(m))) removeFromGroup(g, removed)
    g.memberIds = members
  }
  return ok(groupDto(g, ctx.me))
}))
route('DELETE', '/groups/:id', (ctx) => inGroup(ctx, id(ctx), 'Edit', (g) => {
  for (const p of db.projects.filter((x) => x.groupId === g.id)) deleteProject(p)
  db.groups = db.groups.filter((x) => x.id !== g.id)
  return ok(undefined, 204)
}))
route('POST', '/groups/:id/members/:uid', (ctx) => inGroup(ctx, id(ctx), 'Manage', (g) => {
  const uid = id(ctx, 1)
  if (!db.users.some((u) => u.id === uid && (u.kind === 'Human' || db.aiEnabled))) return NOT_FOUND
  if (!g.memberIds.includes(uid)) g.memberIds.push(uid)
  return ok(groupDto(g, ctx.me))
}))
route('DELETE', '/groups/:id/members/:uid', (ctx) => inGroup(ctx, id(ctx), 'Manage', (g) => {
  const uid = id(ctx, 1)
  if (uid === g.ownerId) return bad("The person who owns a group can't be removed from it.")
  removeFromGroup(g, uid)
  return ok(groupDto(g, ctx.me))
}))

// ---- projects
route('GET', '/projects', ({ me }) => ok(db.projects.filter((p) => canViewProject(me, p)).map((p) => projectDto(p, me))))
route('POST', '/projects', ({ me, body }) => {
  if (!(str(body.name) ?? '').trim()) return bad('Name is required.')
  const groupId = num(body.groupId)
  if (groupId === undefined) return bad('Choose a group for the project.')
  const g = db.groups.find((x) => x.id === groupId)
  if (!g || !canViewGroup(me, g)) return bad('Group not found.')
  if (!canManageGroup(me, g)) return FORBID
  const p: ProjectE = {
    id: ++db.ids.project, name: body.name.trim(), description: str(body.description) ?? '', status: body.status ?? 'Planning',
    startDate: body.startDate ?? todayStr(), dueDate: body.dueDate ?? addDays(30), ownerId: me.id, groupId: g.id,
  }
  db.projects.push(p)
  return ok(projectDto(p, me), 201)
})
route('GET', '/projects/:id', (ctx) => inProject(ctx, id(ctx), 'View', (p) => ok(projectDto(p, ctx.me))))
route('PUT', '/projects/:id', (ctx) => inProject(ctx, id(ctx), 'Manage', (p) => {
  if (!(str(ctx.body.name) ?? '').trim()) return bad('Name is required.')
  p.name = ctx.body.name.trim()
  p.description = str(ctx.body.description) ?? p.description
  p.status = ctx.body.status ?? p.status
  p.startDate = ctx.body.startDate ?? p.startDate
  p.dueDate = ctx.body.dueDate ?? p.dueDate
  return ok(projectDto(p, ctx.me))
}))
route('DELETE', '/projects/:id', (ctx) => inProject(ctx, id(ctx), 'Manage', (p) => { deleteProject(p); return ok(undefined, 204) }))
route('GET', '/projects/:id/summary', (ctx) => inProject(ctx, id(ctx), 'View', (p) => ok(summary(p))))

// ---- tasks
route('GET', '/projects/:id/tasks', (ctx) => inProject(ctx, id(ctx), 'View', (p) => ok(db.tasks.filter((t) => t.projectId === p.id))))
route('POST', '/projects/:id/tasks', (ctx) => inProject(ctx, id(ctx), 'View', (p) => {
  const b = ctx.body
  if (!(str(b.title) ?? '').trim()) return bad('Title is required.')
  const err = validateTaskRefs(p, b.assigneeId, b.goalId)
  if (err) return bad(err)
  const t: TaskE = {
    id: ++db.ids.task, projectId: p.id, title: b.title.trim(), description: str(b.description) ?? '', status: b.status ?? 'Todo',
    priority: b.priority ?? 'Medium', assigneeId: b.assigneeId ?? null, goalId: b.goalId ?? null, dueDate: b.dueDate ?? null,
  }
  db.tasks.push(t)
  kickAgent(t, null, ctx.me)
  return ok(t, 201)
}))
route('PUT', '/tasks/:id', (ctx) => forTask(ctx, id(ctx), (p, t) => {
  const b = ctx.body
  if (!(str(b.title) ?? '').trim()) return bad('Title is required.')
  const err = validateTaskRefs(p, b.assigneeId, b.goalId)
  if (err) return bad(err)
  const previous = t.assigneeId
  t.title = b.title.trim()
  t.description = str(b.description) ?? ''
  t.status = b.status ?? t.status
  t.priority = b.priority ?? t.priority
  t.assigneeId = b.assigneeId ?? null
  t.goalId = b.goalId ?? null
  t.dueDate = b.dueDate ?? null
  kickAgent(t, previous, ctx.me)
  return ok(t)
}))
route('DELETE', '/tasks/:id', (ctx) => forTask(ctx, id(ctx), (_p, t) => { deleteTask(t); return ok(undefined, 204) }))
route('PATCH', '/tasks/:id/status', (ctx) => forTask(ctx, id(ctx), (_p, t) => { t.status = ctx.body.status; return ok(t) }))
route('PATCH', '/tasks/:id/assignee', (ctx) => forTask(ctx, id(ctx), (p, t) => {
  const err = validateTaskRefs(p, ctx.body.assigneeId, null)
  if (err) return bad(err)
  const previous = t.assigneeId
  t.assigneeId = ctx.body.assigneeId ?? null
  kickAgent(t, previous, ctx.me)
  return ok(t)
}))

// ---- goals
route('GET', '/projects/:id/goals', (ctx) => inProject(ctx, id(ctx), 'View', (p) => ok(db.goals.filter((g) => g.projectId === p.id).map(goalDto))))
route('POST', '/projects/:id/goals', (ctx) => inProject(ctx, id(ctx), 'Manage', (p) => {
  if (!(str(ctx.body.title) ?? '').trim()) return bad('Title is required.')
  const g: GoalE = { id: ++db.ids.goal, projectId: p.id, title: ctx.body.title.trim(), description: str(ctx.body.description) ?? '', targetDate: ctx.body.targetDate ?? null }
  db.goals.push(g)
  return ok(goalDto(g), 201)
}))
route('PUT', '/goals/:id', (ctx) => forGoal(ctx, id(ctx), (_p, g) => {
  if (!(str(ctx.body.title) ?? '').trim()) return bad('Title is required.')
  g.title = ctx.body.title.trim()
  g.description = str(ctx.body.description) ?? ''
  g.targetDate = ctx.body.targetDate ?? null
  return ok(goalDto(g))
}))
route('DELETE', '/goals/:id', (ctx) => forGoal(ctx, id(ctx), (_p, g) => {
  for (const t of db.tasks) if (t.goalId === g.id) t.goalId = null
  db.goals = db.goals.filter((x) => x.id !== g.id)
  return ok(undefined, 204)
}))

// ---- AI feature: status and admin settings (the key can't be set in the static demo)
route('GET', '/ai/status', () => ok({ enabled: db.aiEnabled, mode: 'Mock' }))
const settingsDto = () => ({ enabled: db.aiEnabled, mode: 'Mock', defaultModel: db.defaultModel, hasKey: false, keyHint: null, keySource: 'none', models: MODELS })
route('GET', '/admin/ai', ({ me }) => (me.role === 'Admin' ? ok(settingsDto()) : FORBID))
route('PUT', '/admin/ai', ({ me, body }) => {
  if (me.role !== 'Admin') return FORBID
  if (typeof body.apiKey === 'string' && body.apiKey.trim())
    return bad("This is a static demo, so API keys can't be entered here. Run the app locally to use real Claude agents.")
  if (body.defaultModel != null && !MODELS.includes(body.defaultModel)) return bad('Unknown model.')
  if (body.defaultModel != null) db.defaultModel = body.defaultModel
  if (typeof body.enabled === 'boolean') db.aiEnabled = body.enabled
  return ok(settingsDto())
})
route('POST', '/admin/ai/test', ({ me }) => (me.role !== 'Admin' ? FORBID : ok({ ok: false, message: 'This is the static demo: agents give scripted replies and no AI model is called. Run the app locally with a Claude API key to use real Claude.' })))

// ---- agents
route('GET', '/agents/templates', () => (aiOff() ? NOT_FOUND : ok(TEMPLATES)))
route('GET', '/agents', ({ me }) => {
  if (aiOff()) return NOT_FOUND
  return ok(db.agents
    .filter((c) => me.role === 'Admin' || db.groups.some((g) => g.memberIds.includes(c.userId) && canViewGroup(me, g)) || c.createdBy === me.id)
    .map((c) => agentDto(c, me)))
})
route('POST', '/agents', ({ me, body }) => {
  if (aiOff()) return NOT_FOUND
  if (me.role === 'Member') return FORBID
  const err = validateAgent(body, null)
  if (err) return bad(err)
  const wanted: number[] = Array.isArray(body.groupIds) ? body.groupIds : []
  for (const gid of wanted) {
    const g = db.groups.find((x) => x.id === gid)
    if (!g || !canManageGroup(me, g)) return bad('You can only add agents to groups you manage.')
  }
  const name = body.name.trim()
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  const user: UserE = {
    id: Math.max(...db.users.map((u) => u.id)) + 1, kind: 'Agent', name, role: 'Member', password: '',
    email: `${slug || 'agent'}@agents.groupmonkey.local`, color: body.color ?? AGENT_COLORS[0]!,
  }
  db.users.push(user)
  const cfg: AgentCfg = {
    userId: user.id, description: (str(body.description) ?? '').trim(), instructions: (str(body.instructions) ?? '').trim(),
    model: str(body.model) || null, autonomy: body.autonomy ?? 'AskFirst',
    allowedTools: Array.isArray(body.allowedTools) ? [...new Set<string>(body.allowedTools)] : [...OPTIONAL_TOOLS],
    enabled: body.enabled ?? true, dailyRunLimit: body.dailyRunLimit ?? 20, createdBy: me.id,
  }
  db.agents.push(cfg)
  syncGroups(me, user.id, wanted)
  return ok(agentDto(cfg, me), 201)
})
route('PUT', '/agents/:id', (ctx) => {
  if (aiOff()) return NOT_FOUND
  const aid = id(ctx)
  const cfg = db.agents.find((a) => a.userId === aid)
  const user = db.users.find((u) => u.id === aid && u.kind === 'Agent')
  if (!cfg || !user) return NOT_FOUND
  if (!canEditAgent(ctx.me, cfg)) return FORBID
  const err = validateAgent(ctx.body, aid)
  if (err) return bad(err)
  const b = ctx.body
  user.name = b.name.trim()
  user.color = b.color ?? user.color
  cfg.description = str(b.description)?.trim() ?? cfg.description
  cfg.instructions = str(b.instructions)?.trim() ?? cfg.instructions
  if (b.model !== undefined && b.model !== null) cfg.model = b.model === '' ? null : b.model
  cfg.autonomy = b.autonomy ?? cfg.autonomy
  if (Array.isArray(b.allowedTools)) cfg.allowedTools = [...new Set<string>(b.allowedTools)]
  cfg.enabled = b.enabled ?? cfg.enabled
  cfg.dailyRunLimit = b.dailyRunLimit ?? cfg.dailyRunLimit
  if (Array.isArray(b.groupIds)) syncGroups(ctx.me, aid, b.groupIds)
  return ok(agentDto(cfg, ctx.me))
})
route('DELETE', '/agents/:id', (ctx) => {
  if (aiOff()) return NOT_FOUND
  const aid = id(ctx)
  const cfg = db.agents.find((a) => a.userId === aid)
  if (!cfg) return NOT_FOUND
  if (!canEditAgent(ctx.me, cfg)) return FORBID
  for (const g of db.groups.filter((x) => x.memberIds.includes(aid))) removeFromGroup(g, aid)
  db.actions = db.actions.filter((a) => a.agentId !== aid)
  db.runs = db.runs.filter((r) => r.agentId !== aid)
  db.agents = db.agents.filter((a) => a.userId !== aid)
  db.users = db.users.filter((u) => u.id !== aid)
  return ok(undefined, 204)
})

// ---- comments and runs
route('GET', '/tasks/:id/comments', (ctx) => aiOff() ? NOT_FOUND : forTask(ctx, id(ctx), (_p, t) =>
  ok(db.comments.filter((c) => c.taskId === t.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt)))))
route('POST', '/tasks/:id/comments', (ctx) => aiOff() ? NOT_FOUND : forTask(ctx, id(ctx), (_p, t) => {
  const text = str(ctx.body.body)?.trim()
  if (!text) return bad('Write something first.')
  if (text.length > 8000) return bad('That comment is too long.')
  const c = { id: ++db.ids.comment, taskId: t.id, authorId: ctx.me.id, body: text, createdAt: nowIso() }
  db.comments.push(c)
  // A reply to an agent that asked for input picks the work back up.
  if (t.assigneeId !== null && isAgent(t.assigneeId)) {
    const last = db.runs.filter((r) => r.taskId === t.id && r.agentId === t.assigneeId).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
    if (last?.status === 'NeedsInput') tryStart(t.id, t.assigneeId, `Reply from ${ctx.me.name}`)
  }
  return ok(c, 201)
}))
route('POST', '/tasks/:id/run', (ctx) => aiOff() ? NOT_FOUND : forTask(ctx, id(ctx), (_p, t) => {
  if (t.assigneeId === null || !isAgent(t.assigneeId)) return bad('Assign this task to an agent first.')
  const { run, error } = tryStart(t.id, t.assigneeId, `Run now by ${ctx.me.name}`)
  return run ? ok(runDto(run), 202) : bad(error ?? 'Could not start the run.')
}))
route('GET', '/tasks/:id/runs', (ctx) => aiOff() ? NOT_FOUND : forTask(ctx, id(ctx), (_p, t) =>
  ok(db.runs.filter((r) => r.taskId === t.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 20).map(runDto))))
route('GET', '/runs/recent', ({ me }) => {
  if (aiOff()) return NOT_FOUND
  const viewable = new Set(db.projects.filter((p) => canViewProject(me, p)).map((p) => p.id))
  return ok(db.runs.filter((r) => viewable.has(r.projectId)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 12)
    .map((r) => ({ id: r.id, agentId: r.agentId, taskId: r.taskId, projectId: r.projectId, taskTitle: taskTitle(r.taskId), status: r.status, createdAt: r.createdAt, endedAt: r.endedAt, provider: r.provider })))
})
const withRun = (ctx: Ctx, act: (r: RunE) => DemoResult) => {
  if (aiOff()) return NOT_FOUND
  const r = db.runs.find((x) => x.id === id(ctx))
  return r ? inProject(ctx, r.projectId, 'View', () => act(r)) : NOT_FOUND
}
route('GET', '/runs/:id', (ctx) => withRun(ctx, (r) => ok(runDto(r))))
route('POST', '/runs/:id/cancel', (ctx) => withRun(ctx, (r) => {
  if (r.status === 'Queued') { addStep(r, 'Message', 'Cancelled before it started.'); finish(r, 'Cancelled') }
  else if (r.status === 'Running') finish(r, 'Cancelled')
  return ok(runDto(r))
}))

// ---- approvals
route('GET', '/approvals', ({ me }) => aiOff() ? NOT_FOUND : ok(
  db.actions.filter((a) => a.state === 'Pending' && db.projects.some((p) => p.id === a.projectId && canManageProject(me, p)))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map(actionDto)))

function decide(ctx: Ctx, approve: boolean): DemoResult {
  if (aiOff()) return NOT_FOUND
  const action = db.actions.find((a) => a.id === id(ctx))
  const project = action ? db.projects.find((p) => p.id === action.projectId) : undefined
  if (!action || !project || !canViewProject(ctx.me, project)) return NOT_FOUND
  if (!canManageProject(ctx.me, project)) return FORBID
  if (action.state !== 'Pending') return bad('That proposal has already been decided.')
  const run = db.runs.find((r) => r.id === action.runId)
  if (approve) {
    if (!run || !db.agents.some((c) => c.userId === action.agentId)) return bad('The agent that proposed this no longer exists.')
    const result = runTool(run, action.tool, action.args, true)
    if (result.isError) return bad(result.content)
    action.state = 'Approved'
  } else {
    action.state = 'Rejected'
  }
  action.decidedBy = ctx.me.id
  if (run) {
    addStep(run, 'Message', `${approve ? 'Approved' : 'Rejected'} by ${ctx.me.name}: ${action.summary}`)
    settle(run)
  }
  return ok(actionDto(action))
}
route('POST', '/approvals/:id/approve', (ctx) => decide(ctx, true))
route('POST', '/approvals/:id/reject', (ctx) => decide(ctx, false))

// ---------------------------------------------------------------- entry point

function currentUser(token: string | null): UserE | null {
  const m = /^demo\.(\d+)$/.exec(token ?? '')
  return (m && db.users.find((u) => u.id === Number(m[1]) && u.kind === 'Human')) || null
}

/** Handles one API request entirely in memory. `path` is relative to /api (e.g. "/projects/1/tasks"). */
export async function handle(method: string, path: string, body: unknown, token: string | null): Promise<DemoResult> {
  const clean = path.split('?')[0]!
  for (const r of routes) {
    if (r.method !== method) continue
    const m = r.re.exec(clean)
    if (!m) continue
    const me = currentUser(token)
    if (r.auth && !me) return { status: 401 }
    const input = body === undefined ? {} : (JSON.parse(JSON.stringify(body)) as Body)
    const result = r.fn({ me: me as UserE, params: m.slice(1), body: input })
    // Hand out copies so callers can never mutate the store.
    return { status: result.status, data: result.data === undefined ? undefined : JSON.parse(JSON.stringify(result.data)) }
  }
  return { status: 404 }
}

