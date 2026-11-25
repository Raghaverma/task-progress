import { expect, mock, test } from 'claude-code/testing'

import { buildPaneModel, hasUnfinished, onCubesPaneClose, renderCubesPane, TONES } from './cubes-pane'
import { dashSetCubes } from './dashboard'

const INPUTS = 'mcp__task-progress__TaskInputs'
const PLAN = 'mcp__task-progress__TaskPlan'
const DESC = { summary: 'Does the thing so it works.', problem: ['It is broken'], steps: ['Edit the file'], code: [{ file: 'a.ts › a', change: 'fix it' }] }
const APPROACH = { questions: [{ header: 'Approach', question: 'How?', options: [{ label: 'A (Recommended)' }, { label: 'B' }] }] }
const FLOW = [{ file: 'a.ts', fn: 'a', does: 'a' }, { file: 'b.ts', fn: 'b', does: 'b' }]
const cube = (id: string, status: string, extra: any = {}) => ({ id, title: `title ${id}`, action: 'x', flow: [], after: [], doneWhen: 'ok', minutes: 3, status, version: 1, ...extra })
const board = (cubes: any[]) => ({ task: 'T', gate: true, cubes, lanes: [] }) as any
const NOW = 5_000_000
const agent = (id: string, extra: any = {}) => ({ id, description: 'd', type: 'task-progress:executor', status: 'running', startedAt: NOW - 60_000, budgetMin: 4, ...extra })

const MIXED = board([
  cube('c1', 'done', { startedAt: NOW - 300_000, endedAt: NOW - 120_000 }),
  cube('c2', 'reviewing', { after: ['c1'] }),
  cube('c3', 'running', { after: ['c1'], agentId: 'a1' }),
  cube('c4', 'proposed', { after: ['c3'], ...DESC }),
  cube('c5', 'queued', { after: ['c1', 'c3', 'c4'] }),
  cube('c6', 'failed', { review: { status: 'changes', verdict: 'REQUEST_CHANGES', summary: 'Null deref.', findings: [{ severity: 'P1', file: 'x.ts', line: 3, summary: 'lanes may be undefined' }, { severity: 'P3', summary: 'naming' }], at: 1 } }),
  cube('c7', 'rejected'),
  cube('c8', 'approved'),
])
const AGENTS = [agent('a1', { lastTool: 'Edit hooks/x.ts', cube: { id: 'c3', kind: 'build' } }), agent('a2', { type: 'feature-dev:code-reviewer', cube: { id: 'c2', kind: 'review' }, lastTool: 'Read y.ts' }), agent('a3', { type: 'Explore', description: 'look around' })]

test('model: cubes are grouped by what they need, each status with its own glyph', () => {
  const m: any = buildPaneModel(MIXED, AGENTS as any, NOW)
  expect(m.kind).toBe('board')
  expect(m.sections.map((x: any) => [x.key, x.count])).toEqual([['needs', 2], ['active', 2], ['next', 2], ['done', 2]])
  expect(m.counts).toBe('1 of 7 done · 2 in progress · 2 need you')
  expect([m.done, m.total]).toEqual([1, 7])
  const rows = m.sections.flatMap((x: any) => x.rows)
  const by = (id: string) => rows.find((r: any) => r.id === id)
  expect([by('c4').glyph, by('c4').tone, by('c4').meta]).toEqual(['●', 'needs', '3m'])
  expect([by('c6').glyph, by('c6').tone, by('c6').sub]).toEqual(['✗', 'fail', 'review asked for changes · 1 P0/P1'])
  expect([by('c3').glyph, by('c3').meta, by('c3').sub]).toEqual(['◐', '3:00', 'executor · Edit hooks/x.ts'])
  expect([by('c2').glyph, by('c2').sub]).toEqual(['◑', 'code-reviewer · Read y.ts'])
  expect([by('c5').glyph, by('c5').sub]).toEqual(['◌', 'after c3, c4'])
  expect([by('c8').glyph, by('c8').meta]).toEqual(['○', 'starting'])
  // Done is collapsed until opened; the rejected cube blocks nothing, so it is there too.
  expect(m.sections[3].rows).toEqual([])
  // Needs-you rows show their actions; in-progress rows only once opened.
  expect([by('c4').showActions, by('c4').actions]).toEqual([true, ['approve', 'reject', 'change', 'ask']])
  expect([by('c3').showActions, by('c3').actions]).toEqual([false, ['ask']])
  // Only the stray agent gets its own row: a1 and a2 show on their cubes.
  expect(m.agents.map((a: any) => a.id)).toEqual(['a3'])
  expect(m.approveAll).toBe(1)
})

