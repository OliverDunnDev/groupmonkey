import { useQueries } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import { keys, useAiEnabled, useGroups, useProjects, useRecentRuns } from '../api/hooks'
import { useAuth } from '../auth'
import ApprovalsPanel from '../components/Approvals'
import { Banana } from '../components/Monkey'
import ProjectModal from '../components/ProjectModal'
import { Avatar, Bubble, ErrorBox, fmtDate, isOverdue, Loading, ProgressBar, relTime, useUserMap } from '../components/ui'
import type { Task } from '../types'
import { isActiveRun, RUN_LABEL, STATUS_LABEL } from '../types'

function AgentActivity() {
  const { data: runs = [] } = useRecentRuns(true)
  const users = useUserMap()
  return (
    <section>
      <h2 style={{ margin: '28px 0 14px' }}>Agent activity</h2>
      {runs.length === 0 ? (
        <Bubble>No agent runs yet. Assign a task to an agent to get started.</Bubble>
      ) : (
        <ul className="list">
          {runs.slice(0, 6).map((r) => (
            <li key={r.id}>
              <Link to={`/projects/${r.projectId}/board`} className="list-item" style={{ textDecoration: 'none' }}>
                <span className="row" style={{ gap: 10, flexWrap: 'nowrap', minWidth: 0 }}>
                  <Avatar user={users.get(r.agentId)} small />
                  <span style={{ minWidth: 0 }}>
                    <strong style={{ display: 'block' }}>{users.get(r.agentId)?.name ?? 'Agent'}</strong>
                    <span className="muted" style={{ fontSize: '0.85rem' }}>{r.taskTitle} · {relTime(r.createdAt)}</span>
                  </span>
                </span>
                <span className={`badge${r.status === 'Failed' ? ' badge--red' : isActiveRun(r.status) ? ' badge--black' : r.status === 'Succeeded' ? ' badge--yellow' : ''}`}>{RUN_LABEL[r.status]}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export default function Dashboard() {
  const { user } = useAuth()
  const aiEnabled = useAiEnabled()
  const { data: projects, isLoading, error } = useProjects()
  const { data: groups = [] } = useGroups()
  const [creating, setCreating] = useState(false)

  const taskQueries = useQueries({
    queries: (projects ?? []).map((p) => ({ queryKey: keys.tasks(p.id), queryFn: () => api<Task[]>(`/projects/${p.id}/tasks`) })),
  })

  const myTasks = useMemo(() => {
    const names = new Map((projects ?? []).map((p) => [p.id, p.name]))
    return taskQueries
      .flatMap((q) => q.data ?? [])
      .filter((t) => t.assigneeId === user?.id && t.status !== 'Done')
      .map((t) => ({ ...t, projectName: names.get(t.projectId) ?? '' }))
      .sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects, user?.id, taskQueries.map((q) => q.dataUpdatedAt).join(',')])

  if (isLoading) return <Loading />
  if (error) return <ErrorBox error={error} />

  const total = projects?.reduce((n, p) => n + p.taskCount, 0) ?? 0
  const done = projects?.reduce((n, p) => n + p.doneCount, 0) ?? 0
  const overall = total ? Math.round((done / total) * 100) : 0
  const canCreate = user?.role !== 'Member'

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="title-bar">Dashboard</h1>
          <p className="sub">Welcome back, {user?.name.split(' ')[0]}. Here's how the troop is doing.</p>
        </div>
        {canCreate && <button className="btn btn--black" onClick={() => setCreating(true)}>+ New project</button>}
      </div>

      <div className="stats" style={{ marginBottom: 28 }}>
        <div className="stat"><div className="stat-label">Groups</div><div className="big-number">{groups.length}</div></div>
        <div className="stat stat--accent"><div className="stat-label">Projects</div><div className="big-number">{projects?.length ?? 0}</div></div>
        <div className="stat"><div className="stat-label">Total tasks</div><div className="big-number">{total}</div></div>
        <div className="stat"><div className="stat-label"><Banana className="inline-icon" />Bananas done</div><div className="big-number">{done}</div></div>
        <div className="stat stat--accent"><div className="stat-label">Overall progress</div><div className="big-number">{overall}%</div></div>
      </div>

      {aiEnabled && canCreate && <div style={{ marginBottom: 28 }}><ApprovalsPanel hideWhenEmpty /></div>}

      <div className="grid grid--2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(420px, 100%), 1fr))', alignItems: 'start' }}>
        <section>
          <h2 style={{ marginBottom: 14 }}>Projects by group</h2>
          {groups.length === 0 && <Bubble>{canCreate ? 'No groups yet. Gather your troop: create a group, then add projects to it.' : "You aren't in any groups yet. Ask a manager to add you."}</Bubble>}
          {groups.map((g) => {
            const groupProjects = projects?.filter((p) => p.groupId === g.id) ?? []
            return (
              <div key={g.id} style={{ marginBottom: 26 }}>
                <div className="row row--between group-head" style={{ borderColor: g.color === '#FFFFFF' ? '#0A0A0A' : g.color }}>
                  <Link to="/groups" className="group-name">{g.name}</Link>
                  <span className="muted">{g.memberIds.length} member{g.memberIds.length === 1 ? '' : 's'} · {g.projectCount} project{g.projectCount === 1 ? '' : 's'}</span>
                </div>
                {groupProjects.length === 0 && <p className="muted" style={{ marginTop: 8 }}>No projects in this group yet.</p>}
                <div className="grid grid--cards" style={{ marginTop: 14 }}>
              {groupProjects.map((p) => (
                <Link key={p.id} to={`/projects/${p.id}`} className="card card--link stack">
                  <div className="row row--between">
                    <h3>{p.name}</h3>
                    <span className={`badge ${p.status === 'Active' ? 'badge--yellow' : p.status === 'Completed' ? 'badge--black' : ''}`}>{p.status}</span>
                  </div>
                  <p className="muted" style={{ fontSize: '0.9rem' }}>{p.description}</p>
                  <div>
                    <div className="row row--between" style={{ marginBottom: 6 }}>
                      <span className="progress-label">{p.percent}%</span>
                      <span className="muted">{p.doneCount}/{p.taskCount} tasks</span>
                    </div>
                    <ProgressBar percent={p.percent} label={`${p.name} progress`} />
                  </div>
                  <span className="muted">Due {fmtDate(p.dueDate)}</span>
                </Link>
              ))}
                </div>
              </div>
            )
          })}
        </section>

        <section>
          <h2 style={{ marginBottom: 14 }}>My tasks</h2>
          {myTasks.length === 0 ? (
            <Bubble>No tasks on your branch. Time for a banana break?</Bubble>
          ) : (
            <ul className="list">
              {myTasks.map((t) => (
                <li key={t.id}>
                  <Link to={`/projects/${t.projectId}/board`} className="list-item" style={{ textDecoration: 'none' }}>
                    <span style={{ minWidth: 0 }}>
                      <strong style={{ display: 'block' }}>{t.title}</strong>
                      <span className="muted" style={{ fontSize: '0.85rem' }}>{t.projectName} · {STATUS_LABEL[t.status]}</span>
                    </span>
                    <span className={isOverdue(t.dueDate, t.status) ? 'badge badge--red' : 'badge'}>{t.dueDate ? fmtDate(t.dueDate) : 'No date'}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {aiEnabled && <AgentActivity />}
        </section>
      </div>

      {creating && <ProjectModal onClose={() => setCreating(false)} />}
    </>
  )
}
