import { useApprovals, useDecide } from '../api/hooks'
import { Avatar, Bubble, ErrorBox, relTime, useUserMap } from './ui'

/** Changes proposed by "Ask first" agents, waiting for a manager's decision. */
export default function ApprovalsPanel({ hideWhenEmpty }: { hideWhenEmpty?: boolean }) {
  const { data: items = [] } = useApprovals(true)
  const decide = useDecide()
  const users = useUserMap()

  if (items.length === 0) {
    return hideWhenEmpty ? null : <Bubble>Nothing is waiting for your approval.</Bubble>
  }

  return (
    <section className="card card--yellow stack" aria-label="Awaiting approval">
      <div className="row row--between">
        <h3>Awaiting your approval</h3>
        <span className="badge badge--black">{items.length}</span>
      </div>
      {decide.error && <ErrorBox error={decide.error} />}
      <ul className="list">
        {items.map((a) => (
          <li key={a.id} className="list-item" style={{ alignItems: 'flex-start' }}>
            <span className="row" style={{ gap: 10, alignItems: 'flex-start', flexWrap: 'nowrap' }}>
              <Avatar user={users.get(a.agentId)} />
              <span style={{ minWidth: 0 }}>
                <strong style={{ display: 'block' }}>{users.get(a.agentId)?.name ?? 'An agent'} proposes</strong>
                <span style={{ fontWeight: 600 }}>{a.summary}</span>
                <span className="muted" style={{ display: 'block', fontSize: '0.8rem' }}>{relTime(a.createdAt)}</span>
              </span>
            </span>
            <span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
              <button className="btn btn--sm btn--black" disabled={decide.isPending} onClick={() => decide.mutate({ id: a.id, approve: true })}>Approve</button>
              <button className="btn btn--sm" disabled={decide.isPending} onClick={() => decide.mutate({ id: a.id, approve: false })}>Reject</button>
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}
