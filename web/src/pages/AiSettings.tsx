import { useState, type FormEvent } from 'react'
import { useAiSettings, useSaveAiSettings, useTestAi } from '../api/hooks'
import { useAuth } from '../auth'
import { isDemo } from '../demo/flag'
import { Bubble, ErrorBox, Loading } from '../components/ui'
import { MODEL_LABEL } from '../types'

export default function AiSettings() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'Admin'
  const { data: s, isLoading, error } = useAiSettings(isAdmin)
  const save = useSaveAiSettings()
  const test = useTestAi()
  const [key, setKey] = useState('')
  const [model, setModel] = useState<string | null>(null)

  if (!isAdmin) {
    return (
      <>
        <div className="page-head"><h1 className="title-bar">AI settings</h1></div>
        <Bubble>Only admins can change AI settings.</Bubble>
      </>
    )
  }
  if (isLoading) return <Loading />
  if (error || !s) return <ErrorBox error={error} />

  const selectedModel = model ?? s.defaultModel

  function saveKey(e: FormEvent) {
    e.preventDefault()
    if (!key.trim()) return
    test.reset()
    save.mutate({ apiKey: key.trim() }, { onSuccess: () => setKey('') })
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="title-bar">AI settings</h1>
          <p className="sub">Let AI agents join your projects as teammates. Optional, and off until you switch it on.</p>
        </div>
      </div>

      <div className="stack" style={{ gap: 24, maxWidth: 760 }}>
        <section className="card stack">
          <div className="row row--between">
            <div>
              <h2>AI agents</h2>
              <p className="muted">When on, agents can be created, added to projects and assigned tasks.</p>
            </div>
            <button
              role="switch"
              aria-checked={s.enabled}
              className={`switch${s.enabled ? ' is-on' : ''}`}
              disabled={save.isPending}
              onClick={() => save.mutate({ enabled: !s.enabled })}
            >
              <span className="switch-knob" />
              <span className="switch-label">{s.enabled ? 'ON' : 'OFF'}</span>
            </button>
          </div>
          <div className={`alert ${s.mode === 'Claude' ? 'alert--info' : 'alert--info'}`}>
            {s.mode === 'Claude'
              ? `LIVE: agents use Claude (${MODEL_LABEL[s.defaultModel] ?? s.defaultModel} by default).`
              : 'DEMO MODE: no Claude key is set, so agents give scripted replies and no AI model is called. Add a key below to run real agents.'}
          </div>
        </section>

        <section className="card stack">
          <h2>Claude API key</h2>
          <p>
            {s.hasKey ? (
              <>
                <span className="badge badge--black">Key set</span>{' '}
                <strong>{s.keyHint}</strong>{' '}
                <span className="muted">
                  {s.keySource === 'admin' ? 'Stored encrypted on the server. It is never shown again or sent to the browser.' : 'Provided by the server configuration (Anthropic:ApiKey).'}
                </span>
              </>
            ) : (
              <span className="muted">No key set. Create an API key in your Claude Console account and paste it here.</span>
            )}
          </p>

          {isDemo && (
            <div className="alert alert--info">
              This is the static demo, so API keys can't be entered (never paste a real key into a site like this). Agents give scripted replies.
              To run real Claude agents, run the app locally and add your key there.
            </div>
          )}
          <form className="stack" onSubmit={saveKey} hidden={isDemo}>
            <div className="field">
              <label htmlFor="apikey">{s.hasKey ? 'Replace key' : 'API key'}</label>
              <input id="apikey" className="input" type="password" autoComplete="off" spellCheck={false} placeholder="sk-ant-..." value={key} onChange={(e) => setKey(e.target.value)} />
            </div>
            {save.error && <ErrorBox error={save.error} />}
            <div className="row">
              <button className="btn btn--black" disabled={save.isPending || !key.trim()}>Save key</button>
              <button type="button" className="btn btn--yellow" disabled={test.isPending} onClick={() => test.mutate()}>
                {test.isPending ? 'Testing...' : 'Test connection'}
              </button>
              {s.keySource === 'admin' && (
                <button type="button" className="btn btn--danger" disabled={save.isPending} onClick={() => confirm('Remove the stored API key? Agents will go back to demo mode.') && save.mutate({ clearKey: true })}>
                  Remove key
                </button>
              )}
            </div>
          </form>

          {test.data && <div className={`alert${test.data.ok ? ' alert--info' : ''}`} role="status">{test.data.ok ? 'OK: ' : ''}{test.data.message}</div>}
          {test.error && <ErrorBox error={test.error} />}
          <p className="muted" style={{ fontSize: '0.85rem' }}>
            Agent runs are billed to the account that owns this key. Each agent has a daily run limit, and every run is capped in length, so spend stays bounded.
          </p>
        </section>

        <section className="card stack">
          <h2>Default model</h2>
          <div className="field">
            <label htmlFor="model">Used by agents that don't choose their own</label>
            <select id="model" className="select" value={selectedModel} onChange={(e) => setModel(e.target.value)}>
              {s.models.map((m) => <option key={m} value={m}>{MODEL_LABEL[m] ?? m}</option>)}
            </select>
          </div>
          <div className="row">
            <button className="btn btn--black" disabled={save.isPending || selectedModel === s.defaultModel} onClick={() => save.mutate({ defaultModel: selectedModel }, { onSuccess: () => setModel(null) })}>
              Save model
            </button>
          </div>
        </section>
      </div>
    </>
  )
}