test('model: a rejected cube that holds others back moves to Needs you, and the blocked cube says why', () => {
  const m: any = buildPaneModel(board([cube('c1', 'rejected', { note: 'not now' }), cube('c2', 'proposed', { after: ['c1'] })]))
  expect(m.sections.map((x: any) => x.key)).toEqual(['needs'])
  const [rej, blocked] = m.sections[0].rows
  expect([rej.glyph, rej.sub, rej.actions]).toEqual(['⊘', 'holds back c2', ['restore', 'delete']])
  expect([blocked.sub, blocked.subTone]).toEqual(['blocked: c1 was rejected (restore or delete it)', 'fail'])
})

test('model: an opened cube shows its details, review findings and questions; Done opens with _done', () => {
  const thread = [{ role: 'user', text: 'Why?', at: 1 }, { role: 'claude', text: 'Because.', at: 2 }]
  const b = board([cube('c1', 'failed', { ...DESC, review: MIXED.cubes[5].review, thread }), cube('c2', 'done'), cube('c3', 'proposed', { ...DESC, thread })])
  const m: any = buildPaneModel(b, [], NOW, ['c1', '_done'])
  const c1 = m.sections[0].rows.find((r: any) => r.id === 'c1')
  expect(c1.open).toBe(true)
  expect(c1.details.map((d: any) => d.title)).toEqual(['Summary', 'Problem', 'Steps', 'Code touched', 'Done when', 'Review', 'Questions'])
  const review = c1.details.find((d: any) => d.title === 'Review')
  expect(review.items.map((i: any) => [i.text, i.tone ?? (i.dim ? 'dim' : '')])).toEqual([
    ['request changes · Null deref.', 'fail'],
    ['P1 x.ts:3 · lanes may be undefined', 'fail'],
    ['P3 · naming', 'dim'],
  ])
  expect(c1.details.find((d: any) => d.title === 'Questions').items.map((i: any) => i.text)).toEqual(['You: Why?', 'Claude: Because.'])
  expect(m.sections.find((x: any) => x.key === 'done').rows.map((r: any) => r.id)).toEqual(['c2'])
  // A closed cube with an answer points at it.
  const c3 = m.sections[0].rows.find((r: any) => r.id === 'c3')
  expect([c3.sub, c3.subTone]).toEqual(['Claude answered · open to read', 'needs'])
})

test('model: empty state and unfinished detection', () => {
  expect(buildPaneModel(null).kind).toBe('empty')
  expect(buildPaneModel(board([])).kind).toBe('empty')
  expect(hasUnfinished(board([cube('c1', 'done')]))).toBe(false)
  expect(hasUnfinished(board([cube('c1', 'done'), cube('c2', 'queued')]))).toBe(true)
  expect(hasUnfinished(null)).toBe(false)
})

function setup($: any, on: any) {
  mock.clock(on, { now: 5_000_000 })
  const opens: any[] = []
  on('ui.render', ($: any, e: any) => {
    const { Text } = $.ui.resolve(e)
    return <Text>ENGINE</Text>
  })
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))
  on('tool.register', () => ({ value: { tool: 'x' } }))
  on('command.register', () => ({ value: { command: 'x' } }))
  on('tool.call', () => ({ result: {} }))
  on('prompt.submit', (_: any, e: any) => ({ text: e.text, context: e.context }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.open', (_: any, e: any) => {
    opens.push(e)
    return { value: { isPlaced: true } }
  })
  const plan = async () => {
    await $.tool.call({ tool: INPUTS, inputs: [], asked: false })
    await $.tool.call({ tool: 'AskUserQuestion', ...APPROACH })
    return $.tool.call({ tool: PLAN, task: 'T', cubes: [{ ...DESC, id: 'c1', title: 't', action: 'Do one thing', flow: FLOW, doneWhen: 'ok', minutes: 3 }] })
  }
  const start = () => $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  return { opens, plan, start }
}

