import { useState, type FormEvent } from 'react'
import { useAgentTemplates, useAiSettings, useProjects, useSaveAgent } from '../api/hooks'
import { useAuth } from '../auth'
import {
  AUTONOMY_OPTIONS, MODEL_LABEL, TOOL_OPTIONS, type Agent, type AgentTemplate, type Autonomy,
} from '../types'
import { ErrorBox, Modal } from './ui'

const AGENT_COLORS = ['#0A0A0A', '#FFD400', '#FFFFFF', '#E5251B', '#FFB800']
const MODELS = Object.keys(MODEL_LABEL)

export default function AgentModal({ agent, onClose }: { agent?: Agent; onClose: () => void }) {
  const { user } = useAuth()
  const { data: templates = [] } = useAgentTemplates(!agent)
  const { data: projects = [] } = useProjects()
  const { data: settings } = useAiSettings(user?.role === 'Admin')
  const save = useSaveAgent(agent?.userId)

  const [name, setName] = useState(agent?.name ?? '')
  const [description, setDescription] = useState(agent?.description ?? '')
  const [instructions, setInstructions] = useState(agent?.instructions ?? '')
  const [model, setModel] = useState<string>(agent?.model ?? '')
  const [autonomy, setAutonomy] = useState<Autonomy>(agent?.autonomy ?? 'AskFirst')
  const [tools, setTools] = useState<string[]>(agent?.allowedTools ?? TOOL_OPTIONS.map((t) => t.value))
  const [limit, setLimit] = useState(agent?.dailyRunLimit ?? 20)
  const [enabled, setEnabled] = useState(agent?.enabled ?? true)
  const [color, setColor] = useState(agent?.color ?? AGENT_COLORS[0]!)
  const [projectIds, setProjectIds] = useState<number[]>(agent?.projectIds ?? [])
  const [template, setTemplate] = useState<string | null>(null)

  const manageable = projects.filter((p) => p.canManage)
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v])

  function applyTemplate(t: AgentTemplate) {
    setTemplate(t.key)
    setName((n) => n || t.name)
    setDescription(t.description)
    setInstructions(t.instructions)
    setAutonomy(t.autonomy)
    setTools(t.allowedTools)
    setColor(t.color)
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    save.mutate(
      { name, description, instructions, model: model || null, autonomy, allowedTools: tools, enabled, dailyRunLimit: limit, projectIds, color },
      { onSuccess: onClose },
    )
  }

  const defaultLabel = settings ? `Default (${MODEL_LABEL[settings.defaultModel] ?? settings.defaultModel})` : 'Default model'

  return (
    <Modal title={agent ? `Edit ${agent.name}` : 'New agent'} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        {!agent && templates.length > 0 && (
          <div className="field">
            <label>Start from a template</label>
            <div className="row">
              {templates.map((t) => (
                <button key={t.key} type="button" className={`btn btn--sm${template === t.key ? ' btn--yellow' : ''}`} aria-pressed={template === t.key} onClick={() => applyTemplate(t)}>
                  {t.name}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="form-grid">
          <div className="field">
            <label htmlFor="an">Name</label>
            <input id="an" className="input" value={name} onChange={(e) => setName(e.target.value)} required maxLength={40} autoFocus />
          </div>
          <div className="field">
            <label>Colour</label>
            <div className="swatches">
              {AGENT_COLORS.map((c) => (
                <button key={c} type="button" className="swatch" style={{ background: c }} aria-pressed={color === c} aria-label={`Colour ${c}`} onClick={() => setColor(c)} />
              ))}
            </div>
          </div>
          <div className="field full">
            <label htmlFor="ad">Role (one line)</label>
            <input id="ad" className="input" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={400} placeholder="e.g. Research assistant that writes up findings" />
          </div>
          <div className="field full">
            <label htmlFor="ai">Instructions</label>
            <textarea id="ai" className="textarea" style={{ minHeight: 120 }} value={instructions} onChange={(e) => setInstructions(e.target.value)} maxLength={6000}
              placeholder="How should this agent work? Tone, format, what to check, what to avoid." />
          </div>

          <div className="field">
            <label htmlFor="am">Model</label>
            <select id="am" className="select" value={model} onChange={(e) => setModel(e.target.value)}>
              <option value="">{defaultLabel}</option>
              {MODELS.map((m) => <option key={m} value={m}>{MODEL_LABEL[m]}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="al">Runs per day (limit)</label>
            <input id="al" className="input" type="number" min={1} max={200} value={limit} onChange={(e) => setLimit(Number(e.target.value))} />
          </div>

          <div className="field full">
            <label>How much freedom does it have?</label>
            <div className="stack" style={{ gap: 6 }}>
              {AUTONOMY_OPTIONS.map((o) => (
                <label key={o.value} className={`choice${autonomy === o.value ? ' is-on' : ''}`}>
                  <input type="radio" name="autonomy" checked={autonomy === o.value} onChange={() => setAutonomy(o.value)} />
                  <span><strong>{o.label}</strong><span className="muted" style={{ display: 'block', fontSize: '0.85rem' }}>{o.help}</span></span>
                </label>
              ))}
            </div>
          </div>

          <div className="field full">
            <label>What can it do?</label>
            <div className="row">
              {TOOL_OPTIONS.map((t) => (
                <label key={t.value} className="chip" style={{ cursor: 'pointer', textTransform: 'none', letterSpacing: 0 }}>
                  <input type="checkbox" checked={tools.includes(t.value)} onChange={() => setTools((x) => toggle(x, t.value))} />
                  {t.label}
                </label>
              ))}
            </div>
            <span className="muted" style={{ fontSize: '0.8rem' }}>Reading project info is always allowed. Agents can never delete anything or change who is on a project.</span>
          </div>

          <div className="field full">
            <label>Which projects is it on?</label>
            <div className="row">
              {manageable.length === 0 && <span className="muted">You don't manage any projects yet.</span>}
              {manageable.map((p) => (
                <label key={p.id} className="chip" style={{ cursor: 'pointer', textTransform: 'none', letterSpacing: 0 }}>
                  <input type="checkbox" checked={projectIds.includes(p.id)} onChange={() => setProjectIds((x) => toggle(x, p.id))} />
                  {p.name}
                </label>
              ))}
            </div>
          </div>

          <label className="chip full" style={{ cursor: 'pointer', width: 'fit-content', textTransform: 'none', letterSpacing: 0 }}>
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            Agent is switched on
          </label>
        </div>

        {save.error && <ErrorBox error={save.error} />}
        <div className="modal-foot">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn--yellow" disabled={save.isPending}>{save.isPending ? 'Saving...' : agent ? 'Save' : 'Create agent'}</button>
        </div>
      </form>
    </Modal>
  )
}
