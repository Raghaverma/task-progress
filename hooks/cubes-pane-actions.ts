// Actions behind the Cubes pane controls: the same cube commands the old web dashboard sent.
import type { Cube, CubeBoard, DashboardCommand } from '../types/index'
import { command } from './dashboard'

/** A cube action a row can offer. `retry` and `restore` both approve again; they read differently. */
export type CubeAction = 'approve' | 'reject' | 'retry' | 'restore' | 'markDone' | 'delete' | 'change' | 'ask'
/** The text field a row can open: a change request or a question. */
export type InputKind = 'change' | 'ask'

export type PaneAction =
  | { kind: 'approve' | 'reject' | 'retry' | 'restore' | 'markDone' | 'delete'; id: string }
  | { kind: 'approveAll' }
  | { kind: 'toggleDetails'; id: string }
  | { kind: 'openInput'; id: string; input: InputKind }
  | { kind: 'cancelInput' }
  | { kind: 'submitInput'; id: string; input: InputKind; text: string }

const OPEN_KEY = { plugin: 'task-progress', key: 'cubesPaneOpen' } as const
const INPUT_KEY = { plugin: 'task-progress', key: 'cubesPaneInput' } as const
const CLOSED: readonly string[] = ['done', 'skipped', 'rejected', 'failed']

/** Flip one id in the open list (a cube's details, or a pane section such as `_done`). Pane state, not a cube command. */
export async function toggleDetails($: any, id: string): Promise<void> {
  const { value } = await $.state.get(OPEN_KEY)
  const cur: string[] = Array.isArray(value) ? value : []
  await $.state.set(OPEN_KEY, cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id])
}

/** True when a rejected cube still holds back a cube that is not closed. */
export function isBlocking(board: Pick<CubeBoard, 'cubes'>, c: Pick<Cube, 'id' | 'status'>): boolean {
  return c.status === 'rejected' && board.cubes.some(x => x.after.includes(c.id) && !CLOSED.includes(x.status))
}

/** What a cube's row offers, by status: every state has a way forward or out. */
export function actionsFor(c: Pick<Cube, 'status'>): CubeAction[] {
  switch (c.status) {
    case 'proposed':
      return ['approve', 'reject', 'change', 'ask']
    case 'failed':
      return ['retry', 'markDone', 'delete']
    case 'rejected':
      return ['restore', 'delete']
    case 'reviewing':
      return ['markDone', 'ask']
    case 'running':
    case 'approved':
    case 'queued':
    case 'revising':
      return ['ask']
    default:
      return []
  }
}

/** The command a button sends; null for pane-only actions. */
export function paneActionToCommand(a: PaneAction): DashboardCommand | null {
  switch (a.kind) {
    case 'approveAll':
      return { action: 'cube.approveAll' }
    case 'approve':
    case 'retry':
    case 'restore':
      return { action: 'cube.approve', id: a.id }
    case 'reject':
      return { action: 'cube.reject', id: a.id }
    case 'markDone':
      return { action: 'cube.markDone', id: a.id }
    case 'delete':
      return { action: 'cube.delete', id: a.id }
    case 'submitInput':
      return a.input === 'change' ? { action: 'cube.requestChange', id: a.id, note: a.text } : { action: 'cube.ask', id: a.id, text: a.text }
    default:
      return null
  }
}

/** The toast for a command that went through. */
export function successText(a: PaneAction, message: string): string {
  switch (a.kind) {
    case 'approveAll':
      return message || 'Approved all'
    case 'approve':
      return `Approved ${a.id}`
    case 'reject':
      return `Rejected ${a.id}`
    case 'retry':
      return `Retrying ${a.id}`
    case 'restore':
      return `Restored and approved ${a.id}`
    case 'markDone':
      return `Marked ${a.id} done`
    case 'delete':
      return `Deleted ${a.id}`
    case 'submitInput':
      return a.input === 'change' ? `Change request for ${a.id} sent to Claude` : `Question about ${a.id} sent to Claude`
    default:
      return message
  }
}

/** Run one pane action and toast the result. Never throws. */
export async function runPaneAction($: any, a: PaneAction): Promise<void> {
  try {
    if (a.kind === 'toggleDetails') return await toggleDetails($, a.id)
    if (a.kind === 'openInput') return void (await $.state.set(INPUT_KEY, { id: a.id, kind: a.input }))
    if (a.kind === 'cancelInput') return void (await $.state.set(INPUT_KEY, null))
  } catch {
    return // pane state is best effort
  }
  if (a.kind === 'submitInput' && !a.text.trim()) return
  let text: string
  try {
    const r = await command($, paneActionToCommand(a)!)
    text = r.ok ? successText(a, String(r.message ?? '')) : String(r.message ?? 'Failed')
    if (r.ok && a.kind === 'submitInput') {
      await $.state.set(INPUT_KEY, null)
      // The answer lands in the cube's thread: open its details so it shows there.
      const { value } = await $.state.get(OPEN_KEY)
      const cur: string[] = Array.isArray(value) ? value : []
      if (!cur.includes(a.id)) await $.state.set(OPEN_KEY, [...cur, a.id])
    }
  } catch (e: any) {
    text = String(e?.message ?? e ?? 'Failed')
  }
  try {
    await $.ui.toast(text)
  } catch {
    // nothing more to do
  }
}
