import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAgents, useAiStatus, useDeleteAgent, useProjects } from '../api/hooks'
import { useAuth } from '../auth'
import AgentModal from '../components/AgentModal'
import ApprovalsPanel from '../components/Approvals'
import { Avatar, Bubble, ErrorBox, Loading, relTime } from '../components/ui'
import { AUTONOMY_OPTIONS, MODEL_LABEL, RUN_LABEL, type Agent } from '../types'

export default function Agents() {
  const { user } = useAuth()
  const status = useAiStatus()
  const enabled = status.data?.enabled === true
  const { data: agents, isLoading, error } = useAgents(enabled)
  const { data: projects = [] } = useProjects()
  const del = useDeleteAgent()
  const [modal, setModal] = useState<{ agent?: Agent } | null>(null)

  if (status.isLoading) return <Loading />
  if (!enabled) {
    return (
      <>
        <div className="page-head"><h1 className="title-bar">Agents</h1></div>
        <Bubble>
          AI agents are switched off. {user?.role === 'Admin' ? <>Turn them on in <Link to="/admin/ai">AI settings</Link>.</> : 'Ask an admin to turn them on.'}
        </Bubble>
      </>
    )
  }
  if (isLoading) return <Loading />
  if (error) return <ErrorBox error={error} />

  const canCreate = user?.role !== 'Member'

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="title-bar">Agents</h1>
          <p className="sub">AI teammates. Assign them tasks like anyone else; they work in the background and report back on the task.</p>
          {status.data?.mode === 'Mock' && <p style={{ marginTop: 8 }}><span className="badge badge--yellow">DEMO MODE</span> <span className="muted">Agents give scripted replies until an admin adds a Claude key.</span></p>}
        </div>
        {canCreate && <button className="btn btn--black" onClick={() => setModal({})}>+ New agent</button>}
      </div>

      <div style={{ marginBottom: 24 }}><ApprovalsPanel hideWhenEmpty /></div>
      {del.error && <div style={{ marginBottom: 12 }}><ErrorBox error={del.error} /></div>}
      {agents?.length === 0 && <Bubble>No agents yet. {canCreate ? 'Create one from a template.' : 'Ask a manager to create one.'}</Bubble>}

      <div className="grid grid--cards">
        {agents?.map((a) => {
          const autonomy = AUTONOMY_OPTIONS.find((o) => o.value === a.autonomy)
          const names = projects.filter((p) => a.projectIds.includes(p.id)).map((p) => p.name)
          return (
            <article key={a.userId} className="card stack">
              <div className="row" style={{ gap: 12, flexWrap: 'nowrap', alignItems: 'flex-start' }}>
                <Avatar user={{ name: a.name, color: a.color, kind: 'Agent' }} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <h3>{a.name}</h3>
                  <p className="muted" style={{ fontSize: '0.9rem' }}>{a.description || 'No description'}</p>
                </div>
                <span className={`badge ${a.enabled ? 'badge--yellow' : ''}`}>{a.enabled ? 'On' : 'Off'}</span>
              </div>

              <div className="row" style={{ gap: 6 }}>
                <span className="badge badge--black">{autonomy?.label}</span>
                <span className="badge">{a.model ? MODEL_LABEL[a.model] ?? a.model : 'Default model'}</span>
              </div>

              <dl className="facts">
                <div><dt>Projects</dt><dd>{names.length ? names.join(', ') : 'None'}</dd></div>
                <div><dt>Today</dt><dd>{a.runsToday}/{a.dailyRunLimit} runs</dd></div>
                <div><dt>Last run</dt><dd>{a.lastRunStatus ? `${RUN_LABEL[a.lastRunStatus]} · ${relTime(a.lastRunAt)}` : 'Never'}</dd></div>
              </dl>

              {a.canEdit && (
                <div className="row">
                  <button className="btn btn--sm" onClick={() => setModal({ agent: a })}>Edit</button>
                  <button className="btn btn--sm btn--danger" onClick={() => confirm(`Delete ${a.name}? Its tasks become unassigned and its run history is removed.`) && del.mutate(a.userId)}>Delete</button>
                </div>
              )}
            </article>
          )
        })}
      </div>

      {modal && <AgentModal agent={modal.agent} onClose={() => setModal(null)} />}
    </>
  )
}
