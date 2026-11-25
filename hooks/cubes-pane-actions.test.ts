import { expect, test } from 'claude-code/testing'
import { actionsFor, isBlocking, paneActionToCommand, runPaneAction, successText, toggleDetails } from './cubes-pane-actions'
import { dashSetCubes } from './dashboard'

test('every status has a way forward or out', () => {
  expect(actionsFor({ status: 'proposed' })).toEqual(['approve', 'reject', 'change', 'ask'])
  expect(actionsFor({ status: 'failed' })).toEqual(['retry', 'markDone', 'delete'])
  expect(actionsFor({ status: 'rejected' })).toEqual(['restore', 'delete'])
  expect(actionsFor({ status: 'reviewing' })).toEqual(['markDone', 'ask'])
  for (const status of ['running', 'approved', 'queued', 'revising'] as const) expect(actionsFor({ status })).toEqual(['ask'])
  for (const status of ['done', 'skipped'] as const) expect(actionsFor({ status })).toEqual([])
})

test('pane actions map onto the cube commands', () => {
  expect(paneActionToCommand({ kind: 'approve', id: 'c2' })).toEqual({ action: 'cube.approve', id: 'c2' })
  expect(paneActionToCommand({ kind: 'retry', id: 'c2' })).toEqual({ action: 'cube.approve', id: 'c2' })
  expect(paneActionToCommand({ kind: 'restore', id: 'c2' })).toEqual({ action: 'cube.approve', id: 'c2' })
  expect(paneActionToCommand({ kind: 'reject', id: 'c2' })).toEqual({ action: 'cube.reject', id: 'c2' })
  expect(paneActionToCommand({ kind: 'markDone', id: 'c2' })).toEqual({ action: 'cube.markDone', id: 'c2' })
  expect(paneActionToCommand({ kind: 'delete', id: 'c2' })).toEqual({ action: 'cube.delete', id: 'c2' })
  expect(paneActionToCommand({ kind: 'approveAll' })).toEqual({ action: 'cube.approveAll' })
  expect(paneActionToCommand({ kind: 'submitInput', id: 'c2', input: 'change', text: 'smaller' })).toEqual({ action: 'cube.requestChange', id: 'c2', note: 'smaller' })
  expect(paneActionToCommand({ kind: 'submitInput', id: 'c2', input: 'ask', text: 'why?' })).toEqual({ action: 'cube.ask', id: 'c2', text: 'why?' })
  expect(paneActionToCommand({ kind: 'toggleDetails', id: 'c2' })).toBeNull()
  expect(successText({ kind: 'retry', id: 'c6' }, '')).toBe('Retrying c6')
})

test('a rejected cube is blocking while an open cube still depends on it', () => {
  const b = (dep: string) => ({ cubes: [{ id: 'c1', status: 'rejected', after: [] }, { id: 'c2', status: dep, after: ['c1'] }] }) as any
  expect(isBlocking(b('proposed'), { id: 'c1', status: 'rejected' })).toBe(true)
  expect(isBlocking(b('done'), { id: 'c1', status: 'rejected' })).toBe(false)
  expect(isBlocking(b('proposed'), { id: 'c2', status: 'proposed' })).toBe(false)
})

function fake(store: Map<string, any>, toasts: string[], prompts: string[]) {
  return {
    session: { id: async () => 's1' },
    state: {
      get: async (r: any) => ({ value: store.get(r.key) ?? null }),
      set: async (r: any, v: any) => void store.set(r.key, v),
    },
    clock: { now: async () => 1, after: () => ({ cancel() {} }), every: () => ({ cancel() {} }) },
    prompt: { submit: async ({ text }: any) => void prompts.push(text) },
    ui: { toast: (t: string) => void toasts.push(t), log() {} },
  } as any
}
const cube = (id: string, status: string, after: string[] = []) => ({ id, title: id, action: 'a', flow: [], after, doneWhen: 'd', minutes: 1, status, version: 1 })
const board = (cubes: any[]) => ({ task: 't', gate: true, cubes, lanes: [] }) as any

test('runPaneAction runs the real commands and toasts what happened; it never throws', async () => {
  const store = new Map<string, any>()
  const toasts: string[] = []
  const prompts: string[] = []
  const $ = fake(store, toasts, prompts)
  await dashSetCubes($, board([cube('c1', 'proposed'), cube('c2', 'proposed', ['c1']), cube('c3', 'failed'), cube('c4', 'rejected'), cube('c5', 'reviewing')]))
  await runPaneAction($, { kind: 'approve', id: 'c1' })
  expect(toasts.at(-1)).toBe('Approved c1')
  await runPaneAction($, { kind: 'retry', id: 'c3' })
  expect(toasts.at(-1)).toBe('Retrying c3')
  await runPaneAction($, { kind: 'restore', id: 'c4' })
  expect(toasts.at(-1)).toBe('Restored and approved c4')
  await runPaneAction($, { kind: 'markDone', id: 'c5' })
  expect(toasts.at(-1)).toBe('Marked c5 done')
  await runPaneAction($, { kind: 'reject', id: 'c9' })
  expect(toasts.at(-1)).toContain('c9')
  await runPaneAction($, { kind: 'approveAll' })
  expect(toasts.at(-1)).toContain('after c1')
  await runPaneAction({ ui: { toast() { throw new Error('x') } } } as any, { kind: 'approveAll' })
})

test('the text field: open, cancel, and submit a change request or a question', async () => {
  const store = new Map<string, any>()
  const toasts: string[] = []
  const prompts: string[] = []
  const $ = fake(store, toasts, prompts)
  await dashSetCubes($, board([cube('c1', 'proposed'), cube('c2', 'proposed')]))
  await runPaneAction($, { kind: 'openInput', id: 'c1', input: 'change' })
  expect(store.get('cubesPaneInput')).toEqual({ id: 'c1', kind: 'change' })
  await runPaneAction($, { kind: 'cancelInput' })
  expect(store.get('cubesPaneInput')).toBeNull()
  // Blank text sends nothing.
  await runPaneAction($, { kind: 'submitInput', id: 'c1', input: 'change', text: '   ' })
  expect(prompts.length).toBe(0)
  await runPaneAction($, { kind: 'openInput', id: 'c1', input: 'change' })
  await runPaneAction($, { kind: 'submitInput', id: 'c1', input: 'change', text: 'split it in two' })
  expect(toasts.at(-1)).toBe('Change request for c1 sent to Claude')
  expect(prompts.at(-1)).toContain('split it in two')
  expect(store.get('cubesPaneInput')).toBeNull()
  await runPaneAction($, { kind: 'submitInput', id: 'c2', input: 'ask', text: 'Why this order?' })
  expect(toasts.at(-1)).toBe('Question about c2 sent to Claude')
  expect(prompts.at(-1)).toContain('[cube question c2')
  // The answer lands in the thread, so the cube's details open.
  expect(store.get('cubesPaneOpen')).toEqual(['c1', 'c2'])
})

test('toggleDetails adds then removes the id', async () => {
  const store = new Map<string, any>()
  const $ = fake(store, [], [])
  await toggleDetails($, 'c1')
  await runPaneAction($, { kind: 'toggleDetails', id: '_done' })
  expect(store.get('cubesPaneOpen')).toEqual(['c1', '_done'])
  await toggleDetails($, 'c1')
  expect(store.get('cubesPaneOpen')).toEqual(['_done'])
})
