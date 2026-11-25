// The Cubes pane: the plan as a short list you act on. The model (buildPaneModel) is pure;
// renderCubesPane draws it for the terminal and for the editor/desktop surfaces.
import type { Cube, CubeBoard, ReviewFinding, Snapshot, SnapshotAgent } from '../types/index'
import { actionsFor, isBlocking, runPaneAction, type CubeAction, type InputKind } from './cubes-pane-actions'
import { buildAgentRows, trunc } from './pane-agents'
import { buildUsageRows } from './pane-usage'

export const PANE_ID = 'tp-cubes'
export const PANE_TITLE = 'Cubes'
/** Body columns asked for while docked beside the transcript. */
export const PANE_COLUMNS = 44

/** One palette for both surfaces: mid-tone hues that read on light and dark backgrounds. */
export const TONES = {
  needs: '#D97706',
  running: '#3B82F6',
  review: '#8B5CF6',
  done: '#16A34A',
  fail: '#DC2626',
} as const
export type Tone = keyof typeof TONES

export type SectionKey = 'needs' | 'active' | 'next' | 'done'
const SECTION_TITLE: Record<SectionKey, string> = { needs: 'Needs you', active: 'In progress', next: 'Up next', done: 'Done' }

export type DetailSection = { title: string; items: { text: string; tone?: Tone; dim?: boolean }[]; numbered?: boolean }

export type PaneRow = {
  id: string
  title: string
  glyph: string
  tone?: Tone
  dim?: boolean
  /** Right-hand chip: minutes, a countdown, or a state word. */
  meta?: string
  metaTone?: Tone
  /** The dim line under the title: what it waits on, who works on it, or its summary. */
  sub?: string
  subTone?: Tone
  actions: CubeAction[]
  /** Actions show on the row itself (needs-you rows) or only once it is opened. */
  showActions: boolean
  open: boolean
  input?: InputKind
  details: DetailSection[]
}

export type PaneSection = { key: SectionKey; title: string; rows: PaneRow[]; collapsed: boolean; count: number }

export type PaneModel =
  | { kind: 'empty' }
  | {
      kind: 'board'
      task: string
      done: number
      total: number
      counts: string
      approveAll: number
      sections: PaneSection[]
      /** Running agents that no running cube row already shows (reviews, untagged steps). */
      agents: { id: string; name: string; tag?: string; time?: string; over?: boolean; detail?: string }[]
    }

const FINISHED = ['done', 'skipped', 'rejected']

/** Cubes still to be worked or approved: the pane opens by itself while any exist. */
export function hasUnfinished(board: CubeBoard | null | undefined): boolean {
  return !!board && board.cubes.some(c => !FINISHED.includes(c.status))
}

function sectionOf(c: Cube, board: CubeBoard): SectionKey {
  if (c.status === 'proposed' || c.status === 'failed' || isBlocking(board, c)) return 'needs'
  if (c.status === 'running' || c.status === 'reviewing' || c.status === 'revising') return 'active'
  if (c.status === 'approved' || c.status === 'queued') return 'next'
  return 'done'
}

