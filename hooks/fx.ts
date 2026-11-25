// Effects for the band and panes. Pure and deterministic: time comes in as arguments (a frame
// `tick` from the shared ticker, or milliseconds since an event), never from a clock. Every row
// an effect returns is exactly the width it was asked for, in single-width characters only.
import type { Line, Span } from './anim-frames'

/** How much moves: everything, the original set, or nothing (static frames). */
export type Motion = 'extreme' | 'calm' | 'off'
export const MOTIONS: readonly Motion[] = ['extreme', 'calm', 'off']
export function parseMotion(v: unknown): Motion | null {
  const s = String(v ?? '').trim().toLowerCase()
  return (MOTIONS as readonly string[]).includes(s) ? (s as Motion) : null
}

// ---- colour ----
const clamp01 = (n: number) => Math.max(0, Math.min(1, n))
function rgb(h: string): [number, number, number] {
  const x = h.replace('#', '')
  return [0, 2, 4].map(i => parseInt(x.slice(i, i + 2), 16) || 0) as [number, number, number]
}
const hex = (r: number, g: number, b: number) => '#' + [r, g, b].map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('').toUpperCase()

/** `a` blended toward `b` by t (0..1). */
export function mix(a: string, b: string, t: number): string {
  const [ar, ag, ab] = rgb(a)
  const [br, bg, bb] = rgb(b)
  const k = clamp01(t)
  return hex(ar + (br - ar) * k, ag + (bg - ag) * k, ab + (bb - ab) * k)
}

/** HSL (h in degrees, s and l 0..1) as hex. */
export function hsl(h: number, s: number, l: number): string {
  const hh = (((h % 360) + 360) % 360) / 360
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const f = (t: number) => {
    let x = t
    if (x < 0) x += 1
    if (x > 1) x -= 1
    if (x < 1 / 6) return p + (q - p) * 6 * x
    if (x < 1 / 2) return q
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6
    return p
  }
  return hex(f(hh + 1 / 3) * 255, f(hh) * 255, f(hh - 1 / 3) * 255)
}

/** 0..1 breathing between two colours, one full breath per `period` ticks. */
export function pulse(a: string, b: string, tick: number, period = 12): string {
  return mix(a, b, (1 - Math.cos((tick / period) * Math.PI * 2)) / 2)
}

/** A colour that fades from `hot` back to `base` over `durMs` after an event. */
export function flash(base: string, hot: string, sinceMs: number, durMs: number): string {
  if (sinceMs < 0 || sinceMs >= durMs) return base
  return mix(hot, base, easeOut(sinceMs / durMs))
}

export const easeOut = (t: number) => 1 - Math.pow(1 - clamp01(t), 3)
export const easeOutBack = (t: number) => {
  const x = clamp01(t)
  const c = 1.70158
  return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2)
}

/** Deterministic noise in [0, 1) from up to three integers. */
export function rnd(a: number, b = 0, c = 0): number {
  let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(c | 0, 2147483647)) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

// ---- palettes ----
export const AURORA = ['#22D3EE', '#3B82F6', '#6366F1', '#8B5CF6', '#A855F7', '#3B82F6']
export const EMBER = ['#FFF7D6', '#FDE68A', '#FBBF24', '#F97316', '#D97757', '#8F5E45']
export const CONFETTI = ['#F87171', '#FBBF24', '#34D399', '#60A5FA', '#A78BFA', '#F472B6', '#22D3EE']

/** A colour from a looping palette at position x (fractional positions blend). */
export function along(palette: readonly string[], x: number): string {
  const n = palette.length
  const p = ((x % n) + n) % n
  const i = Math.floor(p)
  return mix(palette[i]!, palette[(i + 1) % n]!, p - i)
}

/** The rainbow at cell `i`, flowing with the tick. */
export const rainbow = (i: number, tick: number, sat = 0.85, light = 0.62) => hsl(i * 18 + tick * 14, sat, light)

// ---- per-character text effects (each returns one Span per character, same length as the text) ----

