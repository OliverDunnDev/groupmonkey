// In-browser stand-in for the .NET API's in-memory store. Mirrors src/GroupMonkey.Api/Data/{DataStore,SeedData}.cs.
// Written without enums or parameter properties and with explicit .ts import paths so Node can run it directly
// (used by a parity check against the real API).

import type {
  ActionState, Autonomy, Priority, ProjectStatus, Role, RunStatus, RunStep, UserKind, WorkStatus,
} from '../types.ts'

export interface UserE { id: number; name: string; email: string; password: string; role: Role; color: string; kind: UserKind }
export interface GroupE { id: number; name: string; description: string; color: string; ownerId: number; memberIds: number[] }
export interface ProjectE {
  id: number; name: string; description: string; status: ProjectStatus; startDate: string; dueDate: string; ownerId: number; groupId: number
}
export interface TaskE {
  id: number; projectId: number; goalId: number | null; assigneeId: number | null; title: string; description: string
  status: WorkStatus; priority: Priority; dueDate: string | null
}
export interface GoalE { id: number; projectId: number; title: string; description: string; targetDate: string | null }
export interface AgentCfg {
  userId: number; description: string; instructions: string; model: string | null; autonomy: Autonomy
  allowedTools: string[]; enabled: boolean; createdBy: number; dailyRunLimit: number
}
export interface CommentE { id: number; taskId: number; authorId: number; body: string; createdAt: string }
export interface RunE {
  id: number; agentId: number; taskId: number; projectId: number; status: RunStatus; createdAt: string
  startedAt: string | null; endedAt: string | null; provider: string; model: string | null
  inputTokens: number; outputTokens: number; error: string | null; triggeredBy: string | null
  steps: RunStep[]; actionIds: number[]
}
export interface ActionE {
  id: number; runId: number; agentId: number; projectId: number; taskId: number; tool: string
  args: Record<string, unknown>; summary: string; state: ActionState; decidedBy: number | null; createdAt: string
}

export interface Db {
  users: UserE[]; groups: GroupE[]; projects: ProjectE[]; tasks: TaskE[]; goals: GoalE[]
  agents: AgentCfg[]; comments: CommentE[]; runs: RunE[]; actions: ActionE[]
  aiEnabled: boolean
  defaultModel: string
  ids: { group: number; project: number; task: number; goal: number; comment: number; run: number; action: number }
}

export const MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-fable-5-1']
export const OPTIONAL_TOOLS = ['add_comment', 'update_task_status', 'create_task', 'assign_task', 'request_human_input']

