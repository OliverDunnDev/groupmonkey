// Demo parity check: the static GitHub Pages demo (src/demo/server.ts) is a TypeScript re-implementation of the .NET API.
// This script runs the same long sequence of requests against BOTH and diffs every response, so the two can't drift apart silently.
//
//   1. Start a FRESH real API in demo-friendly mode (fresh = untouched seed data):
//        dotnet run --project src/GroupMonkey.Api --no-launch-profile --urls http://localhost:5081 //          --Ai:DataDir=<some temp dir> --Ai:ForceMock=true --Ai:MockDelayMs=50
//   2. From web/:   npm run parity            (override the target with REAL_API=http://host:port/api)
//
// Needs Node 22.18+/24 (runs the .ts demo files directly). Exits non-zero on any mismatch. The only intentional differences
// are normalised below: the demo refuses API keys, and its scripted reply wording points at running locally.
import { pathToFileURL } from 'node:url'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const REAL = process.env.REAL_API ?? 'http://localhost:5081/api'
const here = dirname(fileURLToPath(import.meta.url))
const demo = await import(pathToFileURL(resolve(here, '../src/demo/server.ts')).href)

const USERS = { ava: 'admin@groupmonkey.dev', marcus: 'manager@groupmonkey.dev', priya: 'member@groupmonkey.dev', sam: 'sam@groupmonkey.dev' }
const realTok = {}
const demoTok = {}
for (const [k, email] of Object.entries(USERS)) {
  const r = await fetch(`${REAL}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'password123' }) })
  realTok[k] = (await r.json()).token
  demoTok[k] = (await demo.handle('POST', '/auth/login', { email, password: 'password123' }, null)).data.token
}

async function callReal(user, method, path, body) {
  const res = await fetch(`${REAL}${path}`, {
    method,
    headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), Authorization: `Bearer ${realTok[user]}` },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  let data
  try { data = res.status === 204 ? undefined : await res.json() } catch { data = undefined }
  return { status: res.status, data }
}
const callDemo = (user, method, path, body) => demo.handle(method, path, body, demoTok[user])

const TS_KEYS = new Set(['createdAt', 'startedAt', 'endedAt', 'at', 'lastRunAt'])
const unescapeU = (s) => s.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
// Intentional wording differences between the real mock agent and the demo's:
const SAME_TEXT = [
  [/Demo mode: no Claude API key is configured, so this is a scripted response and no AI model is called\./g, '<demo-thought>'],
  [/Demo mode: this is a scripted response and no AI model is called\./g, '<demo-thought>'],
  [/_This is a scripted demo reply\. (Add a Claude API key in AI settings to run real agents|Run the app locally with a Claude API key to use real agents)\._/g, '<demo-footnote>'],
]
const unify = (s) => SAME_TEXT.reduce((t, [re, to]) => t.replace(re, to), s)
function norm(v, key = '') {
  if (Array.isArray(v)) return v.map((x) => norm(x))
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, norm(v[k], k)]))
  if (TS_KEYS.has(key) && v !== null) return '<ts>'
  // .NET escapes a quote inside embedded JSON as a unicode escape, JavaScript as backslash-quote: the same JSON text, so treat them as equal.
  if (typeof v === 'string') return unify(unescapeU(v)).replace(/\\"/g, '"')
  return v
}
// Step text that embeds timestamps (tool results echo comment times); mask ISO timestamps inside strings.
const maskTs = (s) => (typeof s === 'string' ? s.replace(/\d{4}-\d\d-\d\dT[\d:.]+Z?/g, '<ts>') : s)
function deepMask(v) {
  if (Array.isArray(v)) return v.map(deepMask)
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, deepMask(x)]))
  return maskTs(v)
}

function diffs(a, b, path = '', out = []) {
  if (out.length > 12) return out
  if (typeof a !== typeof b || Array.isArray(a) !== Array.isArray(b) || (a === null) !== (b === null)) { out.push(`${path}: real=${JSON.stringify(a)?.slice(0, 120)} demo=${JSON.stringify(b)?.slice(0, 120)}`); return out }
  if (Array.isArray(a)) {
    if (a.length !== b.length) out.push(`${path}: array length real=${a.length} demo=${b.length}`)
    for (let i = 0; i < Math.min(a.length, b.length); i++) diffs(a[i], b[i], `${path}[${i}]`, out)
  } else if (a && typeof a === 'object') {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (!(k in a)) out.push(`${path}.${k}: only in demo (${JSON.stringify(b[k])?.slice(0, 80)})`)
      else if (!(k in b)) out.push(`${path}.${k}: only in real (${JSON.stringify(a[k])?.slice(0, 80)})`)
      else diffs(a[k], b[k], `${path}.${k}`, out)
    }
  } else if (a !== b) {
    if (typeof a === 'string' && typeof b === 'string' && (a.length > 100 || b.length > 100)) {
      // Long text: show the first point where they diverge, with context.
      let i = 0
      while (i < a.length && i < b.length && a[i] === b[i]) i++
      out.push(`${path}: differ at char ${i}: real=...${JSON.stringify(a.slice(Math.max(0, i - 30), i + 60))} demo=...${JSON.stringify(b.slice(Math.max(0, i - 30), i + 60))}`)
    } else out.push(`${path}: real=${JSON.stringify(a)?.slice(0, 120)} demo=${JSON.stringify(b)?.slice(0, 120)}`)
  }
  return out
}

let checks = 0
let failures = 0
async function step(label, user, method, path, body, { wait = 0 } = {}) {
  const [r, d] = await Promise.all([callReal(user, method, path, body), callDemo(user, method, path, body)])
  if (wait) await new Promise((res) => setTimeout(res, wait))
  compare(label, r, d)
  return { r, d }
}
function compare(label, r, d) {
  checks++
  const problems = []
  if (r.status !== d.status) problems.push(`status real=${r.status} demo=${d.status}`)
  else if (r.status < 400) problems.push(...diffs(deepMask(norm(r.data)), deepMask(norm(d.data))))
  else {
    // For errors compare the error text when both have one (403/404 carry no body on the real API).
    const re = r.data?.error, de = d.data?.error
    if (re !== de) problems.push(`error text real=${JSON.stringify(re)} demo=${JSON.stringify(de)}`)
  }
  if (problems.length) { failures++; console.log(`FAIL  ${label}\n      ${problems.join('\n      ')}`) }
}
const wait = (ms) => new Promise((res) => setTimeout(res, ms))

const GETS_FOR = (aiOn) => [
  '/users', '/groups', '/groups/1', '/groups/2', '/groups/3', '/projects', '/projects/1', '/projects/2', '/projects/3',
  '/projects/1/summary', '/projects/2/summary', '/projects/3/summary', '/projects/1/tasks', '/projects/2/tasks', '/projects/3/tasks',
  '/projects/1/goals', '/projects/2/goals', '/projects/3/goals', '/ai/status', '/auth/me',
  ...(aiOn ? ['/agents', '/agents/templates', '/approvals', '/runs/recent', '/tasks/7/comments', '/tasks/7/runs', '/tasks/17/comments', '/tasks/17/runs', '/runs/1'] : ['/agents', '/approvals', '/tasks/7/comments']),
]
async function sweep(tag, aiOn) {
  for (const user of Object.keys(USERS)) for (const path of GETS_FOR(aiOn)) await step(`${tag} GET ${path} as ${user}`, user, 'GET', path)
  await step(`${tag} GET /admin/ai as ava`, 'ava', 'GET', '/admin/ai')
  await step(`${tag} GET /admin/ai as marcus (forbidden)`, 'marcus', 'GET', '/admin/ai')
}

// ---------------------------------------------------------------- 1. fresh seed, AI off
await sweep('[seed, AI off]', false)

// ---------------------------------------------------------------- 2. groups / projects / tasks / goals mutations
await step('create group', 'marcus', 'POST', '/groups', { name: 'QA Guild', description: 'Testing', color: '#FFFFFF', memberIds: [3, 4] })
await step('duplicate group name', 'marcus', 'POST', '/groups', { name: 'qa guild' })
await step('member cannot create group', 'priya', 'POST', '/groups', { name: 'Nope' })
await step('short group name', 'marcus', 'POST', '/groups', { name: 'x' })
await step('project without group', 'marcus', 'POST', '/projects', { name: 'Loose' })
await step('project in new group', 'marcus', 'POST', '/projects', { name: 'Release checklist', description: 'ship it', groupId: 4 })
await step('member cannot create project', 'priya', 'POST', '/projects', { name: 'Nope', groupId: 1 })
await step('task in new project', 'marcus', 'POST', '/projects/4/tasks', { title: 'First', description: 'd', status: 'Todo', priority: 'High', assigneeId: 4, goalId: null, dueDate: null })
await step('assign non-member', 'marcus', 'POST', '/projects/4/tasks', { title: 'Second', assigneeId: 3 })
await step('blank task title', 'marcus', 'POST', '/projects/4/tasks', { title: ' ' })
await step('update task', 'marcus', 'PUT', '/tasks/24', { title: 'First (edited)', description: 'x', status: 'InProgress', priority: 'Low', assigneeId: 2, goalId: null, dueDate: '2026-12-01' })
await step('member moves a card', 'priya', 'PATCH', '/tasks/8/status', { status: 'InProgress' })
await step('invisible project task', 'priya', 'PATCH', '/tasks/19/assignee', { assigneeId: 4 })
await step('admin assigns outsider', 'ava', 'PATCH', '/tasks/19/assignee', { assigneeId: 3 })
await step('admin assigns member', 'ava', 'PATCH', '/tasks/19/assignee', { assigneeId: 4 })
await step('add member to group 3', 'marcus', 'POST', '/groups/3/members/3')
await step('assign newly added member', 'marcus', 'PATCH', '/tasks/19/assignee', { assigneeId: 3 })
await step('remove member (unassigns)', 'marcus', 'DELETE', '/groups/3/members/3')
await step('tasks after removal', 'marcus', 'GET', '/projects/3/tasks')
await step('remove owner', 'marcus', 'DELETE', '/groups/1/members/2')
await step('member cannot add member', 'priya', 'POST', '/groups/1/members/1')
await step('remove Sam from Web Team', 'marcus', 'DELETE', '/groups/1/members/4')
await step('Sam lost access', 'sam', 'GET', '/projects/1')
await step('update group + replace members', 'marcus', 'PUT', '/groups/1', { name: 'Web Team', description: 'Websites', color: '#FFD400', memberIds: [3, 1] })
await step('project edit', 'marcus', 'PUT', '/projects/1', { name: 'Website Relaunch 2', description: 'new', status: 'Active', startDate: '2026-01-01', dueDate: '2027-01-01', groupId: 2 })
await step('member cannot edit project', 'priya', 'PUT', '/projects/1', { name: 'x' })
await step('create goal', 'marcus', 'POST', '/projects/1/goals', { title: 'New goal', description: 'g', targetDate: '2026-12-31' })
await step('edit goal', 'marcus', 'PUT', '/goals/8', { title: 'New goal 2', description: '', targetDate: null })
await step('delete goal', 'marcus', 'DELETE', '/goals/8')
await step('delete task', 'marcus', 'DELETE', '/tasks/24')
await step('non-owner cannot delete group', 'marcus', 'DELETE', '/groups/3')
await step('admin deletes group (cascade)', 'ava', 'DELETE', '/groups/3')
await step('deleted project 404', 'ava', 'GET', '/projects/3')
await step('delete new project', 'marcus', 'DELETE', '/projects/4')
await sweep('[after mutations, AI off]', false)

// ---------------------------------------------------------------- 3. AI on
await step('manager cannot enable AI', 'marcus', 'PUT', '/admin/ai', { enabled: true })
{
  // The real API stores the key; the static demo must refuse it (never paste a real key into a static site).
  const r = await callReal('ava', 'PUT', '/admin/ai', { apiKey: 'sk-ant-test-abcdefghijklmnop1234' })
  const d = await callDemo('ava', 'PUT', '/admin/ai', { apiKey: 'sk-ant-test-abcdefghijklmnop1234' })
  checks++
  if (r.status !== 200 || d.status !== 400) { failures++; console.log(`FAIL  api key handling: real=${r.status} (want 200) demo=${d.status} (want 400)`) }
  await callReal('ava', 'PUT', '/admin/ai', { clearKey: true })
}
await step('unknown model', 'ava', 'PUT', '/admin/ai', { defaultModel: 'gpt-5' })
await step('enable AI', 'ava', 'PUT', '/admin/ai', { enabled: true })
await sweep('[AI on]', true)

await step('create autonomous agent', 'marcus', 'POST', '/agents', { name: 'Bolt', description: 'Quick drafts', instructions: 'Be brief.', model: null, autonomy: 'Autonomous', allowedTools: null, enabled: null, dailyRunLimit: null, groupIds: [2], color: null })
await step('duplicate agent name', 'marcus', 'POST', '/agents', { name: 'Bolt' })
await step('member cannot create agent', 'priya', 'POST', '/agents', { name: 'Newbie' })
await step('run needs an agent assignee', 'marcus', 'POST', '/tasks/12/run')
await step('assign to Bolt (starts run)', 'marcus', 'PATCH', '/tasks/12/assignee', { assigneeId: 7 })
await step('already running', 'marcus', 'POST', '/tasks/12/run')
await wait(6000)
await step('Bolt run result', 'marcus', 'GET', '/tasks/12/runs')
await step('Bolt comments', 'marcus', 'GET', '/tasks/12/comments')
await step('Bolt moved card to Review', 'marcus', 'GET', '/projects/2/tasks')

await step('assign to Scout (AskFirst)', 'marcus', 'PATCH', '/tasks/10/assignee', { assigneeId: 5 })
await wait(6000)
await step('Scout run', 'marcus', 'GET', '/tasks/10/runs')
await step('pending approvals', 'marcus', 'GET', '/approvals')
await step('member cannot approve', 'priya', 'POST', '/approvals/2/approve')
await step('approve', 'marcus', 'POST', '/approvals/2/approve')
await step('approve again', 'marcus', 'POST', '/approvals/2/approve')
await step('reject seeded', 'marcus', 'POST', '/approvals/1/reject')
await step('runs after decisions', 'marcus', 'GET', '/runs/recent')

await step('assign to Patch (Suggest)', 'marcus', 'PATCH', '/tasks/13/assignee', { assigneeId: 6 })
await wait(6000)
await step('Patch run (can only comment)', 'marcus', 'GET', '/tasks/13/runs')

await step('task that asks a question', 'marcus', 'POST', '/projects/1/tasks', { title: 'Draft launch note', description: '[ask] write the announcement', assigneeId: 5 })
await wait(6000)
await step('needs input run', 'marcus', 'GET', '/tasks/24/runs')
await step('reply resumes the agent', 'marcus', 'POST', '/tasks/24/comments', { body: "It's for customers, due Friday." })
await wait(6000)
await step('two runs now', 'marcus', 'GET', '/tasks/24/runs')
await step('comments', 'marcus', 'GET', '/tasks/24/comments')
await step('empty comment', 'marcus', 'POST', '/tasks/24/comments', { body: '  ' })
await step('cancel finished run', 'marcus', 'POST', '/runs/2/cancel')
await step('edit agent', 'marcus', 'PUT', '/agents/7', { name: 'Bolt', description: 'Edited', instructions: 'x', model: 'claude-sonnet-5-5', autonomy: 'AskFirst', allowedTools: ['add_comment'], enabled: true, dailyRunLimit: 5, groupIds: [2, 1], color: '#FFD400' })
await step('delete agent', 'marcus', 'DELETE', '/agents/7')
await sweep('[AI on, after runs]', true)

await step('disable AI', 'ava', 'PUT', '/admin/ai', { enabled: false })
await sweep('[AI off again]', false)

console.log(`\n${checks} comparisons, ${failures} mismatches`)
process.exit(failures ? 1 : 0)