test('recording a cube plan opens the pane without taking focus', async ($, on) => {
  const { opens, plan, start } = setup($, on)
  await start()
  const r = await plan()
  expect(String(r.result)).toContain('cube plan recorded')
  const o = opens.filter(x => x.id === 'tp-cubes')
  expect(o.length).toBe(1)
  expect(o[0].title).toBe('Cubes')
  expect(o[0].focus).toBeUndefined()
  expect(o[0].columns).toBe(44)
})

test('a person close is remembered, another origin is not; a new plan reopens', async ($, on) => {
  const store: Record<string, unknown> = {}
  const fake = { state: { set: async (r: any, v: unknown) => void (store[r.key] = v) } }
  const next = async (e: any) => e
  await onCubesPaneClose(fake, { id: 'tp-cubes', origin: { kind: 'plugin' } }, next)
  expect(store.cubesPaneClosed).toBeUndefined()
  await onCubesPaneClose(fake, { id: 'tp-cubes', origin: { kind: 'person' } }, next)
  expect(store.cubesPaneClosed).toBe(true)
  const { opens, plan, start } = setup($, on)
  await start()
  await plan()
  await plan()
  expect(opens.filter(x => x.id === 'tp-cubes').length).toBe(2)
})

test('bare /tp-cubes and /tp-cubes panel open the pane', async ($, on) => {
  const { opens, start } = setup($, on)
  await start()
  const r = await $.command.run({ command: 'tp-cubes' })
  expect(opens.filter(x => x.id === 'tp-cubes').length).toBe(1)
  expect(opens[0].focus).toBeUndefined()
  expect(String(r.text)).toContain('panel')
  await $.command.run({ command: 'tp-cubes', args: 'panel' })
  expect(opens.length).toBe(2)
  const st = await $.command.run({ command: 'tp-cubes', args: 'status' })
  expect(String(st.text)).toContain('Approval cubes')
  expect(opens.length).toBe(2)
})


// A fake $ with stub components; the pane's tree is walked for elements by type.
function fakeEnv(cubes: any[], extra: Record<string, any> = {}) {
  const store = new Map<string, any>([['snapshot', { session: { id: '', cwd: '', startedAt: 1 }, orchestrate: true, progress: null, plan: null, agents: [], usage: null, cubes: board(cubes) }], ...Object.entries(extra)])
  const toasts: string[] = []
  const prompts: string[] = []
  const $: any = {
    session: { id: async () => 's1' },
    state: { get: async (r: any) => ({ value: store.get(r.key) ?? null }), set: async (r: any, v: any) => void store.set(r.key, v) },
    clock: { now: async () => NOW, after: () => ({ cancel() {} }), every: () => ({ cancel() {} }) },
    prompt: { submit: async ({ text }: any) => void prompts.push(text) },
    ui: { resolve: () => ({ Box: 'Box', Text: 'Text', Button: 'Button', Input: 'Input', Progress: 'Progress' }), toast: (t: string) => void toasts.push(t), log() {} },
  }
  const find = async (type: string, surface = 'terminal') => {
    const found: any[] = []
    const walk = (n: any) => {
      if (Array.isArray(n)) return n.forEach(walk)
      if (!n || typeof n !== 'object') return
      if (n.type === type) found.push(n)
      walk(n.children)
    }
    walk(await renderCubesPane($, { surface, props: { bodyColumns: 44 } }))
    return found
  }
  return { $, store, toasts, prompts, find }
}
// onPress fires the action without awaiting it, so let it finish.
const settle = () => new Promise(r => setTimeout(r, 50))
const keys = (b: any[]) => b.map(x => x.props.key)

test('pane: each status draws its own controls; Approve all only when more than one waits', async () => {
  const one = await fakeEnv([cube('c1', 'proposed'), cube('c2', 'failed'), cube('c3', 'rejected', {}), cube('c4', 'running'), cube('c5', 'done')]).find('Button')
  expect(keys(one)).toEqual(['row-c1', 'approve-c1', 'reject-c1', 'change-c1', 'ask-c1', 'row-c2', 'retry-c2', 'markDone-c2', 'delete-c2', 'row-c4', 'toggle-done'])
  expect(one.find(x => x.props.key === 'approve-c1').props.variant).toBe('primary')
  const two = await fakeEnv([cube('c1', 'proposed'), cube('c2', 'proposed')]).find('Button')
  const all = two.find(x => x.props.key === 'approve-all')
  expect([all.props.variant, all.props.hotkey]).toEqual(['primary', 'a'])
})

