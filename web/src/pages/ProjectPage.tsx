import { useState } from 'react'
import { NavLink, Outlet, useNavigate, useOutletContext, useParams } from 'react-router-dom'
import { useProject } from '../api/hooks'
import ProjectModal from '../components/ProjectModal'
import { ErrorBox, fmtDate, Loading } from '../components/ui'
import type { Project } from '../types'

export function useProjectContext() {
  return useOutletContext<{ project: Project }>()
}

export default function ProjectPage() {
  const id = Number(useParams().id)
  const navigate = useNavigate()
  const { data: project, isLoading, error } = useProject(id)
  const [editing, setEditing] = useState(false)

  if (isLoading) return <Loading />
  if (error || !project) return <ErrorBox error={error ?? new Error('Project not found.')} />

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="title-bar">{project.name}</h1>
          <p className="sub">{project.description}</p>
          <div className="row" style={{ marginTop: 10 }}>
            <span className="badge badge--black">{project.status}</span>
            <span className="badge">{fmtDate(project.startDate)} to {fmtDate(project.dueDate)}</span>
          </div>
        </div>
        {project.canEdit && <button className="btn" onClick={() => setEditing(true)}>Edit project</button>}
      </div>

      <nav className="tabs" aria-label="Project sections">
        <NavLink to="" end className="tab">Overview</NavLink>
        <NavLink to="board" className="tab">Board</NavLink>
        <NavLink to="groups" className="tab">Groups</NavLink>
        <NavLink to="goals" className="tab">Goals</NavLink>
      </nav>

      <Outlet context={{ project }} />

      {editing && <ProjectModal project={project} onClose={() => setEditing(false)} onDeleted={() => navigate('/')} />}
    </>
  )
}
