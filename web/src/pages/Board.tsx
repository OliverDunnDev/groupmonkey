import {
  DndContext, DragOverlay, KeyboardSensor, PointerSensor, useDraggable, useDroppable, useSensor, useSensors,
  type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core'
import { useState } from 'react'
import { useAiEnabled, useMoveTask, useRecentRuns, useTasks } from '../api/hooks'
import { Banana } from '../components/Monkey'
import TaskModal from '../components/TaskModal'
import { Avatar, ErrorBox, fmtDate, isOverdue, Loading, useUserMap } from '../components/ui'
import { isActiveRun, STATUS_LABEL, WORK_STATUSES, type Task, type WorkStatus } from '../types'
import { useProjectContext } from './ProjectPage'

function TaskCard({ task, overlay, working, onOpen }: {
  task: Task
  overlay?: boolean
  working?: boolean
  onOpen?: () => void
}) {
  const users = useUserMap()
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: task.id, disabled: overlay })
  const overdue = isOverdue(task.dueDate, task.status)

  return (
    <div
      ref={overlay ? undefined : setNodeRef}
      className={`task${isDragging ? ' is-dragging' : ''}${overlay ? ' task-overlay' : ''}${overdue ? ' is-overdue' : ''}`}
      onClick={onOpen}
      {...(overlay ? {} : listeners)}
      {...(overlay ? {} : attributes)}
      aria-label={`${task.title}. Press enter to edit.`}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onOpen?.()
        else listeners?.onKeyDown?.(e)
      }}
    >
      {working && <span className="working-bar" role="status">Agent working</span>}
      <span className="task-title">{task.title}</span>
      <div className="task-meta">
        <span className={`badge priority-${task.priority}`}>{task.priority}</span>
      </div>
      <div className="task-foot">
        <span className={overdue ? 'overdue-text' : 'muted'} style={{ fontSize: '0.85rem' }}>
          {task.dueDate ? `${overdue ? 'OVERDUE ' : ''}${fmtDate(task.dueDate)}` : 'No date'}
        </span>
        <Avatar user={task.assigneeId ? users.get(task.assigneeId) : undefined} small />
      </div>
    </div>
  )
}

function Column({ status, tasks, working, onAdd, onOpen }: {
  status: WorkStatus
  tasks: Task[]
  working: Set<number>
  onAdd: () => void
  onOpen: (t: Task) => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status })
  return (
    <section ref={setNodeRef} className={`column${isOver ? ' is-over' : ''}`} aria-label={STATUS_LABEL[status]}>
      <div className="column-head">
        <h3>{status === 'Done' && <Banana className="inline-icon" onDark />}{STATUS_LABEL[status]}</h3>
        <span className="count">{tasks.length}</span>
      </div>
      <div className="column-body">
        {tasks.map((t) => (
          <TaskCard key={t.id} task={t} working={working.has(t.id)} onOpen={() => onOpen(t)} />
        ))}
        <button className="btn btn--sm" onClick={onAdd}>+ Add task</button>
      </div>
    </section>
  )
}

export default function Board() {
  const { project } = useProjectContext()
  const { data: tasks, isLoading, error } = useTasks(project.id)
  const move = useMoveTask(project.id)
  const aiEnabled = useAiEnabled()
  const { data: recent } = useRecentRuns(aiEnabled)
  // Tasks an agent is working on right now.
  const working = new Set((recent ?? []).filter((r) => isActiveRun(r.status)).map((r) => r.taskId))
  const [modal, setModal] = useState<{ task?: Task; status?: WorkStatus } | null>(null)
  const [dragging, setDragging] = useState<Task | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  )

  if (isLoading) return <Loading />
  if (error) return <ErrorBox error={error} />

  function onDragStart(e: DragStartEvent) {
    setDragging(tasks?.find((t) => t.id === e.active.id) ?? null)
  }

  function onDragEnd(e: DragEndEvent) {
    setDragging(null)
    const task = tasks?.find((t) => t.id === e.active.id)
    const target = e.over?.id as WorkStatus | undefined
    if (task && target && WORK_STATUSES.includes(target) && target !== task.status) {
      move.mutate({ id: task.id, status: target })
    }
  }

  return (
    <>
      <div className="row row--between" style={{ marginBottom: 16 }}>
        <p className="muted">Drag cards between columns to update their status, or click a card to edit it.</p>
        <button className="btn btn--black" onClick={() => setModal({})}>+ New task</button>
      </div>
      {move.error && <div style={{ marginBottom: 12 }}><ErrorBox error={move.error} /></div>}

      <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setDragging(null)}>
        <div className="board">
          {WORK_STATUSES.map((st) => (
            <Column
              key={st}
              status={st}
              tasks={(tasks ?? []).filter((t) => t.status === st)}
              working={working}
              onAdd={() => setModal({ status: st })}
              onOpen={(task) => setModal({ task })}
            />
          ))}
        </div>
        <DragOverlay>{dragging && <TaskCard task={dragging} overlay />}</DragOverlay>
      </DndContext>

      {modal && <TaskModal project={project} task={modal.task} defaultStatus={modal.status} onClose={() => setModal(null)} />}
    </>
  )
}
