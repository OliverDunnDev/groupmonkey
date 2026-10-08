import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import type {
  Agent, AgentInput, AgentTemplate, AiSettings, AiStatus, Comment, Goal, Group, ProposedAction, Project, ProjectInput,
  ProjectSummary, Run, RunSummary, Task, TaskInput, User, WorkStatus,
} from '../types'
import { isActiveRun } from '../types'
import { api } from './client'

// All project-scoped data lives under ['p', projectId, ...] so one invalidation refreshes the lot.
export const keys = {
  projects: ['projects'] as const,
  users: ['users'] as const,
  project: (id: number) => ['p', id, 'project'] as const,
  summary: (id: number) => ['p', id, 'summary'] as const,
  tasks: (id: number) => ['p', id, 'tasks'] as const,
  groups: (id: number) => ['p', id, 'groups'] as const,
  goals: (id: number) => ['p', id, 'goals'] as const,
}

export const useUsers = () => useQuery({ queryKey: keys.users, queryFn: () => api<User[]>('/users') })
export const useProjects = () => useQuery({ queryKey: keys.projects, queryFn: () => api<Project[]>('/projects') })
export const useProject = (id: number) =>
  useQuery({ queryKey: keys.project(id), queryFn: () => api<Project>(`/projects/${id}`) })
export const useSummary = (id: number) =>
  useQuery({ queryKey: keys.summary(id), queryFn: () => api<ProjectSummary>(`/projects/${id}/summary`) })
export const useTasks = (id: number) =>
  useQuery({ queryKey: keys.tasks(id), queryFn: () => api<Task[]>(`/projects/${id}/tasks`) })
export const useGroups = (id: number) =>
  useQuery({ queryKey: keys.groups(id), queryFn: () => api<Group[]>(`/projects/${id}/groups`) })
export const useGoals = (id: number) =>
  useQuery({ queryKey: keys.goals(id), queryFn: () => api<Goal[]>(`/projects/${id}/goals`) })

function useRefresh(projectId?: number) {
  const qc = useQueryClient()
  return () => {
    qc.invalidateQueries({ queryKey: projectId ? ['p', projectId] : ['p'] })
    qc.invalidateQueries({ queryKey: keys.projects })
    // Assigning a task can start an agent run; pick up the new run straight away.
    qc.invalidateQueries({ queryKey: ['ai'] })
  }
}

export function useSaveProject(id?: number) {
  const refresh = useRefresh(id)
  return useMutation({
    mutationFn: (input: ProjectInput) =>
      id ? api<Project>(`/projects/${id}`, { method: 'PUT', body: input }) : api<Project>('/projects', { method: 'POST', body: input }),
    onSuccess: refresh,
  })
}

export function useDeleteProject(id: number) {
  const refresh = useRefresh()
  return useMutation({ mutationFn: () => api<void>(`/projects/${id}`, { method: 'DELETE' }), onSuccess: refresh })
}

export function useSaveTask(projectId: number, taskId?: number) {
  const refresh = useRefresh(projectId)
  return useMutation({
    mutationFn: (input: TaskInput) =>
      taskId
        ? api<Task>(`/tasks/${taskId}`, { method: 'PUT', body: input })
        : api<Task>(`/projects/${projectId}/tasks`, { method: 'POST', body: input }),
    onSuccess: refresh,
  })
}

export function useDeleteTask(projectId: number) {
  const refresh = useRefresh(projectId)
  return useMutation({ mutationFn: (id: number) => api<void>(`/tasks/${id}`, { method: 'DELETE' }), onSuccess: refresh })
}

// Optimistic so board drags feel instant; rolls back on failure.
export function useMoveTask(projectId: number) {
  const qc = useQueryClient()
  const refresh = useRefresh(projectId)
  return useMutation({
    mutationFn: ({ id, status }: { id: number; status: WorkStatus }) =>
      api<Task>(`/tasks/${id}/status`, { method: 'PATCH', body: { status } }),
    onMutate: async ({ id, status }) => {
      await qc.cancelQueries({ queryKey: keys.tasks(projectId) })
      const prev = qc.getQueryData<Task[]>(keys.tasks(projectId))
      qc.setQueryData<Task[]>(keys.tasks(projectId), (old) => old?.map((t) => (t.id === id ? { ...t, status } : t)))
      return { prev }
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(keys.tasks(projectId), ctx.prev)
    },
    onSettled: refresh,
  })
}

