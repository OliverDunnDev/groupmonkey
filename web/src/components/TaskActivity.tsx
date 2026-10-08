import { useState, type FormEvent } from 'react'
import {
  useAddComment, useAiEnabled, useCancelRun, useComments, useDecide, useRunNow, useTaskRuns,
} from '../api/hooks'
import { isActiveRun, MODEL_LABEL, RUN_LABEL, type Project, type Run, type Task } from '../types'
import { AgentBadge, Avatar, Bubble, ErrorBox, relTime, useUserMap } from './ui'

const STEP_LABEL = { Thought: 'THINK', ToolCall: 'CALL', ToolResult: 'RESULT', Message: 'SAY' } as const

const COLLAPSE_AT = 140

/** One line of a run timeline. Long tool output collapses so the timeline stays readable. */
function StepRow({ type, content }: { type: keyof typeof STEP_LABEL; content: string }) {
  const [open, setOpen] = useState(false)
  const long = content.length > COLLAPSE_AT
  return (
    <li className={`step step--${type}`}>
      <span className="step-tag">{STEP_LABEL[type]}</span>
      <span className="step-text">
        {long && !open ? content.slice(0, COLLAPSE_AT) + '...' : content}
        {long && (
          <button type="button" className="link-btn" onClick={() => setOpen(!open)}>{open ? ' less' : ' more'}</button>
        )}
      </span>
    </li>
  )
}

function statusBadgeClass(status: Run['status']) {
  if (status === 'Failed') return 'badge badge--red'
  if (status === 'Succeeded') return 'badge badge--yellow'
  if (status === 'Cancelled') return 'badge'
  return 'badge badge--black'
}

function RunCard({ run, open, project }: { run: Run; open: boolean; project: Project }) {
  const users = useUserMap()
  const cancel = useCancelRun()
  const decide = useDecide()
  const active = isActiveRun(run.status)
  const agent = users.get(run.agentId)
  const tokens = run.inputTokens + run.outputTokens

  return (
    <details className="run" open={open || active}>
      <summary>
        <span className="row" style={{ gap: 8, display: 'inline-flex' }}>
          <Avatar user={agent} small />
          <strong>{agent?.name ?? 'Agent'}</strong>
          <span className={statusBadgeClass(run.status)}>{active && <span className="dot" />}{RUN_LABEL[run.status]}</span>
          <span className="muted" style={{ fontSize: '0.8rem' }}>{relTime(run.createdAt)}</span>
        </span>
      </summary>

      <div className="run-body stack" style={{ gap: 10 }}>
        <div className="row" style={{ gap: 6 }}>
          <span className={`badge ${run.provider === 'Mock' ? 'badge--yellow' : ''}`}>{run.provider === 'Mock' ? 'Demo run' : MODEL_LABEL[run.model ?? ''] ?? run.model}</span>
          {run.triggeredBy && <span className="badge">{run.triggeredBy}</span>}
          {tokens > 0 && <span className="badge">{tokens.toLocaleString()} tokens</span>}
          {active && (
            <button className="btn btn--sm btn--danger" disabled={cancel.isPending} onClick={() => cancel.mutate(run.id)}>Cancel run</button>
          )}
        </div>

        {run.error && <div className="alert" role="alert">{run.error}</div>}

        <ol className="steps">
          {run.steps.map((s, i) => <StepRow key={i} type={s.type} content={s.content} />)}
          {active && <li className="step"><span className="step-tag">...</span><span className="step-text muted">Working</span></li>}
        </ol>

        {run.actions.map((a) => (
          <div key={a.id} className={`proposal proposal--${a.state}`}>
            <span>
              <strong>{a.state === 'Pending' ? 'Waiting for approval' : a.state}</strong>
              <span style={{ display: 'block', fontWeight: 600 }}>{a.summary}</span>
            </span>
            {a.state === 'Pending' && project.canManage && (
              <span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                <button className="btn btn--sm btn--black" disabled={decide.isPending} onClick={() => decide.mutate({ id: a.id, approve: true })}>Approve</button>
                <button className="btn btn--sm" disabled={decide.isPending} onClick={() => decide.mutate({ id: a.id, approve: false })}>Reject</button>
              </span>
            )}
          </div>
        ))}
        {(decide.error || cancel.error) && <ErrorBox error={decide.error ?? cancel.error} />}
      </div>
    </details>
  )
}

/** Comments and agent runs for a task. Renders nothing unless the AI feature is on. */
export default function TaskActivity({ project, task }: { project: Project; task: Task }) {
  const enabled = useAiEnabled()
  const users = useUserMap()
  const runsQuery = useTaskRuns(task.id, enabled)
  const runs = runsQuery.data ?? []
  const live = runs.some((r) => isActiveRun(r.status))
  const commentsQuery = useComments(task.id, enabled, live)
  const addComment = useAddComment(task.id)
  const runNow = useRunNow(task.id)
  const [text, setText] = useState('')

  if (!enabled) return null

  const assignee = task.assigneeId ? users.get(task.assigneeId) : undefined
  const assignedToAgent = assignee?.kind === 'Agent'
  const comments = commentsQuery.data ?? []

  function post(e: FormEvent) {
    e.preventDefault()
    if (!text.trim()) return
    addComment.mutate(text.trim(), { onSuccess: () => setText('') })
  }

  return (
    <section className="activity stack" aria-label="Activity">
      <div className="row row--between">
        <h3>Activity</h3>
        {assignedToAgent && (
          <button className="btn btn--sm btn--yellow" disabled={live || runNow.isPending} onClick={() => runNow.mutate()}>
            {live ? 'Working...' : `Run ${assignee?.name} now`}
          </button>
        )}
      </div>
      {runNow.error && <ErrorBox error={runNow.error} />}

      {assignedToAgent && runs.length === 0 && (
        <p className="muted">{assignee?.name} hasn't worked on this yet. It starts automatically when a task is assigned to it.</p>
      )}

      {runs.length > 0 && (
        <div className="stack" style={{ gap: 8 }}>
          {runs.map((r, i) => <RunCard key={r.id} run={r} open={i === 0} project={project} />)}
        </div>
      )}

      <div className="stack" style={{ gap: 10 }}>
        {comments.length === 0 && <Bubble>No comments yet.</Bubble>}
        {comments.map((c) => {
          const author = users.get(c.authorId)
          return (
            <article key={c.id} className={`comment${author?.kind === 'Agent' ? ' comment--agent' : ''}`}>
              <header className="row" style={{ gap: 8 }}>
                <Avatar user={author} small />
                <strong>{author?.name ?? 'Former agent'}</strong>
                {author?.kind === 'Agent' && <AgentBadge />}
                <span className="muted" style={{ fontSize: '0.8rem' }}>{relTime(c.createdAt)}</span>
              </header>
              <p className="comment-body">{c.body}</p>
            </article>
          )
        })}
      </div>

      <form className="stack" style={{ gap: 8 }} onSubmit={post}>
        <label className="sr-only" htmlFor="new-comment">Add a comment</label>
        <textarea id="new-comment" className="textarea" style={{ minHeight: 64 }} value={text} onChange={(e) => setText(e.target.value)} placeholder="Add a comment or answer an agent's question..." />
        {addComment.error && <ErrorBox error={addComment.error} />}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn btn--sm btn--black" disabled={addComment.isPending || !text.trim()}>Post comment</button>
        </div>
      </form>
    </section>
  )
}