/** A bright band sweeping left to right across `text` every `period` ticks. */
export function shimmer(text: string, tick: number, base: string, hot = '#FFFFFF', period = 24, width = 3): Span[] {
  const n = text.length
  const head = ((tick % period) / period) * (n + width * 2) - width
  return [...text].map((ch, i) => ({ text: ch, color: mix(base, hot, clamp01(1 - Math.abs(i - head) / width)) }))
}

/** Each character on its own hue, the hues flowing with the tick. */
export function rainbowText(text: string, tick: number, bold = true): Span[] {
  return [...text].map((ch, i) => ({ text: ch, color: rainbow(i, tick), bold }))
}

const GLITCH = '!<>-_\\/[]{}=+*^?#%&$@'
/** Text that decodes in from noise: a scramble front runs ahead of the revealed part (~22 ms a character). */
export function decode(text: string, sinceMs: number, tick: number, color?: string, scrambleColor = '#A5B4FC'): Span[] {
  const msPer = 22
  const shown = sinceMs < 0 ? 0 : Math.floor(sinceMs / msPer)
  if (shown >= text.length + 4) return [{ text, color }]
  const out: Span[] = []
  for (let i = 0; i < text.length; i++) {
    if (i < shown) out.push({ text: text[i]!, color })
    else if (i < shown + 4 && text[i] !== ' ') out.push({ text: GLITCH[Math.floor(rnd(i, tick) * GLITCH.length)]!, color: scrambleColor })
    else out.push({ text: ' ', color })
  }
  return out
}

/** True while `decode` still has work to do. */
export const isDecoding = (text: string, sinceMs: number) => sinceMs >= 0 && Math.floor(sinceMs / 22) < text.length + 4

/** A whole number that rolls from `from` to `to` over `durMs`; the digits glow while they move. */
export function odometer(from: number, to: number, sinceMs: number, durMs = 450, color?: string, glow = '#FFFFFF'): Span {
  if (sinceMs < 0 || sinceMs >= durMs || from === to) return { text: String(to), color }
  const t = easeOut(sinceMs / durMs)
  const v = Math.round(from + (to - from) * t)
  return { text: String(v).padStart(String(to).length), color: mix(glow, color ?? glow, t), bold: true }
}

// ---- glyph cycles ----
export const SPINNERS = {
  braille: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'],
  dots: ['⣾', '⣽', '⣻', '⢿', '⡿', '⣟', '⣯', '⣷'],
  moon: ['◐', '◓', '◑', '◒'],
  arc: ['◜', '◠', '◝', '◞', '◡', '◟'],
  quarter: ['◴', '◷', '◶', '◵'],
  orbit: ['∙', '∘', '○', '◎', '●', '◎', '○', '∘'],
  breathe: ['●', '●', '◉', '◎', '◉', '●'],
  star: ['✦', '✧', '⋆', '✧'],
} as const
export type SpinnerKind = keyof typeof SPINNERS
export function spin(kind: SpinnerKind, tick: number, seed = 0, every = 1): string {
  const set = SPINNERS[kind]
  return set[(((Math.floor(tick / every) + seed) % set.length) + set.length) % set.length]!
}

/** A small live equalizer: `n` bars that move like audio levels. `energy` 0 (flat) to 1 (busy). */
export function equalizer(tick: number, n = 5, energy = 1, seed = 0): Span[] {
  const levels = '▁▂▃▄▅▆▇'
  return Array.from({ length: n }, (_, i) => {
    const w = Math.sin(tick * (0.35 + i * 0.11) + i * 1.7 + seed) * 0.5 + Math.sin(tick * (0.9 + i * 0.07) + seed * 2) * 0.35
    const h = clamp01(0.15 + energy * (0.45 + w * 0.55))
    const k = Math.min(levels.length - 1, Math.floor(h * levels.length))
    return { text: levels[k]!, color: along(AURORA, i * 0.8 + tick * 0.05) }
  })
}

