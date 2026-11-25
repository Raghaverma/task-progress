// The band in extreme motion: pure row builders. register.tsx gathers the state and draws the rows.
import type { Line, Span } from './anim-frames'
import { AURORA, along, confettiRain, decode, embers, equalizer, fireworks, flash, isDecoding, meter, mix, odometer, pulse, rainbow, rainbowText, shimmer, spin } from './fx'

export type BarCell = { ch: string; color: string }

const BLUE = '#0A84FF'
const ICE = '#7DD3FC'
const ORANGE = '#D97757'
const GREEN = '#34D399'
const MUTED = '#9CA3AF'
const UPCOMING = '#4B5160'

/** Cuts a line to `width` columns. */
export function clip(l: Line, width: number): Line {
  const out: Line = []
  let left = Math.max(0, width)
  for (const s of l) {
    if (left <= 0) break
    out.push(s.text.length <= left ? s : { ...s, text: s.text.slice(0, left) })
    left -= s.text.length
  }
  return out
}

/** The column where a fill position (in segment units) lands on a bar of `n` segments `w` wide. */
export function columnOf(pos: number, n: number, w: number): number {
  const seg = Math.max(0, Math.min(n - 1, Math.floor(pos)))
  const f = Math.max(0, Math.min(1, pos - seg))
  return Math.min(n * w + n - 2, seg * (w + 1) + Math.round(f * w))
}

/**
 * The bar's cells: the fill flows through an aurora (a rainbow once done), the head burns
 * white-hot with a glow behind it, and a faint scanline slides along the unlit part.
 */
export function auroraBar(n: number, w: number, pos: number, tick: number, isDone: boolean): BarCell[] {
  const cells: BarCell[] = []
  const head = isDone ? -1 : columnOf(pos, n, w) - 1
  let col = 0
  for (let i = 0; i < n; i++) {
    if (i > 0) {
      cells.push({ ch: ' ', color: '' })
      col++
    }
    const fill = Math.max(0, Math.min(1, pos - i))
    const lit = fill >= 1 ? w : Math.round(fill * w)
    for (let j = 0; j < w; j++, col++) {
      if (j < lit || isDone) {
        let color = isDone ? rainbow(col, tick * 2, 0.9, 0.62) : along(AURORA, col * 0.12 - tick * 0.25)
        if (col === head) color = pulse('#FFFFFF', ICE, tick, 6)
        else if (col === head - 1) color = mix(color, '#FFFFFF', 0.55)
        else if (col === head - 2) color = mix(color, '#FFFFFF', 0.25)
        cells.push({ ch: '━', color })
      } else {
        const scan = (col - Math.floor(tick * 0.8)) % 29 === 0
        cells.push({ ch: '━', color: scan ? '#6B7280' : UPCOMING })
      }
    }
  }
  return cells
}

export type BandInput = {
  task: string
  label: string
  step: number
  prevStep: number
  totalSteps: number
  startedAt: number
  lastStepAt: number
  isDone: boolean
  finishedAt: number
  /** `3/7 · ~2m left` style tail, without the step count (eta or `done in …`). */
  eta: string
  mood: 'working' | 'thinking' | 'waiting' | 'over' | 'done'
}

/** Row 1: a live equalizer, the title decoding in (then shimmering), the label, and a rolling step count. */
export function titleRow(p: BandInput, now: number, tick: number, width: number): Line {
  const energy = p.mood === 'waiting' ? 0.08 : p.mood === 'thinking' ? 0.45 : p.mood === 'over' ? 0.8 : 1
  const eqTick = p.mood === 'waiting' ? tick / 4 : tick
  const parts: Line = [...equalizer(eqTick, 5, energy, p.task.length), { text: ' ' }]
  if (p.isDone) {
    parts.push(...rainbowText('✓ ' + p.task, tick))
    parts.push({ text: '   ' }, ...shimmer(p.eta, tick, GREEN, '#FFFFFF', 16))
    return clip(parts, width)
  }
  const since = now - p.startedAt
  parts.push(...(isDecoding(p.task, since) ? decode(p.task, since, tick, BLUE) : shimmer(p.task, tick, BLUE, ICE, 30)).map(s => ({ ...s, bold: true })))
  if (p.label) parts.push({ text: ' · ', color: MUTED }, ...decode(p.label, now - p.lastStepAt, tick, MUTED))
  parts.push({ text: '   ' }, odometer(p.prevStep, p.step, now - p.lastStepAt, 450, MUTED), { text: `/${p.totalSteps}`, color: MUTED })
  if (p.eta) parts.push({ text: ' · ' + p.eta, color: p.mood === 'over' ? pulse('#F59E0B', '#F87171', tick, 8) : MUTED })
  return clip(parts, width)
}

