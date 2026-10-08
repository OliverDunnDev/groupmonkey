import { Link } from 'react-router-dom'
import { useGoals, useSummary, useTasks } from '../api/hooks'
import { Avatar, Bubble, ErrorBox, fmtDate, isOverdue, Loading, ProgressBar, useUserMap } from '../components/ui'
import { STATUS_LABEL, WORK_STATUSES } from '../types'
import { useProjectContext } from './ProjectPage'

export default function Overview() {
  const { project } = useProjectContext()
  const users = useUserMap()
  const summary = useSummary(project.id)
  const tasks = useTasks(project.id)
  const goals = useGoals(project.id)

  if (summary.isLoading || tasks.isLoading) return <Loading />
  if (summary.error || !summary.data) return <ErrorBox error={summary.error} />
  const s = summary.data

  const upcoming = (tasks.data ?? [])
    .filter((t) => t.status !== 'Done' && t.dueDate)
    .sort((a, b) => a.dueDate!.localeCompare(b.dueDate!))
    .slice(0, 6)

  return (
    <div className="stack" style={{ gap: 28 }}>
      <div className="card card--accent stack">
        <div className="row row--between">
          <h2>Overall progress</h2>
          <span className="big-number">{s.percent}%</span>
        </div>
        <ProgressBar percent={s.percent} label="Overall project progress" />
        <p style={{ fontWeight: 800 }}>
          {s.done} of {s.total} tasks complete
          {s.overdue > 0 && <> · <span className="badge badge--red">{s.overdue} overdue</span></>}
        </p>
      </div>

      <div className="stats">
        {WORK_STATUSES.map((st) => (
          <div key={st} className={`stat${st === 'Done' ? ' stat--accent' : ''}`}>
            <div className="stat-label">{STATUS_LABEL[st]}</div>
            <div className="big-number">{s.byStatus[st] ?? 0}</div>
          </div>
        ))}
      </div>

      <div className="grid grid--2" style={{ alignItems: 'start' }}>
        <section className="card stack">
          <h3>Team workload</h3>
          <p className="muted" style={{ fontSize: '0.85rem' }}>Members of {project.groupName}</p>
          {s.members.map((m) => (
            <div key={m.userId} className="stack" style={{ gap: 6 }}>
              <div className="row row--between">
                <span className="row" style={{ gap: 8 }}><Avatar user={users.get(m.userId)} small /><strong>{users.get(m.userId)?.name ?? `User ${m.userId}`}</strong></span>
                <span className="muted">{m.done}/{m.total} done</span>
              </div>
              <ProgressBar percent={m.percent} small label={`${users.get(m.userId)?.name} progress`} />
            </div>
          ))}
        </section>

        <section className="card stack">
          <div className="row row--between">
            <h3>Goals</h3>
            <Link className="btn btn--sm" to="goals">View all</Link>
          </div>
          {(goals.data ?? []).length === 0 && <Bubble>No goals set.</Bubble>}
          {goals.data?.map((g) => (
            <div key={g.id} className="stack" style={{ gap: 6 }}>
              <div className="row row--between">
                <strong>{g.title}</strong>
                <span className="muted">{g.percent}%</span>
              </div>
              <ProgressBar percent={g.percent} small label={`${g.title} progress`} />
            </div>
          ))}
        </section>

        <section className="card stack">
          <div className="row row--between">
            <h3>Upcoming deadlines</h3>
            <Link className="btn btn--sm" to="board">Board</Link>
          </div>
          {upcoming.length === 0 && <Bubble>No deadlines looming. Smooth swinging.</Bubble>}
          <ul className="list">
            {upcoming.map((t) => (
              <li key={t.id} className="list-item">
                <span style={{ minWidth: 0 }}>
                  <strong style={{ display: 'block' }}>{t.title}</strong>
                  <span className="muted" style={{ fontSize: '0.85rem' }}>{t.assigneeId ? users.get(t.assigneeId)?.name : 'Unassigned'}</span>
                </span>
                <span className={isOverdue(t.dueDate, t.status) ? 'badge badge--red' : 'badge'}>{fmtDate(t.dueDate)}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  )
}