const clock = (ms: number) => {
  const s = Math.floor(Math.abs(ms) / 1000)
  return `${ms < 0 ? '+' : ''}${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim()
const shortType = (t: string) => t.split(':').pop() || t || 'agent'
const blocking = (f: ReviewFinding) => f.severity === 'P0' || f.severity === 'P1'

function detailsOf(c: Cube, subIsSummary: boolean): DetailSection[] {
  const out: DetailSection[] = []
  const summary = oneLine(c.summary || c.details || '')
  if (summary && !subIsSummary) out.push({ title: 'Summary', items: [{ text: summary }] })
  if (c.problem?.length) out.push({ title: 'Problem', items: c.problem.map(text => ({ text })) })
  if (c.steps?.length) out.push({ title: 'Steps', items: c.steps.map(text => ({ text })), numbered: true })
  if (c.code?.length) out.push({ title: 'Code touched', items: c.code.map(x => ({ text: `${x.file} — ${x.change}` })) })
  if (c.doneWhen) out.push({ title: 'Done when', items: [{ text: c.doneWhen }] })
  const rv = c.review
  if (rv && (rv.verdict || rv.summary)) {
    const tone: Tone = rv.verdict === 'APPROVE' ? 'done' : rv.verdict === 'REQUEST_CHANGES' ? 'fail' : 'needs'
    const items: DetailSection['items'] = [{ text: [rv.verdict?.replace('_', ' ').toLowerCase(), oneLine(rv.summary ?? '')].filter(Boolean).join(' · '), tone }]
    for (const f of rv.findings ?? []) {
      const where = f.file ? ` ${f.file}${f.line ? `:${f.line}` : ''}` : ''
      items.push({ text: `${f.severity}${where} · ${oneLine(f.summary)}`, ...(blocking(f) ? { tone: 'fail' as const } : { dim: true }) })
    }
    out.push({ title: 'Review', items })
  }
  if (c.thread?.length) {
    out.push({ title: 'Questions', items: c.thread.slice(-6).map(m => ({ text: `${m.role === 'user' ? 'You' : 'Claude'}: ${oneLine(m.text)}`, dim: m.role === 'user' })) })
  }
  return out
}

function rowOf(c: Cube, board: CubeBoard, section: SectionKey, agents: SnapshotAgent[], now: number, openIds: string[], input: { id: string; kind: InputKind } | null): PaneRow {
  const open = openIds.includes(c.id)
  const unfinishedDeps = c.after.filter(a => !['done', 'skipped'].includes(board.cubes.find(x => x.id === a)?.status ?? 'done'))
  const rejectedDep = c.after.map(a => board.cubes.find(x => x.id === a)).find(d => d?.status === 'rejected')
  const agent = c.agentId ? agents.find(a => a.id === c.agentId) : undefined
  const reviewer = agents.find(a => a.status === 'running' && a.cube?.kind === 'review' && a.cube.id === c.id)
  const summary = oneLine(c.summary || c.details || '')
  const lastAnswer = c.thread?.length ? c.thread[c.thread.length - 1] : undefined
  let r: Omit<PaneRow, 'id' | 'title' | 'actions' | 'showActions' | 'open' | 'details'> & { subIsSummary?: boolean }
  switch (c.status) {
    case 'proposed':
      r = rejectedDep
        ? { glyph: '●', tone: 'needs', meta: `${c.minutes}m`, sub: `blocked: ${rejectedDep.id} was rejected (restore or delete it)`, subTone: 'fail' }
        : { glyph: '●', tone: 'needs', meta: `${c.minutes}m`, sub: summary || undefined, subIsSummary: !!summary }
      break
    case 'failed': {
      const n = (c.review?.findings ?? []).filter(blocking).length
      r = { glyph: '✗', tone: 'fail', meta: 'failed', metaTone: 'fail', sub: c.review ? `review asked for changes${n ? ` · ${n} P0/P1` : ''}` : 'its executor did not finish' }
      break
    }
    case 'rejected': {
      const held = board.cubes.filter(x => x.after.includes(c.id) && !['done', 'skipped', 'rejected', 'failed'].includes(x.status)).map(x => x.id)
      r = { glyph: '⊘', dim: section === 'done', meta: 'rejected', sub: held.length ? `holds back ${held.join(', ')}` : c.note ? `“${oneLine(c.note)}”` : undefined, subTone: held.length ? 'fail' : undefined }
      break
    }
    case 'running': {
      const left = agent?.budgetMin !== undefined ? (agent.startedAt + agent.budgetMin * 60000 - now) : undefined
      const warn = left !== undefined && agent?.budgetMin !== undefined && left < agent.budgetMin * 60000 * 0.2
      r = {
        glyph: '◐',
        tone: 'running',
        meta: left !== undefined ? clock(left) : `${c.minutes}m`,
        metaTone: left !== undefined && left < 0 ? 'fail' : warn ? 'needs' : undefined,
        sub: agent ? `${shortType(agent.type)}${agent.lastTool ? ` · ${oneLine(agent.lastTool)}` : ''}` : 'executor starting',
      }
      break
    }
    case 'reviewing':
      r = { glyph: '◑', tone: 'review', meta: 'review', metaTone: 'review', sub: reviewer ? `${shortType(reviewer.type)}${reviewer.lastTool ? ` · ${oneLine(reviewer.lastTool)}` : ''}` : 'built · waiting for the combined review' }
      break
    case 'revising':
      r = { glyph: '◌', meta: 'revising', sub: c.note ? `you asked: ${oneLine(c.note)}` : 'Claude is revising it' }
      break
    case 'approved':
      r = { glyph: '○', tone: 'running', meta: 'starting', sub: 'sent to Claude' }
      break
    case 'queued':
      r = { glyph: '◌', meta: `${c.minutes}m`, sub: unfinishedDeps.length ? `after ${unfinishedDeps.join(', ')}` : 'starting' }
      break
    case 'skipped':
      r = { glyph: '–', dim: true, meta: 'skipped' }
      break
    default: {
      const took = c.startedAt !== undefined && c.endedAt !== undefined ? c.endedAt - c.startedAt : undefined
      r = { glyph: '✓', tone: 'done', dim: true, meta: took !== undefined ? `${Math.max(1, Math.round(took / 60000))}m` : undefined }
    }
  }
  // A question waits on Claude, or Claude answered one that is not open yet.
  if (lastAnswer && !open && section !== 'done') {
    r.sub = lastAnswer.role === 'user' ? 'waiting for Claude’s answer' : 'Claude answered · open to read'
    r.subTone = lastAnswer.role === 'claude' ? 'needs' : undefined
    r.subIsSummary = false
  }
  const { subIsSummary, ...rest } = r
  return {
    id: c.id,
    title: c.title,
    ...rest,
    actions: actionsFor(c),
    showActions: section === 'needs' || open,
    open,
    ...(input?.id === c.id ? { input: input.kind } : {}),
    details: open ? detailsOf(c, !!subIsSummary) : [],
  }
}

/** The pane as data: header counts, cubes grouped by what they need, and stray running agents. */
export function buildPaneModel(
  board: CubeBoard | null | undefined,
  agents: SnapshotAgent[] = [],
  now = 0,
  openIds: string[] = [],
  input: { id: string; kind: InputKind } | null = null,
): PaneModel {
  if (!board || board.cubes.length === 0) return { kind: 'empty' }
  const live = board.cubes.filter(c => c.status !== 'rejected')
  const done = live.filter(c => c.status === 'done' || c.status === 'skipped').length
  const groups: Record<SectionKey, Cube[]> = { needs: [], active: [], next: [], done: [] }
  for (const c of board.cubes) groups[sectionOf(c, board)].push(c)
  const sections: PaneSection[] = (['needs', 'active', 'next', 'done'] as const)
    .filter(k => groups[k].length > 0)
    .map(k => {
      const collapsed = k === 'done' && !openIds.includes('_done')
      return {
        key: k,
        title: SECTION_TITLE[k],
        count: groups[k].length,
        collapsed,
        rows: collapsed ? [] : groups[k].map(c => rowOf(c, board, k, agents, now, openIds, input)),
      }
    })
  const counts = [`${done} of ${live.length} done`, groups.active.length ? `${groups.active.length} in progress` : '', groups.needs.length ? `${groups.needs.length} need${groups.needs.length === 1 ? 's' : ''} you` : '']
    .filter(Boolean)
    .join(' · ')
  const shownAgents = new Set(board.cubes.filter(c => c.status === 'running' && c.agentId).map(c => c.agentId!))
  const stray = buildAgentRows(agents.filter(a => !shownAgents.has(a.id) && !board.cubes.some(c => c.status === 'reviewing' && a.cube?.kind === 'review' && a.cube.id === c.id)), now)
    .filter(a => a.state === 'running')
    .map(a => ({ id: a.id, name: a.name, tag: a.tag, time: a.time, over: a.over, detail: a.detail }))
  return {
    kind: 'board',
    task: board.task,
    done,
    total: live.length,
    counts,
    approveAll: board.cubes.filter(c => c.status === 'proposed').length,
    sections,
    agents: stray,
  }
}

const ACTION_LABEL: Record<CubeAction, string> = {
  approve: 'Approve',
  reject: 'Reject',
  retry: 'Retry',
  restore: 'Restore',
  markDone: 'Mark done',
  delete: 'Delete',
  change: 'Change…',
  ask: 'Ask…',
}
const PRIMARY: readonly CubeAction[] = ['approve', 'retry']

/** Lists get a dot per item; a lone line and the review's verdict line (its first) do not. */
function bulleted(sec: DetailSection, j: number): boolean {
  if (sec.title === 'Review') return j > 0
  return sec.items.length > 1 || sec.title === 'Problem'
}

/** Draws the Pane from the stored snapshot. Reading state subscribes, so a board change redraws it. */
export async function renderCubesPane($: any, e: any, _doneMs = 3000) {
  const { Box, Text, Button, Input, Progress } = $.ui.resolve(e)
  const isTerm = (e?.surface ?? 'terminal') === 'terminal'
  const width = Math.max(32, Number(e?.props?.bodyColumns) || PANE_COLUMNS)
  const { value: snap } = (await $.state.get({ plugin: 'task-progress', key: 'snapshot' })) as { value: Snapshot | null }
  const { value: openValue } = await $.state.get({ plugin: 'task-progress', key: 'cubesPaneOpen' })
  const { value: input } = await $.state.get({ plugin: 'task-progress', key: 'cubesPaneInput' })
  await $.state.get({ plugin: 'task-progress', key: 'paneTick' }) // subscribe: the agent poll ticks it, so countdowns move
  const openIds: string[] = Array.isArray(openValue) ? openValue : []
  const now: number = await $.clock.now()
  const m = buildPaneModel(snap?.cubes, snap?.agents ?? [], now, openIds, input ?? null)
  const act = (a: Parameters<typeof runPaneAction>[1]) => () => void runPaneAction($, a)
  const color = (t?: Tone) => (t ? TONES[t] : undefined)

  if (m.kind === 'empty') {
    return (
      <Box flexDirection="column">
        <Text bold>No plan yet</Text>
        <Text dimColor wrap="wrap">When Claude plans a task in cubes, they show up here for you to approve.</Text>
        {usage()}
      </Box>
    )
  }

  function bar(done: number, total: number) {
    if (!isTerm) return <Progress key="progress" label="Cubes done" value={done} max={Math.max(1, total)} valueText={`${done} of ${total} done`} color={TONES.done} />
    const cells = Math.max(10, width - 2)
    const lit = total > 0 ? Math.round((done / total) * cells) : 0
    return (
      <Text>
        <Text color={TONES.done}>{'━'.repeat(lit)}</Text>
        <Text dimColor>{'━'.repeat(cells - lit)}</Text>
      </Text>
    )
  }

  function usage() {
    const u = snap?.usage
    if (!u || (!u.fiveHour && !u.weekly)) return null
    const tone = (p: number) => (p >= 90 ? TONES.fail : p >= 70 ? TONES.needs : undefined)
    if (!isTerm) {
      return (
        <Box flexDirection="column" marginTop={1}>
          <Text bold dimColor>Usage</Text>
          {u.fiveHour ? <Progress key="u5" label="5-hour limit" value={u.fiveHour.percent} max={100} valueText={`${Math.round(u.fiveHour.percent)}% of 5-hour limit`} color={tone(u.fiveHour.percent)} /> : null}
          {u.weekly ? <Progress key="u7" label="Weekly limit" value={u.weekly.percent} max={100} valueText={`${Math.round(u.weekly.percent)}% of weekly limit`} color={tone(u.weekly.percent)} /> : null}
        </Box>
      )
    }
    const rows = buildUsageRows(snap, now).filter(r => r.kind === 'limit')
    return (
      <Box flexDirection="column" marginTop={1}>
        {rows.map((r, i) => (
          <Text key={`u${i}`} color={r.color === 'red' ? TONES.fail : r.color === 'yellow' ? TONES.needs : undefined} dimColor={!r.color}>
            {r.text}
          </Text>
        ))}
      </Box>
    )
  }

  function row(r: PaneRow) {
    const meta = r.meta ?? ''
    const room = Math.max(8, width - 2 - r.id.length - 2 - (meta ? meta.length + 1 : 0))
    return (
      <Box key={`cube-${r.id}`} flexDirection="column" marginBottom={r.open ? 1 : 0}>
        <Box justifyContent="space-between">
          <Button key={`row-${r.id}`} plain onPress={act({ kind: 'toggleDetails', id: r.id })}>
            <Text color={color(r.tone)} dimColor={r.dim && !r.tone}>{r.glyph}</Text>
            {' '}
            <Text dimColor>{r.id}</Text>
            {'  '}
            <Text dimColor={r.dim} bold={r.open}>{trunc(r.title, room)}</Text>
          </Button>
          {meta ? <Text color={color(r.metaTone)} dimColor={!r.metaTone}>{meta}</Text> : null}
        </Box>
        {r.sub ? (
          <Box marginLeft={2}>
            <Text color={color(r.subTone)} dimColor={!r.subTone} wrap="wrap" maxLines={2}>
              {r.sub}
            </Text>
          </Box>
        ) : null}
        {r.open
          ? r.details.map((sec, k) => (
              // One blank line opens the details; the bold titles separate the sections after it.
              <Box key={`${r.id}-${sec.title}`} flexDirection="column" marginLeft={2} marginTop={k === 0 ? 1 : 0}>
                <Text bold dimColor>{sec.title}</Text>
                {sec.items.map((it, j) => (
                  <Text key={`${sec.title}-${j}`} color={color(it.tone)} dimColor={it.dim} wrap="wrap">
                    {sec.numbered ? `${j + 1}. ${it.text}` : bulleted(sec, j) ? `· ${it.text}` : it.text}
                  </Text>
                ))}
              </Box>
            ))
          : null}
        {r.input ? (
          <Box key={`in-${r.id}`} flexDirection="column" marginLeft={2} marginTop={1}>
            <Input
              key={`input-${r.id}`}
              label={r.input === 'change' ? 'Change: ' : 'Ask: '}
              placeholder={r.input === 'change' ? 'What should change?' : 'Your question about this cube'}
              submitLabel="send"
              autoFocus
              onSubmit={(text: string) => void runPaneAction($, { kind: 'submitInput', id: r.id, input: r.input!, text })}
            />
            <Button key={`cancel-${r.id}`} plain dimColor onPress={act({ kind: 'cancelInput' })}>
              Cancel
            </Button>
          </Box>
        ) : r.showActions && r.actions.length > 0 ? (
          <Box marginLeft={2} marginTop={r.open ? 1 : 0} flexWrap="wrap">
            {r.actions.map(a => (
              <Box key={`${a}-${r.id}-box`} marginRight={1}>
                <Button
                  key={`${a}-${r.id}`}
                  variant={PRIMARY.includes(a) ? 'primary' : undefined}
                  dimColor={a === 'delete' || a === 'markDone' ? true : undefined}
                  onPress={a === 'change' || a === 'ask' ? act({ kind: 'openInput', id: r.id, input: a }) : act({ kind: a, id: r.id })}
                >
                  {ACTION_LABEL[a]}
                </Button>
              </Box>
            ))}
          </Box>
        ) : null}
      </Box>
    )
  }

  return (
    <Box flexDirection="column">
      <Text bold wrap="truncate-end">{m.task}</Text>
      {bar(m.done, m.total)}
      <Text dimColor>{m.counts}</Text>
      {m.sections.map(sec => (
        <Box key={`sec-${sec.key}`} flexDirection="column" marginTop={1}>
          <Box justifyContent="space-between">
            <Text bold dimColor>{`${sec.title} · ${sec.count}`}</Text>
            {sec.key === 'needs' && m.approveAll > 1 ? (
              <Button key="approve-all" variant="primary" hotkey="a" onPress={act({ kind: 'approveAll' })}>
                {`Approve all (${m.approveAll})`}
              </Button>
            ) : sec.key === 'done' ? (
              <Button key="toggle-done" plain dimColor onPress={act({ kind: 'toggleDetails', id: '_done' })}>
                {sec.collapsed ? 'Show' : 'Hide'}
              </Button>
            ) : null}
          </Box>
          {sec.rows.map(row)}
        </Box>
      ))}
      {m.agents.length > 0 ? (
        <Box flexDirection="column" marginTop={1}>
          <Text bold dimColor>{`Agents · ${m.agents.length}`}</Text>
          {m.agents.map(a => (
            <Box key={`agent-${a.id}`} flexDirection="column">
              <Box justifyContent="space-between">
                <Text>
                  <Text color={TONES.running}>◐</Text> {a.name}
                  {a.tag ? <Text dimColor>{` · ${a.tag}`}</Text> : null}
                </Text>
                {a.time ? <Text color={a.over ? TONES.fail : undefined} dimColor={!a.over}>{a.time.replace(' left', '').replace(' over', '')}</Text> : null}
              </Box>
              {a.detail ? (
                <Box marginLeft={2}>
                  <Text dimColor wrap="truncate-end">{a.detail}</Text>
                </Box>
              ) : null}
            </Box>
          ))}
        </Box>
      ) : null}
      {usage()}
    </Box>
  )
}

/** Opens (or retitles) the pane without the keyboard. An unasked open may answer isPlaced false on a narrow terminal. */
export async function openCubesPane($: any): Promise<void> {
  try {
    await $.ui.open({ id: PANE_ID, title: PANE_TITLE, columns: PANE_COLUMNS })
  } catch {
    // no surface or a refused open: the pane is best effort
  }
}

const closedRef = { plugin: 'task-progress', key: 'cubesPaneClosed' } as const

/** ui.close for the pane: a person's close is remembered (survives /reload-plugins) until the next new plan. */
export async function onCubesPaneClose($: any, e: any, next: (e: any) => any) {
  if (e?.origin?.kind === 'person') await $.state.set(closedRef, true)
  return next(e)
}
