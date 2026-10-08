import { useState, type FormEvent } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth'

// Mock accounts seeded by the API. Shown as quick-fill buttons for the demo.
const DEMO = [
  { label: 'Admin', email: 'admin@groupmonkey.dev', name: 'Ava Admin' },
  { label: 'Manager', email: 'manager@groupmonkey.dev', name: 'Marcus Manager' },
  { label: 'Member', email: 'member@groupmonkey.dev', name: 'Priya Patel' },
  { label: 'Member', email: 'sam@groupmonkey.dev', name: 'Sam Okafor' },
]

export default function Login() {
  const { user, login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as { from?: string } | null)?.from ?? '/'

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (user) return <Navigate to={from} replace />

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await login(email, password)
      navigate(from, { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login">
      <div className="card login-card stack">
        <div className="brand">GroupMonkey</div>
        <form className="stack" onSubmit={submit}>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input id="password" className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          {error && <div className="alert" role="alert">{error}</div>}
          <button className="btn btn--black" disabled={busy}>{busy ? 'Logging in...' : 'Log in'}</button>
        </form>

        <div className="stack" style={{ gap: 8 }}>
          <div className="alert alert--info">DEMO MODE: pick a mock user (password: password123)</div>
          <div className="demo-users">
            {DEMO.map((d) => (
              <button
                key={d.email}
                type="button"
                className="btn btn--yellow"
                onClick={() => { setEmail(d.email); setPassword('password123'); setError(null) }}
              >
                {d.name}
                <small>{d.label.toUpperCase()}</small>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
