import { useEffect, useMemo, type ReactNode } from 'react'
import { useUsers } from '../api/hooks'
import type { User, WorkStatus } from '../types'
import { MonkeyFace } from './Monkey'

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('')
}

/** Parses a YYYY-MM-DD date as local time (avoids the UTC off-by-one of new Date(iso)). */
export function parseDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y!, m! - 1, d!)
}

export function fmtDate(iso: string | null | undefined) {
  if (!iso) return 'No date'
  return parseDate(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

export function isOverdue(due: string | null, status: WorkStatus) {
  if (!due || status === 'Done') return false
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return parseDate(due) < today
}

export function useUserMap() {
  const { data } = useUsers()
  return useMemo(() => new Map((data ?? []).map((u) => [u.id, u])), [data])
}

/** People get a coloured square with initials; AI agents get a black square with a yellow "AI" tag. */
export function Avatar({ user, small }: { user?: Pick<User, 'name' | 'color'> & { kind?: User['kind'] }; small?: boolean }) {
  const size = small ? ' avatar--sm' : ''
  if (!user) return <span className={`avatar${size}`} title="Unassigned" style={{ background: 'var(--paper)' }}>?</span>
  if (user.kind === 'Agent') {
    return (
      <span className={`avatar avatar--agent${size}`} title={`${user.name} (AI agent)`}>
        {initials(user.name)}
      </span>
    )
  }
  return (
    <span className={`avatar${size}`} title={user.name} style={{ background: user.color }}>
      {initials(user.name)}
    </span>
  )
}

export function AgentBadge() {
  return <span className="badge badge--black">AI agent</span>
}

export function relTime(iso: string | null | undefined) {
  if (!iso) return ''
  // Server timestamps are UTC without a zone suffix.
  const t = new Date(/Z|[+-]\d\d:\d\d$/.test(iso) ? iso : iso + 'Z').getTime()
  const secs = Math.max(0, Math.round((Date.now() - t) / 1000))
  if (secs < 45) return 'just now'
  if (secs < 3600) return `${Math.round(secs / 60)} min ago`
  if (secs < 86400) return `${Math.round(secs / 3600)} h ago`
  return `${Math.round(secs / 86400)} d ago`
}

export function AvatarStack({ ids, users }: { ids: number[]; users: Map<number, User> }) {
  if (ids.length === 0) return <span className="muted">No members</span>
  return (
    <span className="avatar-stack">
      {ids.map((id) => <Avatar key={id} user={users.get(id)} small />)}
    </span>
  )
}

export function ProgressBar({ percent, small, label }: { percent: number; small?: boolean; label?: string }) {
  return (
    <div
      className={`progress${small ? ' progress--sm' : ''}`}
      role="progressbar"
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label ?? 'Progress'}
    >
      <div className={`progress-fill${percent >= 100 ? ' is-full' : ''}`} style={{ width: `${percent}%` }} />
    </div>
  )
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="btn btn--sm btn--icon" onClick={onClose} aria-label="Close">X</button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  )
}

export function Loading() {
  return <div className="loading">SWINGING IN...</div>
}

export function ErrorBox({ error }: { error: unknown }) {
  return <div className="alert" role="alert">{error instanceof Error ? error.message : 'Something went wrong.'}</div>
}

/** Empty-state speech bubble, with the monkey peeking over the top. */
export function Bubble({ children }: { children: ReactNode }) {
  return (
    <div className="bubble">
      <span className="bubble-monkey"><MonkeyFace /></span>
      {children}
    </div>
  )
}