export function useSaveGroup(projectId: number, groupId?: number) {
  const refresh = useRefresh(projectId)
  return useMutation({
    mutationFn: (input: { name: string; color: string }) =>
      groupId
        ? api<Group>(`/groups/${groupId}`, { method: 'PUT', body: input })
        : api<Group>(`/projects/${projectId}/groups`, { method: 'POST', body: input }),
    onSuccess: refresh,
  })
}

export function useDeleteGroup(projectId: number) {
  const refresh = useRefresh(projectId)
  return useMutation({ mutationFn: (id: number) => api<void>(`/groups/${id}`, { method: 'DELETE' }), onSuccess: refresh })
}

export function useGroupMember(projectId: number) {
  const refresh = useRefresh(projectId)
  return useMutation({
    mutationFn: ({ groupId, userId, add }: { groupId: number; userId: number; add: boolean }) =>
      api<Group>(`/groups/${groupId}/members/${userId}`, { method: add ? 'POST' : 'DELETE' }),
    onSuccess: refresh,
  })
}

export function useSaveGoal(projectId: number, goalId?: number) {
  const refresh = useRefresh(projectId)
  return useMutation({
    mutationFn: (input: { title: string; description: string; targetDate: string | null }) =>
      goalId
        ? api<Goal>(`/goals/${goalId}`, { method: 'PUT', body: input })
        : api<Goal>(`/projects/${projectId}/goals`, { method: 'POST', body: input }),
    onSuccess: refresh,
  })
}

export function useDeleteGoal(projectId: number) {
  const refresh = useRefresh(projectId)
  return useMutation({ mutationFn: (id: number) => api<void>(`/goals/${id}`, { method: 'DELETE' }), onSuccess: refresh })
}

// ---------------------------------------------------------------------------
// AI agents (optional feature). Everything here lives under ['ai', ...].
// ---------------------------------------------------------------------------

export const aiKeys = {
  status: ['ai', 'status'] as const,
  settings: ['ai', 'settings'] as const,
  agents: ['ai', 'agents'] as const,
  templates: ['ai', 'templates'] as const,
  approvals: ['ai', 'approvals'] as const,
  recent: ['ai', 'recent'] as const,
  comments: (taskId: number) => ['ai', 'task', taskId, 'comments'] as const,
  runs: (taskId: number) => ['ai', 'task', taskId, 'runs'] as const,
}

export const useAiStatus = () =>
  useQuery({ queryKey: aiKeys.status, queryFn: () => api<AiStatus>('/ai/status'), staleTime: 30_000 })

/** True once the server reports the AI feature switched on. */
export function useAiEnabled() {
  return useAiStatus().data?.enabled === true
}

export const useAiSettings = (enabled: boolean) =>
  useQuery({ queryKey: aiKeys.settings, queryFn: () => api<AiSettings>('/admin/ai'), enabled })

export function useSaveAiSettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { enabled?: boolean; defaultModel?: string; apiKey?: string; clearKey?: boolean }) =>
      api<AiSettings>('/admin/ai', { method: 'PUT', body: input }),
    onSuccess: (data) => {
      qc.setQueryData(aiKeys.settings, data)
      // Turning the feature on or off changes what every screen shows.
      qc.invalidateQueries()
    },
  })
}

export const useTestAi = () =>
  useMutation({ mutationFn: () => api<{ ok: boolean; message: string }>('/admin/ai/test', { method: 'POST' }) })

export const useAgents = (enabled: boolean) =>
  useQuery({ queryKey: aiKeys.agents, queryFn: () => api<Agent[]>('/agents'), enabled })

export const useAgentTemplates = (enabled: boolean) =>
  useQuery({ queryKey: aiKeys.templates, queryFn: () => api<AgentTemplate[]>('/agents/templates'), enabled, staleTime: Infinity })