export function dateStr(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export function todayStr(): string {
  return dateStr(new Date())
}

export function addDays(days: number): string {
  const d = new Date()
  d.setHours(12, 0, 0, 0)
  d.setDate(d.getDate() + days)
  return dateStr(d)
}

export function nowIso(): string {
  return new Date().toISOString()
}

function minutesAgo(m: number): string {
  return new Date(Date.now() - m * 60_000).toISOString()
}

export function createDb(): Db {
  const db: Db = {
    users: [], groups: [], projects: [], tasks: [], goals: [], agents: [], comments: [], runs: [], actions: [],
    aiEnabled: false,
    defaultModel: 'claude-opus-5-5',
    ids: { group: 0, project: 0, task: 0, goal: 0, comment: 0, run: 0, action: 0 },
  }
  const D = addDays

  db.users.push(
    { id: 1, name: 'Ava Admin', email: 'admin@groupmonkey.dev', password: 'password123', role: 'Admin', color: '#FFD400', kind: 'Human' },
    { id: 2, name: 'Marcus Manager', email: 'manager@groupmonkey.dev', password: 'password123', role: 'Manager', color: '#FFFFFF', kind: 'Human' },
    { id: 3, name: 'Priya Patel', email: 'member@groupmonkey.dev', password: 'password123', role: 'Member', color: '#FFB800', kind: 'Human' },
    { id: 4, name: 'Sam Okafor', email: 'sam@groupmonkey.dev', password: 'password123', role: 'Member', color: '#E8E3D3', kind: 'Human' },
  )

  const group = (name: string, description: string, color: string, ownerId: number, memberIds: number[]): GroupE => {
    const g: GroupE = { id: ++db.ids.group, name, description, color, ownerId, memberIds }
    db.groups.push(g)
    return g
  }
  const webTeam = group('Web Team', 'Design, content and engineering for the public website.', '#FFD400', 2, [1, 2, 3, 4])
  const mobileTeam = group('Mobile Team', 'Builds and ships the customer mobile app.', '#0A0A0A', 2, [2, 3, 4])
  const opsTeam = group('Platform & Ops', 'Internal tooling and operations.', '#FFFFFF', 1, [1, 2, 4])

  const project = (g: GroupE, name: string, description: string, status: ProjectStatus, start: number, due: number, ownerId: number): ProjectE => {
    const p: ProjectE = { id: ++db.ids.project, name, description, status, startDate: D(start), dueDate: D(due), ownerId, groupId: g.id }
    db.projects.push(p)
    return p
  }
  const goal = (p: ProjectE, title: string, description: string, target: number): GoalE => {
    const g: GoalE = { id: ++db.ids.goal, projectId: p.id, title, description, targetDate: D(target) }
    db.goals.push(g)
    return g
  }
  const task = (p: ProjectE, title: string, status: WorkStatus, priority: Priority, assigneeId: number | null, g: GoalE | null, due: number | null, description = ''): TaskE => {
    const t: TaskE = {
      id: ++db.ids.task, projectId: p.id, goalId: g?.id ?? null, assigneeId, title, description, status, priority,
      dueDate: due === null ? null : D(due),
    }
    db.tasks.push(t)
    return t
  }

  // Project 1: Website Relaunch (Web Team)
  const web = project(webTeam, 'Website Relaunch', 'Redesign and rebuild the public marketing site with a faster, cleaner experience.', 'Active', -30, 45, 2)
  const webHome = goal(web, 'Launch new homepage', 'Ship the redesigned homepage to production.', 21)
  const webBlog = goal(web, 'Migrate blog content', 'Move all existing posts to the new CMS with redirects.', 35)
  const webPerf = goal(web, 'Lighthouse score 90+', 'Hit 90+ on performance and accessibility.', 40)
  task(web, 'Homepage wireframes', 'Done', 'Medium', 3, webHome, -20)
  task(web, 'Visual design system', 'Done', 'High', 3, webHome, -10, 'Colour, type and component library.')
  task(web, 'Hero section build', 'InProgress', 'High', 4, webHome, 5)
  task(web, 'Navigation component', 'Review', 'Medium', 4, webHome, 3)
  task(web, 'Set up CMS', 'Done', 'High', 2, webBlog, -5)
  task(web, 'Export legacy blog posts', 'InProgress', 'Medium', 1, webBlog, 10)
  const redirects = task(web, 'Write redirect map', 'Todo', 'Medium', 1, webBlog, 20)
  task(web, 'Image optimisation pipeline', 'Todo', 'High', 4, webPerf, 25)
  task(web, 'Accessibility audit', 'Todo', 'Urgent', 3, webPerf, -2, 'Overdue: needs attention.')
  task(web, 'Homepage copy', 'Review', 'Low', 1, webHome, 7)

  // Project 2: Mobile App v2 (Mobile Team)
  const app = project(mobileTeam, 'Mobile App v2', 'Second major release of the customer mobile app with offline mode and push notifications.', 'Active', -60, 90, 2)
  const appOffline = goal(app, 'Offline mode', 'Core screens usable without a connection.', 40)
  const appPush = goal(app, 'Push notifications', 'Reliable, preference-aware notifications.', 60)
  task(app, 'Local data cache', 'Done', 'High', 4, appOffline, -15)
  task(app, 'Sync conflict resolution', 'InProgress', 'Urgent', 4, appOffline, 12)
  task(app, 'Offline banner UI', 'Done', 'Low', 3, appOffline, -8)
  task(app, 'Queue writes while offline', 'Todo', 'High', 3, appOffline, 20)
  task(app, 'Notification service', 'InProgress', 'High', 2, appPush, 25)
  task(app, 'Preference screen', 'Todo', 'Medium', 3, appPush, 30)
  const matrix = task(app, 'Device matrix test plan', 'Review', 'Medium', 3, appPush, 15)
  task(app, 'Crash reporting integration', 'Done', 'Medium', 4, null, -25)

  // Project 3: Internal Tooling (Platform & Ops)
  const tool = project(opsTeam, 'Internal Tooling', 'Replace spreadsheets and ad-hoc scripts with proper internal dashboards.', 'Planning', -5, 120, 1)
  const toolDash = goal(tool, 'Ops dashboard v1', 'Single view for deployment and incident status.', 60)
  const toolAuto = goal(tool, 'Automate onboarding', 'New-starter accounts created automatically.', 100)
  task(tool, 'Gather requirements', 'Done', 'Medium', 2, toolDash, -3)
  task(tool, 'Pick dashboard framework', 'InProgress', 'Medium', 4, toolDash, 7)
  task(tool, 'Data source inventory', 'Todo', 'Low', 2, toolDash, 14)
  task(tool, 'Identity provider integration', 'Todo', 'High', 1, toolAuto, 45)
  task(tool, 'Onboarding checklist spec', 'Todo', 'Medium', 2, toolAuto, 30)

  // ---- demo AI agents: hidden until the AI switch is turned on ----
  db.users.push(
    { id: 5, name: 'Scout', email: 'scout@agents.groupmonkey.local', password: '', role: 'Member', color: '#0A0A0A', kind: 'Agent' },
    { id: 6, name: 'Patch', email: 'patch@agents.groupmonkey.local', password: '', role: 'Member', color: '#0A0A0A', kind: 'Agent' },
  )
  db.agents.push(
    {
      userId: 5, createdBy: 1, autonomy: 'AskFirst', model: null, enabled: true, dailyRunLimit: 20,
      description: 'Research assistant that gathers context and writes up findings.',
      instructions: 'Research the topic using the project context. Structure findings with clear headings, state assumptions, and list open questions.',
      allowedTools: ['add_comment', 'update_task_status', 'request_human_input'],
    },
    {
      userId: 6, createdBy: 1, autonomy: 'Suggest', model: null, enabled: true, dailyRunLimit: 20,
      description: 'QA reviewer that checks work for gaps and risks. Comments only.',
      instructions: 'Produce a short checklist of things to verify and edge cases to test. Only comment; people decide what to change.',
      allowedTools: ['add_comment', 'request_human_input'],
    },
  )
  webTeam.memberIds.push(5, 6)
  mobileTeam.memberIds.push(5, 6)
  redirects.assigneeId = 5
  matrix.assigneeId = 6

  const scoutRun: RunE = {
    id: ++db.ids.run, agentId: 5, taskId: redirects.id, projectId: web.id, status: 'AwaitingApproval',
    createdAt: minutesAgo(42), startedAt: minutesAgo(42), endedAt: minutesAgo(41), provider: 'Mock', model: null,
    inputTokens: 0, outputTokens: 0, error: null, triggeredBy: 'Assigned by Ava Admin', actionIds: [],
    steps: [
      { type: 'Thought', content: 'Demo data: a scripted example of what a run looks like.', at: minutesAgo(42) },
      { type: 'ToolCall', content: `get_task {"task_id":${redirects.id}}`, at: minutesAgo(42) },
      { type: 'ToolResult', content: 'Task details returned.', at: minutesAgo(42) },
      { type: 'ToolCall', content: `add_comment {"task_id":${redirects.id}}`, at: minutesAgo(41) },
      { type: 'ToolResult', content: `Comment posted on task #${redirects.id}.`, at: minutesAgo(41) },
    ],
  }
  db.runs.push(scoutRun)
  db.comments.push({
    id: ++db.ids.comment, taskId: redirects.id, authorId: 5, createdAt: minutesAgo(41),
    body: '**Redirect map: first pass**\n\n- Group old URLs by section (blog, press, docs) so rules can be written per prefix.\n- Keep trailing-slash and lower-case variants as separate checks.\n- Open question: do archived posts keep their original dates in the new CMS?\n\n_Demo content generated for the seed data._',
  })
  const proposal: ActionE = {
    id: ++db.ids.action, runId: scoutRun.id, agentId: 5, projectId: web.id, taskId: redirects.id, tool: 'update_task_status',
    args: { task_id: redirects.id, status: 'Review' }, state: 'Pending', decidedBy: null, createdAt: minutesAgo(41),
    summary: `Move task #${redirects.id} "${redirects.title}" from Todo to Review`,
  }
  db.actions.push(proposal)
  scoutRun.actionIds.push(proposal.id)

  const patchRun: RunE = {
    id: ++db.ids.run, agentId: 6, taskId: matrix.id, projectId: app.id, status: 'Succeeded',
    createdAt: minutesAgo(180), startedAt: minutesAgo(180), endedAt: minutesAgo(179), provider: 'Mock', model: null,
    inputTokens: 0, outputTokens: 0, error: null, triggeredBy: 'Assigned by Marcus Manager', actionIds: [],
    steps: [
      { type: 'Thought', content: 'Demo data: a scripted example of what a run looks like.', at: minutesAgo(180) },
      { type: 'ToolCall', content: `add_comment {"task_id":${matrix.id}}`, at: minutesAgo(180) },
      { type: 'ToolResult', content: `Comment posted on task #${matrix.id}.`, at: minutesAgo(180) },
    ],
  }
  db.runs.push(patchRun)
  db.comments.push({
    id: ++db.ids.comment, taskId: matrix.id, authorId: 6, createdAt: minutesAgo(180),
    body: '**Test plan review**\n\n- [ ] Cover the two most recent OS versions and one older baseline on each platform.\n- [ ] Include a small-screen phone and a tablet.\n- [ ] Test offline mode with a flaky connection, not only airplane mode.\n- [ ] Confirm push permissions on first launch and after a reinstall.\n\n_Demo content generated for the seed data._',
  })

  return db
}

export let db: Db = createDb()

/** Back to the seed data (used by tests / a future "reset demo" button). */
export function resetDb(): void {
  db = createDb()
}
