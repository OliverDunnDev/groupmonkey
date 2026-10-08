export type Role = 'Admin' | 'Manager' | 'Member'
export type ProjectStatus = 'Planning' | 'Active' | 'OnHold' | 'Completed'
export type WorkStatus = 'Todo' | 'InProgress' | 'Review' | 'Done'
export type Priority = 'Low' | 'Medium' | 'High' | 'Urgent'

export const WORK_STATUSES: WorkStatus[] = ['Todo', 'InProgress', 'Review', 'Done']
export const STATUS_LABEL: Record<WorkStatus, string> = {
  Todo: 'To Do',
  InProgress: 'In Progress',
  Review: 'Review',
  Done: 'Done',
}
export const PRIORITIES: Priority[] = ['Low', 'Medium', 'High', 'Urgent']
export const PROJECT_STATUSES: ProjectStatus[] = ['Planning', 'Active', 'OnHold', 'Completed']

export type UserKind = 'Human' | 'Agent'

export interface User {
  id: number
  name: string
  email: string
  role: Role
  color: string
  kind: UserKind
}

// ---- AI agents (optional feature) ----
export type Autonomy = 'Suggest' | 'AskFirst' | 'Autonomous'
export type RunStatus = 'Queued' | 'Running' | 'AwaitingApproval' | 'NeedsInput' | 'Succeeded' | 'Failed' | 'Cancelled'
export type StepType = 'Thought' | 'ToolCall' | 'ToolResult' | 'Message'
export type ActionState = 'Pending' | 'Approved' | 'Rejected'

export const AUTONOMY_OPTIONS: { value: Autonomy; label: string; help: string }[] = [
  { value: 'Suggest', label: 'Suggest only', help: 'Reads and comments. Never changes tasks.' },
  { value: 'AskFirst', label: 'Ask first', help: 'Changes wait for a manager to approve.' },
  { value: 'Autonomous', label: 'Autonomous', help: 'Changes apply immediately.' },
]

export const TOOL_OPTIONS: { value: string; label: string }[] = [
  { value: 'add_comment', label: 'Post comments' },
  { value: 'update_task_status', label: 'Change task status' },
  { value: 'create_task', label: 'Create tasks' },
  { value: 'assign_task', label: 'Assign tasks to people' },
  { value: 'request_human_input', label: 'Ask people questions' },
]

export const RUN_LABEL: Record<RunStatus, string> = {
  Queued: 'Queued',
  Running: 'Working',
  AwaitingApproval: 'Needs approval',
  NeedsInput: 'Needs input',
  Succeeded: 'Finished',
  Failed: 'Failed',
  Cancelled: 'Cancelled',
}

export const MODEL_LABEL: Record<string, string> = {
  'claude-opus-5-5': 'Claude Opus 5.5',
  'claude-sonnet-5-5': 'Claude Sonnet 5.5',
  'claude-haiku-5-5': 'Claude Haiku 5.5',
  'claude-fable-5-1': 'Claude Fable 5.1',
}

export const isActiveRun = (s: RunStatus) => s === 'Queued' || s === 'Running'

export interface AiStatus {
  enabled: boolean
  mode: 'Mock' | 'Claude'
}

export interface AiSettings {
  enabled: boolean
  mode: 'Mock' | 'Claude'
  defaultModel: string
  hasKey: boolean
  keyHint: string | null
  keySource: 'none' | 'admin' | 'config'
  models: string[]
}

export interface Agent {
  userId: number
  name: string
  color: string
  description: string
  instructions: string
  model: string | null
  autonomy: Autonomy
  allowedTools: string[]
  enabled: boolean
  dailyRunLimit: number
  projectIds: number[]
  runsToday: number
  lastRunStatus: RunStatus | null
  lastRunAt: string | null
  activeRuns: number
  canEdit: boolean
}

export interface AgentTemplate {
  key: string
  name: string
  description: string
  instructions: string
  autonomy: Autonomy
  allowedTools: string[]
  color: string
}

export interface AgentInput {
  name: string
  description: string
  instructions: string
  model: string | null
  autonomy: Autonomy
  allowedTools: string[]
  enabled: boolean
  dailyRunLimit: number
  projectIds: number[]
  color: string
}

export interface Comment {
  id: number
  taskId: number
  authorId: number
  body: string
  createdAt: string
}

export interface RunStep {
  type: StepType
  content: string
  at: string
}

export interface ProposedAction {
  id: number
  runId: number
  agentId: number
  projectId: number
  taskId: number
  taskTitle: string
  tool: string
  summary: string
  state: ActionState
  decidedBy: number | null
  createdAt: string
}

export interface Run {
  id: number
  agentId: number
  taskId: number
  projectId: number
  status: RunStatus
  createdAt: string
  startedAt: string | null
  endedAt: string | null
  provider: string
  model: string | null
  inputTokens: number
  outputTokens: number
  error: string | null
  triggeredBy: string | null
  steps: RunStep[]
  actions: ProposedAction[]
}

export interface RunSummary {
  id: number
  agentId: number
  taskId: number
  projectId: number
  taskTitle: string
  status: RunStatus
  createdAt: string
  endedAt: string | null
  provider: string
}

export interface LoginResponse {
  token: string
  user: User
}

export interface Project {
  id: number
  name: string
  description: string
  status: ProjectStatus
  startDate: string
  dueDate: string
  ownerId: number
  memberIds: number[]
  taskCount: number
  doneCount: number
  percent: number
  canManage: boolean
  canEdit: boolean
}

export interface Group {
  id: number
  projectId: number
  name: string
  color: string
  memberIds: number[]
  taskCount: number
  doneCount: number
  percent: number
}

export interface Task {
  id: number
  projectId: number
  groupId: number | null
  goalId: number | null
  assigneeId: number | null
  title: string
  description: string
  status: WorkStatus
  priority: Priority
  dueDate: string | null
}

export interface Goal {
  id: number
  projectId: number
  title: string
  description: string
  targetDate: string | null
  taskCount: number
  doneCount: number
  percent: number
}

export interface ProjectSummary {
  projectId: number
  total: number
  done: number
  percent: number
  overdue: number
  byStatus: Record<WorkStatus, number>
  groups: { groupId: number; name: string; color: string; total: number; done: number; percent: number }[]
  members: { userId: number; total: number; done: number; percent: number }[]
}

export interface TaskInput {
  title: string
  description: string
  status: WorkStatus
  priority: Priority
  assigneeId: number | null
  groupId: number | null
  goalId: number | null
  dueDate: string | null
}

export interface ProjectInput {
  name: string
  description: string
  status: ProjectStatus
  startDate: string | null
  dueDate: string | null
  memberIds: number[]
}
