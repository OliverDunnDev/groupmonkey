import { useState, type FormEvent } from 'react'
import { useDeleteTask, useGoals, useGroups, useSaveTask } from '../api/hooks'
import {
  PRIORITIES, STATUS_LABEL, WORK_STATUSES,
  type Priority, type Project, type Task, type WorkStatus,
} from '../types'
import TaskActivity from './TaskActivity'
import { ErrorBox, Modal, useUserMap } from './ui'

export default function TaskModal({ project, task, defaultStatus, onClose }: {
  project: Project
  task?: Task
  defaultStatus?: WorkStatus
  onClose: () => void
}) {
  const users = useUserMap()
  const { data: groups = [] } = useGroups(project.id)
  const { data: goals = [] } = useGoals(project.id)
  const save = useSaveTask(project.id, task?.id)
  const del = useDeleteTask(project.id)

  const [title, setTitle] = useState(task?.title ?? '')
  const [description, setDescription] = useState(task?.description ?? '')
  const [status, setStatus] = useState<WorkStatus>(task?.status ?? defaultStatus ?? 'Todo')
  const [priority, setPriority] = useState<Priority>(task?.priority ?? 'Medium')
  const [assigneeId, setAssigneeId] = useState<number | null>(task?.assigneeId ?? null)
  const [groupId, setGroupId] = useState<number | null>(task?.groupId ?? null)
  const [goalId, setGoalId] = useState<number | null>(task?.goalId ?? null)
  const [dueDate, setDueDate] = useState(task?.dueDate ?? '')

  const numOrNull = (v: string) => (v === '' ? null : Number(v))

  function submit(e: FormEvent) {
    e.preventDefault()
    save.mutate(
      { title, description, status, priority, assigneeId, groupId, goalId, dueDate: dueDate || null },
      { onSuccess: onClose },
    )
  }

  function remove() {
    if (task && confirm(`Delete task "${task.title}"?`)) del.mutate(task.id, { onSuccess: onClose })
  }

  return (
    <Modal title={task ? 'Edit task' : 'New task'} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <div className="form-grid">
          <div className="field full">
            <label htmlFor="tt">Title</label>
            <input id="tt" className="input" value={title} onChange={(e) => setTitle(e.target.value)} required autoFocus />
          </div>
          <div className="field full">
            <label htmlFor="td">Description</label>
            <textarea id="td" className="textarea" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="ts">Status</label>
            <select id="ts" className="select" value={status} onChange={(e) => setStatus(e.target.value as WorkStatus)}>
              {WORK_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="tp">Priority</label>
            <select id="tp" className="select" value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
              {PRIORITIES.map((p) => <option key={p}>{p}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="ta">Assignee</label>
            <select id="ta" className="select" value={assigneeId ?? ''} onChange={(e) => setAssigneeId(numOrNull(e.target.value))}>
              <option value="">Unassigned</option>
              {project.memberIds.map((id) => <option key={id} value={id}>{users.get(id)?.name ?? `User ${id}`}{users.get(id)?.kind === 'Agent' ? ' (AI agent)' : ''}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="tdd">Due date</label>
            <input id="tdd" className="input" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="tg">Group</label>
            <select id="tg" className="select" value={groupId ?? ''} onChange={(e) => setGroupId(numOrNull(e.target.value))}>
              <option value="">No group</option>
              {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="tgo">Goal</label>
            <select id="tgo" className="select" value={goalId ?? ''} onChange={(e) => setGoalId(numOrNull(e.target.value))}>
              <option value="">No goal</option>
              {goals.map((g) => <option key={g.id} value={g.id}>{g.title}</option>)}
            </select>
          </div>
        </div>
        {save.error && <ErrorBox error={save.error} />}
        {del.error && <ErrorBox error={del.error} />}
        <div className="modal-foot">
          {task && <button type="button" className="btn btn--danger" onClick={remove}>Delete</button>}
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn--yellow" disabled={save.isPending}>{save.isPending ? 'Saving...' : 'Save'}</button>
        </div>
      </form>
      {task && <TaskActivity project={project} task={task} />}
    </Modal>
  )
}
