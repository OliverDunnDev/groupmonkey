import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useDeleteGroup, useGroupMember, useGroups, useProjects, useSaveGroup, useUsers } from '../api/hooks'
import { useAuth } from '../auth'
import ProjectModal from '../components/ProjectModal'
import { Avatar, Bubble, ErrorBox, Loading, Modal, ProgressBar, useUserMap } from '../components/ui'
import type { Group } from '../types'

const COLORS = ['#FFD400', '#0A0A0A', '#FFFFFF', '#FFB800', '#E5251B']

function GroupModal({ group, onClose }: { group?: Group; onClose: () => void }) {
  const { data: users = [] } = useUsers()
  const save = useSaveGroup(group?.id)
  const [name, setName] = useState(group?.name ?? '')
  const [description, setDescription] = useState(group?.description ?? '')
  const [color, setColor] = useState(group?.color ?? COLORS[0]!)
  const [memberIds, setMemberIds] = useState<number[]>(group?.memberIds ?? [])
  const toggle = (id: number) => setMemberIds((m) => (m.includes(id) ? m.filter((x) => x !== id) : [...m, id]))

  function submit(e: FormEvent) {
    e.preventDefault()
    save.mutate({ name, description, color, memberIds }, { onSuccess: onClose })
  }

  return (
    <Modal title={group ? 'Edit group' : 'New group'} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <div className="field">
          <label htmlFor="gn">Name</label>
          <input id="gn" className="input" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={60} autoFocus />
        </div>
        <div className="field">
          <label htmlFor="gd">What does this group do?</label>
          <textarea id="gd" className="textarea" value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div className="field">
          <label>Colour</label>
          <div className="swatches">
            {COLORS.map((c) => (
              <button key={c} type="button" className="swatch" style={{ background: c }} aria-pressed={color === c} aria-label={`Colour ${c}`} onClick={() => setColor(c)} />
            ))}
          </div>
        </div>
        <div className="field">
          <label>Members</label>
          <div className="row">
            {users.map((u) => {
              const isOwner = group ? u.id === group.ownerId : false
              return (
                <label key={u.id} className="chip" style={{ cursor: 'pointer', textTransform: 'none', letterSpacing: 0 }}>
                  <input type="checkbox" checked={memberIds.includes(u.id) || isOwner} disabled={isOwner} onChange={() => toggle(u.id)} />
                  {u.name}{u.kind === 'Agent' ? ' (AI agent)' : ''}
                </label>
              )
            })}
          </div>
          <span className="muted" style={{ fontSize: '0.8rem' }}>
            Projects in this group are visible to its members, and tasks can only be assigned to them. You are added automatically.
          </span>
        </div>
        {save.error && <ErrorBox error={save.error} />}
        <div className="modal-foot">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn--yellow" disabled={save.isPending}>{save.isPending ? 'Saving...' : 'Save'}</button>
        </div>
      </form>
    </Modal>
  )
}

