import { useState, type FormEvent } from 'react'
import { useDeleteGoal, useGoals, useSaveGoal, useTasks } from '../api/hooks'
import { Bubble, ErrorBox, fmtDate, Loading, Modal, ProgressBar } from '../components/ui'
import { STATUS_LABEL, type Goal } from '../types'
import { useProjectContext } from './ProjectPage'

function GoalModal({ projectId, goal, onClose }: { projectId: number; goal?: Goal; onClose: () => void }) {
  const save = useSaveGoal(projectId, goal?.id)
  const [title, setTitle] = useState(goal?.title ?? '')
  const [description, setDescription] = useState(goal?.description ?? '')
  const [targetDate, setTargetDate] = useState(goal?.targetDate ?? '')

  function submit(e: FormEvent) {
    e.preventDefault()
    save.mutate({ title, description, targetDate: targetDate || null }, { onSuccess: onClose })
  }

  return (
    <Modal title={goal ? 'Edit goal' : 'New goal'} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <div className="field">
          <label htmlFor="gt">Title</label>
          <input id="gt" className="input" value={title} onChange={(e) => setTitle(e.target.value)} required autoFocus />
        </div>
        <div className="field">
          <label htmlFor="gd">Description</label>
          <textarea id="gd" className="textarea" value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="gtd">Target date</label>
          <input id="gtd" className="input" type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} />
        </div>
        {save.error && <ErrorBox error={save.error} />}
        <div className="modal-foot">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn--yellow" disabled={save.isPending}>Save</button>
        </div>
      </form>
    </Modal>
  )
}

export default function Goals() {
  const { project } = useProjectContext()
  const { data: goals, isLoading, error } = useGoals(project.id)
  const { data: tasks = [] } = useTasks(project.id)
  const del = useDeleteGoal(project.id)
  const [modal, setModal] = useState<{ goal?: Goal } | null>(null)

  if (isLoading) return <Loading />
  if (error) return <ErrorBox error={error} />

  return (
    <>
      <div className="row row--between" style={{ marginBottom: 20 }}>
        <p className="muted">Goals track the big outcomes. Link tasks to a goal when you create or edit them and progress updates automatically.</p>
        {project.canManage && <button className="btn btn--black" onClick={() => setModal({})}>+ New goal</button>}
      </div>
      {del.error && <div style={{ marginBottom: 12 }}><ErrorBox error={del.error} /></div>}
      {goals?.length === 0 && <Bubble>No goals yet. What are we aiming for?</Bubble>}

      <div className="grid grid--cards">
        {goals?.map((g) => {
          const linked = tasks.filter((t) => t.goalId === g.id)
          return (
            <article key={g.id} className={`card stack${g.percent === 100 ? ' card--yellow' : ''}`}>
              <div className="row row--between">
                <h3>{g.title}</h3>
                {g.percent === 100 && <span className="badge badge--black">Achieved</span>}
              </div>
              {g.description && <p style={{ fontWeight: 600 }}>{g.description}</p>}
              <div>
                <div className="row row--between" style={{ marginBottom: 6 }}>
                  <span className="progress-label">{g.percent}%</span>
                  <span className="muted">{g.doneCount}/{g.taskCount} tasks</span>
                </div>
                <ProgressBar percent={g.percent} label={`${g.title} progress`} />
              </div>
              <span className="badge" style={{ alignSelf: 'flex-start' }}>Target {fmtDate(g.targetDate)}</span>

              {linked.length === 0 ? (
                <span className="muted">No tasks linked yet.</span>
              ) : (
                <ul className="list" style={{ gap: 6 }}>
                  {linked.map((t) => (
                    <li key={t.id} className="list-item" style={{ padding: '5px 8px' }}>
                      <span style={{ textDecoration: t.status === 'Done' ? 'line-through' : 'none', fontWeight: 700 }}>{t.title}</span>
                      <span className={`badge${t.status === 'Done' ? ' badge--black' : ''}`}>{STATUS_LABEL[t.status]}</span>
                    </li>
                  ))}
                </ul>
              )}

              {project.canManage && (
                <div className="row">
                  <button className="btn btn--sm" onClick={() => setModal({ goal: g })}>Edit</button>
                  <button className="btn btn--sm btn--danger" onClick={() => confirm(`Delete goal "${g.title}"? Linked tasks will be kept.`) && del.mutate(g.id)}>Delete</button>
                </div>
              )}
            </article>
          )
        })}
      </div>

      {modal && <GoalModal projectId={project.id} goal={modal.goal} onClose={() => setModal(null)} />}
    </>
  )
}
