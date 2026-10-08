import { NavLink, Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAgentWatcher, useAiStatus, useApprovals, useGroups, useProjects } from '../api/hooks'
import { useAuth } from '../auth'
import { MonkeyFace } from './Monkey'
import { Avatar, Loading } from './ui'

export default function Shell() {
  const { user, loading, logout } = useAuth()
  const location = useLocation()
  const { data: projects } = useProjects()
  const { data: groups } = useGroups()
  const aiEnabled = useAiStatus().data?.enabled === true
  const canApprove = aiEnabled && user?.role !== 'Member'
  const { data: approvals } = useApprovals(canApprove)
  useAgentWatcher()

  if (loading) return <div className="main"><Loading /></div>
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />

  return (
    <div className="shell">
      <aside className="sidebar">
        <NavLink to="/" className="brand" aria-label="GroupMonkey home"><MonkeyFace className="brand-monkey" />GroupMonkey</NavLink>

        <div className="stack" style={{ gap: 16 }}>
          <span className="nav-label">Menu</span>
          <nav className="nav" aria-label="Main">
            <NavLink to="/" end>Dashboard</NavLink>
            <NavLink to="/groups">Groups</NavLink>
            {aiEnabled && (
              <NavLink to="/agents">
                Agents{approvals && approvals.length > 0 && <span className="nav-count" aria-label={`${approvals.length} awaiting approval`}>{approvals.length}</span>}
              </NavLink>
            )}
            {user.role === 'Admin' && <NavLink to="/admin/ai">AI settings</NavLink>}
          </nav>
          {groups?.map((g) => {
            const list = projects?.filter((p) => p.groupId === g.id) ?? []
            return (
              <div key={g.id} className="stack" style={{ gap: 8 }}>
                <span className="nav-label nav-group" style={{ borderLeftColor: g.color === '#0A0A0A' ? '#FFFFFF' : g.color }}>{g.name}</span>
                <nav className="nav" aria-label={`${g.name} projects`}>
                  {list.length === 0 && <span className="nav-empty">No projects yet</span>}
                  {list.map((p) => (
                    <NavLink key={p.id} to={`/projects/${p.id}`} title={p.name}>{p.name}</NavLink>
                  ))}
                </nav>
              </div>
            )
          })}
        </div>

        <div className="sidebar-foot">
          <div className="me">
            <Avatar user={user} />
            <span>{user.name}<small>{user.role}</small></span>
          </div>
          <button className="btn btn--sm btn--yellow" onClick={logout}>Log out</button>
        </div>
      </aside>
      <main className="main">
        <Outlet />
      </main>
    </div>
  )
}