/** A budget meter: cells fill as time is used, green to amber to red; past the budget it blinks red. */
export function meter(used: number, cells: number, tick: number): Span[] {
  const n = Math.max(1, Math.floor(cells))
  if (used >= 1) {
    const on = Math.floor(tick / 3) % 2 === 0
    return Array.from({ length: n }, () => ({ text: '▰', color: on ? '#F87171' : '#7F1D1D', bold: on }))
  }
  const lit = Math.round(clamp01(used) * n)
  const tone = used < 0.6 ? mix('#34D399', '#FBBF24', used / 0.6) : mix('#FBBF24', '#F87171', (used - 0.6) / 0.4)
  return Array.from({ length: n }, (_, i) => {
    if (i < lit) return { text: '▰', color: i === lit - 1 ? pulse(tone, '#FFFFFF', tick, 8) : tone }
    return { text: '▱', dim: true }
  })
}

// ---- rows of particles (each exactly `width` columns) ----

function rowOf(width: number, cells: Map<number, Span>): Line {
  const out: Line = []
  let gap = ''
  for (let c = 0; c < width; c++) {
    const s = cells.get(c)
    if (!s) {
      gap += ' '
      continue
    }
    if (gap) out.push({ text: gap })
    gap = ''
    out.push(s)
  }
  if (gap) out.push({ text: gap })
  return out
}

/**
 * Embers rising off the bar's head at column `head`: they drift back over the filled part and
 * fade from white-hot to ash. A step that just completed (`burstMs` since, under 900 ms) also
 * throws a ring of sparks out of `burstAt` in both directions.
 */
export function embers(width: number, head: number, tick: number, burstAt = -1, burstMs = -1, energy = 1): Line {
  const cells = new Map<number, Span>()
  const marks = ['✦', '*', '+', '·', '˙', '.']
  const count = Math.round(3 + energy * 5)
  for (let k = 0; k < count; k++) {
    const life = 14 + Math.floor(rnd(k, 7) * 10)
    const age = (tick + Math.floor(rnd(k, 3) * life)) % life
    const drift = Math.floor(age * (0.6 + rnd(k, 5) * 0.9))
    const col = head - drift + Math.floor(rnd(k, Math.floor((tick + k * 5) / life)) * 3) - 1
    if (col < 0 || col >= width) continue
    const t = age / life
    if (rnd(k, tick) < 0.12) continue // flicker
    cells.set(col, { text: marks[Math.min(marks.length - 1, Math.floor(t * marks.length))]!, color: along(EMBER, t * (EMBER.length - 1)) })
  }
  if (burstAt >= 0 && burstMs >= 0 && burstMs < 900) {
    const t = burstMs / 900
    for (const v of [1, 2, 3.5, 5, 7]) {
      const r = Math.round(v * 6 * easeOut(t))
      for (const dir of [-1, 1]) {
        const c = burstAt + dir * r
        if (c < 0 || c >= width) continue
        const ch = t < 0.3 ? '✦' : t < 0.6 ? '*' : t < 0.85 ? '·' : '˙'
        cells.set(c, { text: ch, color: mix('#FFFFFF', along(CONFETTI, v + dir), t), bold: t < 0.4 })
      }
    }
  }
  return rowOf(width, cells)
}

/** Falling confetti over `rows` rows. */
export function confettiRain(width: number, rows: number, tick: number, density = 0.12): Line[] {
  const marks = ['✦', '✧', '*', '·', '˚', '⋆', '+', '°']
  const grids = Array.from({ length: rows }, () => new Map<number, Span>())
  for (let c = 0; c < width; c++) {
    if (rnd(c, 11) > density * 4) continue
    const speed = 1 + Math.floor(rnd(c, 13) * 3)
    const span = rows + 3 + Math.floor(rnd(c, 17) * 4)
    const y = (Math.floor(tick / speed) + Math.floor(rnd(c, 19) * span)) % span
    if (y >= rows) continue
    const sway = Math.round(Math.sin((tick + c) * 0.4)) // drifts a column either way as it falls
    const col = Math.max(0, Math.min(width - 1, c + sway))
    grids[y]!.set(col, { text: marks[(c + Math.floor(tick / 2)) % marks.length]!, color: CONFETTI[(c + y) % CONFETTI.length], bold: true })
  }
  return grids.map(g => rowOf(width, g))
}