export default function Groups() {
  const { user } = useAuth()
  const users = useUserMap()
  const { data: allUsers = [] } = useUsers()
  const { data: groups, isLoading, error } = useGroups()
  const { data: projects = [] } = useProjects()
  const member = useGroupMember()
  const del = useDeleteGroup()
  const [groupModal, setGroupModal] = useState<{ group?: Group } | null>(null)
  const [projectIn, setProjectIn] = useState<number | null>(null)

  if (isLoading) return <Loading />
  if (error) return <ErrorBox error={error} />

  const canCreate = user?.role !== 'Member'

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="title-bar">Groups</h1>
          <p className="sub">
            A group is a team. Its members see its projects and can be given its tasks. Managers choose who is in each group, like picking a troop.
          </p>
        </div>
        {canCreate && <button className="btn btn--black" onClick={() => setGroupModal({})}>+ New group</button>}
      </div>

      {(member.error || del.error) && <div style={{ marginBottom: 12 }}><ErrorBox error={member.error ?? del.error} /></div>}
      {groups?.length === 0 && (
        <Bubble>{canCreate ? 'No groups yet. Gather your troop: create one, add its members, then give it projects.' : "You aren't in any groups yet. Ask a manager to add you."}</Bubble>
      )}

      <div className="grid grid--cards">
        {groups?.map((g) => {
          const available = allUsers.filter((u) => !g.memberIds.includes(u.id))
          const groupProjects = projects.filter((p) => p.groupId === g.id)
          return (
            <article key={g.id} className="card stack" style={{ borderTopWidth: 14, borderTopColor: g.color === '#FFFFFF' ? '#0A0A0A' : g.color }}>
              <div className="row row--between">
                <h3>{g.name}</h3>
                {g.canManage && (
                  <span className="row" style={{ gap: 6 }}>
                    <button className="btn btn--sm" onClick={() => setGroupModal({ group: g })}>Edit</button>
                    {g.canEdit && (
                      <button
                        className="btn btn--sm btn--danger"
                        onClick={() => confirm(`Delete "${g.name}" and its ${g.projectCount} project(s), with all their tasks and goals? This can't be undone.`) && del.mutate(g.id)}
                      >
                        Delete
                      </button>
                    )}
                  </span>
                )}
              </div>
              {g.description && <p className="muted" style={{ fontSize: '0.9rem' }}>{g.description}</p>}

              <div>
                <div className="row row--between" style={{ marginBottom: 6 }}>
                  <span className="progress-label">{g.percent}%</span>
                  <span className="muted">{g.projectCount} project{g.projectCount === 1 ? '' : 's'} · {g.doneCount}/{g.taskCount} tasks</span>
                </div>
                <ProgressBar percent={g.percent} small label={`${g.name} progress`} />
              </div>

              <div className="stack" style={{ gap: 8 }}>
                <div className="row row--between">
                  <strong className="mini-label">Projects</strong>
                  {g.canManage && <button className="btn btn--sm btn--yellow" onClick={() => setProjectIn(g.id)}>+ New project</button>}
                </div>
                {groupProjects.length === 0 && <span className="muted">No projects yet</span>}
                <ul className="list" style={{ gap: 6 }}>
                  {groupProjects.map((p) => (
                    <li key={p.id}>
                      <Link to={`/projects/${p.id}`} className="list-item" style={{ textDecoration: 'none', padding: '6px 8px' }}>
                        <strong style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</strong>
                        <span className="badge">{p.percent}%</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="stack" style={{ gap: 8 }}>
                <strong className="mini-label">Members ({g.memberIds.length})</strong>
                <div className="row">
                  {g.memberIds.map((id) => (
                    <span key={id} className="chip">
                      <Avatar user={users.get(id)} small />
                      {users.get(id)?.name ?? `User ${id}`}
                      {id === g.ownerId && <span className="badge badge--black" style={{ marginLeft: 2 }}>Owner</span>}
                      {g.canManage && id !== g.ownerId && (
                        <button aria-label={`Remove ${users.get(id)?.name}`} onClick={() => member.mutate({ groupId: g.id, userId: id, add: false })}>X</button>
                      )}
                    </span>
                  ))}
                </div>
                {g.canManage && available.length > 0 && (
                  <select
                    className="select"
                    value=""
                    aria-label={`Add member to ${g.name}`}
                    onChange={(e) => e.target.value && member.mutate({ groupId: g.id, userId: Number(e.target.value), add: true })}
                  >
                    <option value="">+ Add member...</option>
                    {available.map((u) => <option key={u.id} value={u.id}>{u.name}{u.kind === 'Agent' ? ' (AI agent)' : ''}</option>)}
                  </select>
                )}
              </div>
            </article>
          )
        })}
      </div>

      {groupModal && <GroupModal group={groupModal.group} onClose={() => setGroupModal(null)} />}
      {projectIn !== null && <ProjectModal groupId={projectIn} onClose={() => setProjectIn(null)} />}
    </>
  )
}