// dashboard.tsx keeps its snapshot in a module cache: seed it with dashSetCubes before pressing.
test('pane: pressing the row opens details; Approve, Retry and Approve all run the real commands', async () => {
  const env = fakeEnv([])
  await dashSetCubes(env.$, board([cube('c1', 'proposed', DESC), cube('c2', 'proposed'), cube('c3', 'failed'), cube('c4', 'proposed')]))
  const press = async (key: string) => {
    const b = await env.find('Button')
    b.find(x => x.props.key === key).onPress({})
    await settle()
  }
  await press('row-c1')
  expect(env.store.get('cubesPaneOpen')).toEqual(['c1'])
  expect((await env.find('Text')).some(t => JSON.stringify(t).includes('Code touched'))).toBe(true)
  await press('approve-c1')
  expect(env.toasts.at(-1)).toBe('Approved c1')
  await press('retry-c3')
  expect(env.toasts.at(-1)).toBe('Retrying c3')
  await press('approve-all')
  expect(env.toasts.at(-1)).toContain('c2, c4 sent to Claude')
})

test('pane: Change… opens a focused text field under the cube in place of its buttons; Cancel closes it', async () => {
  const env = fakeEnv([])
  await dashSetCubes(env.$, board([cube('c1', 'proposed')]))
  ;(await env.find('Button')).find(x => x.props.key === 'change-c1').onPress({})
  await settle()
  const [field] = await env.find('Input')
  expect([field.props.key, field.props.label, field.props.autoFocus]).toEqual(['input-c1', 'Change: ', true])
  expect(keys(await env.find('Button'))).toContain('cancel-c1')
  expect(keys(await env.find('Button'))).not.toContain('approve-c1')
  // Submitting is covered end to end in cubes-pane-actions.test.ts; here Cancel closes the field.
  ;(await env.find('Button')).find(x => x.props.key === 'cancel-c1').onPress({})
  await settle()
  expect(await env.find('Input')).toEqual([])
})

test('pane: the terminal draws a text bar; the editor and desktop get a native Progress', async () => {
  const env = fakeEnv([cube('c1', 'done'), cube('c2', 'proposed')])
  expect(await env.find('Progress', 'terminal')).toEqual([])
  const [p] = await env.find('Progress', 'vscode')
  expect([p.props.value, p.props.max, p.props.valueText]).toEqual([1, 2, '1 of 2 done'])
  const empty = fakeEnv([])
  expect((await empty.find('Text')).some(t => JSON.stringify(t).includes('No plan yet'))).toBe(true)
})

for (const surface of ['terminal', 'vscode'] as const) {
  test(`pane mounts on the ${surface}: the engine accepts the tree and its controls`, async ($, on) => {
    const { plan, start } = setup($, on)
    await start()
    await $.tool.call({ tool: INPUTS, inputs: [], asked: false })
    await $.tool.call({ tool: 'AskUserQuestion', ...APPROACH })
    await $.tool.call({ tool: PLAN, task: 'Two things', cubes: [1, 2].map(n => ({ ...DESC, id: `c${n}`, title: `thing ${n}`, action: 'Do one thing', flow: FLOW, doneWhen: 'ok', minutes: 3 })) })
    const ui = await $.ui.mount({ plugin: 'task-progress', component: 'Pane', requestId: 'tp-cubes', surface, props: { bodyColumns: 44 } } as any)
    const buttons = (await ui.findAll({ type: 'Button' })).map((x: any) => x.props.key)
    expect(buttons).toContain('approve-c1')
    expect(buttons).toContain('approve-all')
    // The editor gets a native Progress (drawn by the engine as its own label and bar); the terminal a text bar.
    const drawn = JSON.stringify(await ui.drawn())
    if (surface === 'terminal') expect(drawn).toContain('━')
    else expect(drawn).toContain('Cubes done')
    expect(drawn).toContain('0 of 2 done')
    await ui.unmount()
    void plan
  })
}
