import { useState, type FormEvent } from 'react'
import { useDeleteGroup, useGroupMember, useGroups, useSaveGroup, useUsers } from '../api/hooks'
import { Avatar, Bubble, ErrorBox, Loading, Modal, ProgressBar, useUserMap } from '../components/ui'
import type { Group } from '../types'
import { useProjectContext } from './ProjectPage'

const COLORS = ['#FFD400', '#0A0A0A', '#FFFFFF', '#FFB800', '#E5251B']

function GroupModal({ projectId, group, onClose }: { projectId: number; group?: Group; onClose: () => void }) {
  const save = useSaveGroup(projectId, group?.id)
  const [name, setName] = useState(group?.name ?? '')
  const [color, setColor] = useState(group?.color ?? COLORS[0]!)

  function submit(e: FormEvent) {
    e.preventDefault()
    save.mutate({ name, color }, { onSuccess: onClose })
  }

  return (
    <Modal title={group ? 'Edit group' : 'New group'} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <div className="field">
          <label htmlFor="gn">Name</label>
          <input id="gn" className="input" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
        </div>
        <div className="field">
          <label>Colour</label>
          <div className="swatches">
            {COLORS.map((c) => (
              <button key={c} type="button" className="swatch" style={{ background: c }} aria-pressed={color === c} aria-label={`Colour ${c}`} onClick={() => setColor(c)} />
            ))}
          </div>
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

export default function Groups() {
  const { project } = useProjectContext()
  const users = useUserMap()
  const { data: allUsers = [] } = useUsers()
  const { data: groups, isLoading, error } = useGroups(project.id)
  const member = useGroupMember(project.id)
  const del = useDeleteGroup(project.id)
  const [modal, setModal] = useState<{ group?: Group } | null>(null)

  if (isLoading) return <Loading />
  if (error) return <ErrorBox error={error} />

  return (
    <>
      <div className="row row--between" style={{ marginBottom: 20 }}>
        <p className="muted">Groups are the teams working on this project. Members added to a group join the project automatically.</p>
        {project.canManage && <button className="btn btn--black" onClick={() => setModal({})}>+ New group</button>}
      </div>
      {(member.error || del.error) && <div style={{ marginBottom: 12 }}><ErrorBox error={member.error ?? del.error} /></div>}

      {groups?.length === 0 && <Bubble>No groups yet. Create one to organise your team.</Bubble>}

      <div className="grid grid--cards">
        {groups?.map((g) => {
          const available = allUsers.filter((u) => !g.memberIds.includes(u.id))
          return (
            <article key={g.id} className="card stack" style={{ borderTopWidth: 14, borderTopColor: g.color === '#FFFFFF' ? '#0A0A0A' : g.color }}>
              <div className="row row--between">
                <h3>{g.name}</h3>
                {project.canManage && (
                  <span className="row" style={{ gap: 6 }}>
                    <button className="btn btn--sm" onClick={() => setModal({ group: g })}>Edit</button>
                    <button
                      className="btn btn--sm btn--danger"
                      onClick={() => confirm(`Delete group "${g.name}"? Its tasks will be kept but ungrouped.`) && del.mutate(g.id)}
                    >
                      Delete
                    </button>
                  </span>
                )}
              </div>

              <div>
                <div className="row row--between" style={{ marginBottom: 6 }}>
                  <span className="progress-label">{g.percent}%</span>
                  <span className="muted">{g.doneCount}/{g.taskCount} tasks</span>
                </div>
                <ProgressBar percent={g.percent} small label={`${g.name} progress`} />
              </div>

              <div className="stack" style={{ gap: 8 }}>
                <strong style={{ textTransform: 'uppercase', fontSize: '0.75rem', letterSpacing: '0.1em' }}>Members ({g.memberIds.length})</strong>
                <div className="row">
                  {g.memberIds.length === 0 && <span className="muted">No members yet</span>}
                  {g.memberIds.map((id) => (
                    <span key={id} className="chip">
                      <Avatar user={users.get(id)} small />
                      {users.get(id)?.name ?? `User ${id}`}
                      {project.canManage && (
                        <button aria-label={`Remove ${users.get(id)?.name}`} onClick={() => member.mutate({ groupId: g.id, userId: id, add: false })}>X</button>
                      )}
                    </span>
                  ))}
                </div>
                {project.canManage && available.length > 0 && (
                  <select
                    className="select"
                    value=""
                    aria-label={`Add member to ${g.name}`}
                    onChange={(e) => e.target.value && member.mutate({ groupId: g.id, userId: Number(e.target.value), add: true })}
                  >
                    <option value="">+ Add member...</option>
                    {available.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                  </select>
                )}
              </div>
            </article>
          )
        })}
      </div>

      {modal && <GroupModal projectId={project.id} group={modal.group} onClose={() => setModal(null)} />}
    </>
  )
}