function useRefreshAi() {
  const qc = useQueryClient()
  return () => {
    qc.invalidateQueries({ queryKey: ['ai'] })
    qc.invalidateQueries({ queryKey: ['p'] })
    qc.invalidateQueries({ queryKey: keys.projects })
    qc.invalidateQueries({ queryKey: keys.users })
  }
}

export function useSaveAgent(agentId?: number) {
  const refresh = useRefreshAi()
  return useMutation({
    mutationFn: (input: AgentInput) =>
      agentId ? api<Agent>(`/agents/${agentId}`, { method: 'PUT', body: input }) : api<Agent>('/agents', { method: 'POST', body: input }),
    onSuccess: refresh,
  })
}

export function useDeleteAgent() {
  const refresh = useRefreshAi()
  return useMutation({ mutationFn: (id: number) => api<void>(`/agents/${id}`, { method: 'DELETE' }), onSuccess: refresh })
}

export const useApprovals = (enabled: boolean) =>
  useQuery({ queryKey: aiKeys.approvals, queryFn: () => api<ProposedAction[]>('/approvals'), enabled })

export function useDecide() {
  const refresh = useRefreshAi()
  return useMutation({
    mutationFn: ({ id, approve }: { id: number; approve: boolean }) =>
      api<ProposedAction>(`/approvals/${id}/${approve ? 'approve' : 'reject'}`, { method: 'POST' }),
    onSuccess: refresh,
  })
}

export const useRecentRuns = (enabled: boolean) =>
  useQuery({
    queryKey: aiKeys.recent,
    queryFn: () => api<RunSummary[]>('/runs/recent'),
    enabled,
    // Poll quickly while something is running, slowly otherwise.
    refetchInterval: (q) => (q.state.data?.some((r) => isActiveRun(r.status)) ? 2000 : 15_000),
  })

/** Task runs, polled while any run is active so the timeline updates live. */
export const useTaskRuns = (taskId: number, enabled: boolean) =>
  useQuery({
    queryKey: aiKeys.runs(taskId),
    queryFn: () => api<Run[]>(`/tasks/${taskId}/runs`),
    enabled,
    refetchInterval: (q) => (q.state.data?.some((r) => isActiveRun(r.status)) ? 1500 : false),
  })

export const useComments = (taskId: number, enabled: boolean, live: boolean) =>
  useQuery({
    queryKey: aiKeys.comments(taskId),
    queryFn: () => api<Comment[]>(`/tasks/${taskId}/comments`),
    enabled,
    refetchInterval: live ? 1500 : false,
  })

export function useAddComment(taskId: number) {
  const refresh = useRefreshAi()
  return useMutation({
    mutationFn: (body: string) => api<Comment>(`/tasks/${taskId}/comments`, { method: 'POST', body: { body } }),
    onSuccess: refresh,
  })
}

export function useRunNow(taskId: number) {
  const refresh = useRefreshAi()
  return useMutation({ mutationFn: () => api<Run>(`/tasks/${taskId}/run`, { method: 'POST' }), onSuccess: refresh })
}

export function useCancelRun() {
  const refresh = useRefreshAi()
  return useMutation({ mutationFn: (id: number) => api<Run>(`/runs/${id}/cancel`, { method: 'POST' }), onSuccess: refresh })
}

/**
 * Watches agent activity. When runs finish, refreshes boards, progress and approvals so the UI
 * reflects what the agents just did without a manual reload.
 */
export function useAgentWatcher() {
  const qc = useQueryClient()
  const enabled = useAiEnabled()
  const { data } = useRecentRuns(enabled)
  const previous = useRef<Map<number, string>>(new Map())

  useEffect(() => {
    if (!data) return
    const next = new Map(data.map((r) => [r.id, r.status as string]))
    const finished = data.some((r) => {
      const was = previous.current.get(r.id)
      return was !== undefined && was !== r.status && !isActiveRun(r.status)
    })
    previous.current = next
    if (finished) {
      qc.invalidateQueries({ queryKey: ['p'] })
      qc.invalidateQueries({ queryKey: ['ai'] })
      qc.invalidateQueries({ queryKey: keys.projects })
    }
  }, [data, qc])
}