/**
 * Fireworks over `rows` rows (3 is best): rockets launch from the bottom row on a schedule, climb,
 * burst into a ring of sparks at the top and fall away. `sinceMs` is the time since the show began.
 */
export function fireworks(width: number, rows: number, sinceMs: number, seed = 0): Line[] {
  const grids = Array.from({ length: rows }, () => new Map<number, Span>())
  const put = (r: number, c: number, s: Span) => {
    if (r >= 0 && r < rows && c >= 0 && c < width) grids[r]!.set(c, s)
  }
  const every = 420
  const rocketCount = Math.floor(sinceMs / every) + 1
  for (let k = Math.max(0, rocketCount - 6); k < rocketCount; k++) {
    const t = sinceMs - k * every
    if (t < 0) continue
    const x = 2 + Math.floor(rnd(k, seed, 1) * Math.max(1, width - 4))
    const hue = Math.floor(rnd(k, seed, 2) * 360)
    const climb = 120 * rows
    if (t < climb) {
      const r = rows - 1 - Math.floor((t / climb) * rows)
      put(r, x, { text: '|', color: '#FDE68A' })
      put(r + 1, x, { text: '˙', color: '#F97316' })
      continue
    }
    const b = t - climb
    if (b > 1300) continue
    const p = b / 1300
    const radius = Math.round(1 + easeOut(p) * 7)
    const col = mix(hsl(hue, 0.95, 0.7), '#3F3F46', Math.max(0, p - 0.45) * 1.8)
    const ch = p < 0.25 ? '✦' : p < 0.5 ? '*' : p < 0.75 ? '+' : '·'
    put(0, x, { text: p < 0.2 ? '✺' : ch, color: p < 0.2 ? '#FFFFFF' : col, bold: p < 0.5 })
    for (const dir of [-1, 1]) {
      put(0, x + dir * radius, { text: ch, color: col, bold: p < 0.5 })
      put(1, x + dir * Math.round(radius * 0.7), { text: p < 0.5 ? '*' : '·', color: col })
      put(Math.min(rows - 1, 1 + Math.floor(p * rows)), x + dir * Math.round(radius * 0.4), { text: '·', color: col })
    }
  }
  return grids.map(g => rowOf(width, g))
}

/** A parallax starfield: far stars drift slowly, near ones faster, and a shooting star crosses now and then. */
export function starfieldPlus(width: number, tick: number, row = 0): Line {
  const cells = new Map<number, Span>()
  for (let c = 0; c < width; c++) {
    const far = (c + Math.floor(tick / 6) + row * 7) % width
    if (rnd(far, 31, row) < 0.07) cells.set(c, { text: rnd(far, 37) < 0.5 ? '·' : '˙', color: '#6B7280', dim: true })
    const near = (c + Math.floor(tick / 2) + row * 13) % width
    if (rnd(near, 41, row) < 0.035) cells.set(c, { text: spin('star', tick, near), color: pulse('#8F5E45', '#FDE68A', tick + near, 10) })
  }
  // One shooting star every ~5 s on this row, streaking right to left with a fading tail.
  const period = 40 + row * 9
  const at = (tick + row * 17) % period
  if (at < 14) {
    const head = width - 1 - Math.floor((at / 14) * (width + 6))
    for (let k = 0; k < 6; k++) {
      const c = head + k
      if (c >= 0 && c < width) cells.set(c, { text: k === 0 ? '✦' : k < 3 ? '━' : '─', color: mix('#FFFFFF', '#3B82F6', k / 6), bold: k === 0 })
    }
  }
  return rowOf(width, cells)
}

/** The width of a line in columns. */
export const lineWidth = (l: Line) => l.reduce((n, s) => n + s.text.length, 0)
