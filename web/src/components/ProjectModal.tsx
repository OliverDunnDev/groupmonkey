import { useState, type FormEvent } from 'react'
import { useDeleteProject, useSaveProject, useUsers } from '../api/hooks'
import { PROJECT_STATUSES, type Project, type ProjectStatus } from '../types'
import { ErrorBox, Modal } from './ui'

export default function ProjectModal({ project, onClose, onDeleted, onSaved }: {
  project?: Project
  onClose: () => void
  onDeleted?: () => void
  onSaved?: (p: Project) => void
}) {
  const { data: users = [] } = useUsers()
  const save = useSaveProject(project?.id)
  const del = useDeleteProject(project?.id ?? 0)

  const [name, setName] = useState(project?.name ?? '')
  const [description, setDescription] = useState(project?.description ?? '')
  const [status, setStatus] = useState<ProjectStatus>(project?.status ?? 'Planning')
  const [startDate, setStartDate] = useState(project?.startDate ?? '')
  const [dueDate, setDueDate] = useState(project?.dueDate ?? '')
  const [memberIds, setMemberIds] = useState<number[]>(project?.memberIds ?? [])

  const toggle = (id: number) =>
    setMemberIds((m) => (m.includes(id) ? m.filter((x) => x !== id) : [...m, id]))

  function submit(e: FormEvent) {
    e.preventDefault()
    save.mutate(
      { name, description, status, startDate: startDate || null, dueDate: dueDate || null, memberIds },
      { onSuccess: (p) => { onSaved?.(p); onClose() } },
    )
  }

  function remove() {
    if (!confirm(`Delete "${project?.name}" and all its tasks, groups and goals?`)) return
    del.mutate(undefined, { onSuccess: () => { onDeleted?.(); onClose() } })
  }

  return (
    <Modal title={project ? 'Edit project' : 'New project'} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <div className="form-grid">
          <div className="field full">
            <label htmlFor="pn">Name</label>
            <input id="pn" className="input" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
          </div>
          <div className="field full">
            <label htmlFor="pd">Description</label>
            <textarea id="pd" className="textarea" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="ps">Status</label>
            <select id="ps" className="select" value={status} onChange={(e) => setStatus(e.target.value as ProjectStatus)}>
              {PROJECT_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div />
          <div className="field">
            <label htmlFor="psd">Start date</label>
            <input id="psd" className="input" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="pdd">Due date</label>
            <input id="pdd" className="input" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>
          <div className="field full">
            <label>Members</label>
            <div className="row">
              {users.map((u) => (
                <label key={u.id} className="chip" style={{ cursor: 'pointer', textTransform: 'none', letterSpacing: 0, fontSize: '0.85rem' }}>
                  <input type="checkbox" checked={memberIds.includes(u.id) || u.id === project?.ownerId} disabled={u.id === project?.ownerId} onChange={() => toggle(u.id)} />
                  {u.name}{u.kind === 'Agent' ? ' (AI agent)' : ''}
                </label>
              ))}
            </div>
          </div>
        </div>
        {save.error && <ErrorBox error={save.error} />}
        {del.error && <ErrorBox error={del.error} />}
        <div className="modal-foot">
          {project?.canEdit && <button type="button" className="btn btn--danger" onClick={remove}>Delete</button>}
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn--yellow" disabled={save.isPending}>{save.isPending ? 'Saving...' : 'Save'}</button>
        </div>
      </form>
    </Modal>
  )
}
