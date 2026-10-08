import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useDeleteProject, useGroups, useSaveProject } from '../api/hooks'
import { PROJECT_STATUSES, type Project, type ProjectStatus } from '../types'
import { ErrorBox, Modal } from './ui'

/**
 * Create or edit a project. A project lives in exactly one group (chosen on creation, fixed afterwards);
 * its members are the group's members, so there is no member picker here.
 */
export default function ProjectModal({ project, groupId, onClose, onDeleted }: {
  project?: Project
  /** Pre-selected group when creating. */
  groupId?: number
  onClose: () => void
  onDeleted?: () => void
}) {
  const navigate = useNavigate()
  const { data: groups = [] } = useGroups()
  const save = useSaveProject(project?.id)
  const del = useDeleteProject(project?.id ?? 0)

  const manageable = groups.filter((g) => g.canManage)
  const [name, setName] = useState(project?.name ?? '')
  const [description, setDescription] = useState(project?.description ?? '')
  const [status, setStatus] = useState<ProjectStatus>(project?.status ?? 'Planning')
  const [startDate, setStartDate] = useState(project?.startDate ?? '')
  const [dueDate, setDueDate] = useState(project?.dueDate ?? '')
  const [chosenGroup, setChosenGroup] = useState<number | null>(project?.groupId ?? groupId ?? null)
  const selectedGroup = chosenGroup ?? manageable[0]?.id ?? null

  function submit(e: FormEvent) {
    e.preventDefault()
    save.mutate(
      { name, description, status, startDate: startDate || null, dueDate: dueDate || null, groupId: selectedGroup },
      { onSuccess: (p) => { if (!project) navigate(`/projects/${p.id}`); onClose() } },
    )
  }

  function remove() {
    if (!confirm(`Delete "${project?.name}" and all its tasks and goals?`)) return
    del.mutate(undefined, { onSuccess: () => { onDeleted?.(); onClose() } })
  }

  return (
    <Modal title={project ? 'Edit project' : 'New project'} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <div className="form-grid">
          <div className="field full">
            <label htmlFor="pg">Group</label>
            {project ? (
              <div><span className="badge badge--black">{project.groupName}</span> <span className="muted">A project stays in the group it was created in.</span></div>
            ) : manageable.length === 0 ? (
              <span className="muted">You don't manage any groups yet. Create a group first.</span>
            ) : (
              <select id="pg" className="select" value={selectedGroup ?? ''} onChange={(e) => setChosenGroup(Number(e.target.value))} required>
                {manageable.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            )}
          </div>
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
        </div>
        {save.error && <ErrorBox error={save.error} />}
        {del.error && <ErrorBox error={del.error} />}
        <div className="modal-foot">
          {project?.canEdit && <button type="button" className="btn btn--danger" onClick={remove}>Delete</button>}
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn--yellow" disabled={save.isPending || (!project && selectedGroup === null)}>{save.isPending ? 'Saving...' : 'Save'}</button>
        </div>
      </form>
    </Modal>
  )
}