/** The rows above the bar: embers off the head while working (with a burst on each finished step), fireworks once done. */
export function skyRows(p: BandInput, n: number, w: number, pos: number, now: number, tick: number): Line[] {
  const L = n * w + Math.max(0, n - 1)
  if (p.isDone) return fireworks(L, 3, now - p.finishedAt, p.task.length)
  const head = columnOf(pos, n, w)
  const unit = n / Math.max(1, p.totalSteps)
  const justStepped = p.step > p.prevStep && now - p.lastStepAt < 900
  const burstAt = justStepped ? columnOf((p.step - 0.5) * unit, n, w) : -1
  const energy = p.mood === 'waiting' ? 0.15 : p.mood === 'thinking' ? 0.5 : 1
  return [embers(L, head, tick, burstAt, justStepped ? now - p.lastStepAt : -1, energy)]
}

export type BandAgent = {
  id: string
  name: string
  tag: string
  startedAt: number
  budgetMs: number
  /** What it does now (last tool or brief), and when that last changed. */
  what: string
  whatSince: number
}

/** One agent row: a spinner, the name shimmering, its cube, a budget meter, a live countdown and its current tool decoding in. */
export function agentRow(a: BandAgent, i: number, now: number, tick: number, width: number): Line {
  const left = a.startedAt + a.budgetMs - now
  const used = a.budgetMs > 0 ? (now - a.startedAt) / a.budgetMs : 0
  const s = Math.floor(Math.abs(left) / 1000)
  const clock = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
  const time: Span =
    left < 0
      ? { text: `+${clock} over`, color: Math.floor(tick / 3) % 2 === 0 ? '#F87171' : '#7F1D1D', bold: true }
      : used >= 0.8
        ? { text: `${clock} left`, color: pulse('#F59E0B', '#FDE68A', tick, 6), bold: true }
        : { text: `${clock} left`, color: MUTED }
  const arriving = now - a.startedAt < 700
  const name = arriving ? decode(a.name, now - a.startedAt, tick, ORANGE) : shimmer(a.name, tick + i * 7, ORANGE, '#FDE68A', 20)
  const row: Line = [
    { text: spin('braille', tick, i * 3), color: along(AURORA, tick * 0.1 + i), bold: true },
    { text: ' ' },
    ...name.map(x => ({ ...x, bold: true })),
    { text: ` · ${a.tag} `, color: MUTED },
    ...meter(used, 8, tick),
    { text: ' ' },
    time,
  ]
  const room = width - row.reduce((k, x) => k + x.text.length, 0) - 2
  if (room > 3 && a.what) {
    const what = a.what.length > room ? a.what.slice(0, room - 1) + '…' : a.what
    row.push({ text: '  ' }, ...decode(what, now - a.whatSince, tick, MUTED).map(x => ({ ...x, dim: true })))
  }
  return clip(row, width)
}

/** The finish: a beating check, the crew in rainbow letters, and confetti falling under it. */
export function doneRows(crewCount: number, tick: number, width: number): Line[] {
  const beat = ['✓', '✔', '✓', '✓'][Math.floor(tick / 2) % 4]!
  const text = ` done!${crewCount > 0 ? ` · ${crewCount} agent${crewCount === 1 ? '' : 's'}` : ''}`
  return [clip([{ text: beat, color: flash(GREEN, '#FFFFFF', (tick % 8) * 60, 480), bold: true }, ...rainbowText(text, tick)], width), ...confettiRain(width, 1, tick, 0.2)]
}
