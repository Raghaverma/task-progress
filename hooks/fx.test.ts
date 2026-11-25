import { expect, test } from 'claude-code/testing'

import { agentRow, auroraBar, clip, columnOf, doneRows, skyRows, titleRow, type BandInput } from './band-fx'
import { extremePaneFrame } from './agents-pane'
import { confettiRain, decode, embers, equalizer, fireworks, flash, hsl, isDecoding, lineWidth, meter, mix, odometer, parseMotion, pulse, rainbowText, shimmer, spin, starfieldPlus } from './fx'
import { glyphFx } from './cubes-pane'

const text = (l: { text: string }[]) => l.map(s => s.text).join('')
// Every effect draws in single-width characters only: no emoji, no wide CJK, no astral-plane glyphs.
const wide = /[\u{1100}-\u{115F}\u{2E80}-\u{A4CF}\u{AC00}-\u{D7A3}\u{F900}-\u{FAFF}\u{FE30}-\u{FE4F}\u{FF00}-\u{FF60}\u{FFE0}-\u{FFE6}\u{1F000}-\u{1FFFF}]/u
const narrow = (s: string) => !wide.test(s) && [...s].length === s.length

test('colour helpers', () => {
  expect(mix('#000000', '#FFFFFF', 0.5)).toBe('#808080')
  expect(mix('#102030', '#FFFFFF', 0)).toBe('#102030')
  expect(hsl(0, 1, 0.5)).toBe('#FF0000')
  expect(hsl(120, 1, 0.5)).toBe('#00FF00')
  expect(pulse('#000000', '#FFFFFF', 0)).toBe('#000000')
  expect(pulse('#000000', '#FFFFFF', 6, 12)).toBe('#FFFFFF')
  expect(flash('#000000', '#FFFFFF', 0, 100)).toBe('#FFFFFF')
  expect(flash('#000000', '#FFFFFF', 100, 100)).toBe('#000000')
  expect(parseMotion(' Extreme ')).toBe('extreme')
  expect(parseMotion('wild')).toBeNull()
})

test('text effects keep the text length and settle on the real text', () => {
  const t = 'Fix the login bug'
  for (let ms = 0; ms < 800; ms += 37) expect(text(decode(t, ms, ms)).length).toBe(t.length)
  expect(text(decode(t, 2000, 0))).toBe(t)
  expect(isDecoding(t, 0)).toBe(true)
  expect(isDecoding(t, 2000)).toBe(false)
  expect(text(decode(t, 0, 3))).not.toBe(t) // it starts as noise
  for (let k = 0; k < 40; k++) expect(text(shimmer(t, k, '#3B82F6'))).toBe(t)
  expect(new Set(Array.from({ length: 24 }, (_, k) => shimmer(t, k, '#3B82F6')[5]!.color)).size).toBeGreaterThan(3)
  expect(text(rainbowText(t, 4))).toBe(t)
  expect(odometer(2, 3, 1000).text).toBe('3')
  expect(odometer(2, 9, 100).text).not.toBe('9') // still rolling
})

test('glyph cycles and meters', () => {
  expect(new Set(Array.from({ length: 10 }, (_, k) => spin('braille', k))).size).toBe(10)
  expect(spin('moon', 0)).toBe(spin('moon', 4))
  expect(text(equalizer(0, 5)).length).toBe(5)
  expect(text(equalizer(0, 5))).not.toBe(text(equalizer(7, 5)))
  expect(text(meter(0.5, 8, 0))).toBe('▰▰▰▰▱▱▱▱')
  expect(text(meter(2, 8, 0))).toBe('▰▰▰▰▰▰▰▰')
  expect(meter(2, 8, 0)[0]!.color).not.toBe(meter(2, 8, 3)[0]!.color) // past the budget it blinks
})

test('every particle row is exactly its width, in single-width characters, at every tick', () => {
  for (const width of [12, 44, 83]) {
    for (let tick = 0; tick < 160; tick += 7) {
      const rows = [
        embers(width, Math.floor(width / 2), tick),
        embers(width, width - 1, tick, 4, tick * 6),
        ...confettiRain(width, 3, tick),
        ...fireworks(width, 3, tick * 60),
        starfieldPlus(width, tick, 0),
        starfieldPlus(width, tick, 1),
      ]
      for (const r of rows) {
        expect(lineWidth(r)).toBe(width)
        expect(narrow(text(r))).toBe(true)
      }
    }
  }
})

test('a finished step throws a burst of sparks; fireworks climb, then burst', () => {
  const calm = text(embers(60, 30, 5, -1, -1, 0))
  const burst = text(embers(60, 30, 5, 20, 120, 0))
  expect(burst.replace(/ /g, '').length).toBeGreaterThan(calm.replace(/ /g, '').length)
  expect(text(fireworks(40, 3, 50).at(-1)!)).toContain('|') // a rocket on the way up
  expect(fireworks(40, 3, 600).map(text).join('')).toMatch(/[✺✦*]/) // then the burst
})

const input = (over: Partial<BandInput> = {}): BandInput => ({
  task: 'Fix the login bug', label: 'running tests', step: 2, prevStep: 1, totalSteps: 7, startedAt: 0, lastStepAt: 10_000,
  isDone: false, finishedAt: 0, eta: '~2m left', mood: 'working', ...over,
})

test('band rows: title, sky and bar stay within the band and line up with the bar', () => {
  const n = 7
  const w = 5
  const L = n * w + n - 1
  for (let tick = 0; tick < 120; tick += 5) {
    const now = 10_000 + tick * 120
    const p = input()
    expect(lineWidth(titleRow(p, now, tick, 80))).toBeLessThanOrEqual(80)
    for (const r of skyRows(p, n, w, 2.4, now, tick)) expect(lineWidth(r)).toBe(L)
    expect(auroraBar(n, w, 2.4, tick, false).length).toBe(L)
    expect(auroraBar(n, w, 7, tick, true).length).toBe(L)
  }
  // The title decodes in when a task starts, then reads plainly with the step count and eta.
  expect(text(titleRow(input(), 0, 0, 100))).not.toContain('Fix the login bug')
  const later = text(titleRow(input(), 60_000, 9, 100))
  expect(later).toContain('Fix the login bug')
  expect(later).toContain('2/7 · ~2m left')
  // Done: three rows of fireworks over the bar, a rainbow title.
  expect(skyRows(input({ isDone: true, finishedAt: 1000 }), n, w, 7, 1500, 3).length).toBe(3)
  expect(text(titleRow(input({ isDone: true, eta: 'done in 2m 5s' }), 0, 3, 100))).toContain('✓ Fix the login bug')
  expect(columnOf(0, n, w)).toBe(0)
  expect(columnOf(7, n, w)).toBe(L - 1)
})

test('agent row: spinner, name, cube, budget meter, countdown and tool, within the width', () => {
  const a = { id: 'a1', name: 'Builder', tag: 'c3', startedAt: 0, budgetMs: 240_000, what: 'Edit hooks/cubes-pane.tsx', whatSince: 0 }
  const row = text(agentRow(a, 0, 60_000, 4, 100))
  expect(row).toMatch(/^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] Builder · c3 [▰▱]{8} 3:00 left {2}Edit hooks\/cubes-pane\.tsx$/)
  expect(text(agentRow(a, 0, 300_000, 4, 100))).toContain('+1:00 over')
  for (const width of [30, 60]) expect(lineWidth(agentRow(a, 1, 60_000, 4, width))).toBeLessThanOrEqual(width)
  for (const r of doneRows(3, 5, 50)) expect(lineWidth(r)).toBeLessThanOrEqual(50)
  expect(text(doneRows(3, 5, 50)[0]!)).toContain('done! · 3 agents')
  expect(lineWidth(clip([{ text: 'abcdef' }], 3))).toBe(3)
})

test('cube glyphs: still when motion is off, spinning when calm, breathing, popping and shaking when extreme', () => {
  const row = (status: string) => ({ id: 'c3', glyph: '◐', tone: 'running' as const, status: status as any })
  expect(glyphFx(row('running'), 'off', 0, Infinity).glyph).toBe(glyphFx(row('running'), 'off', 9, Infinity).glyph)
  expect(new Set([0, 2, 4, 6].map(t => glyphFx(row('running'), 'calm', t, Infinity).glyph)).size).toBe(4)
  expect(glyphFx(row('proposed'), 'calm', 3, Infinity).color).toBe(glyphFx(row('proposed'), 'calm', 9, Infinity).color)
  expect(new Set([0, 2, 4, 6].map(t => glyphFx(row('proposed'), 'extreme', t, Infinity).color)).size).toBeGreaterThan(2)
  expect(glyphFx(row('done'), 'extreme', 0, 0).glyph).toBe('✺')
  expect(glyphFx(row('done'), 'extreme', 0, 1500).glyph).toBe('✓')
  expect(glyphFx(row('done'), 'extreme', 0, 5000).titleColor).toBeUndefined()
  expect(glyphFx(row('failed'), 'extreme', 0, 100).glyph).not.toBe(glyphFx(row('failed'), 'extreme', 1, 100).glyph)
  expect(glyphFx(row('approved'), 'extreme', 0, 200).titleColor).toBeDefined() // a status change lights the title
})

test('agents pane in extreme motion: two star layers, scenes with budget meters, then a finale', () => {
  const agents = [{ id: 'a1', label: 'step 1', startedAt: 0, budgetMs: 120_000, type: 'task-progress:executor', lastTool: 'Edit a.ts' }]
  for (let tick = 0; tick < 60; tick += 7) {
    const lines = extremePaneFrame(tick, agents, 30_000, 44, null)
    expect(lines.length).toBe(2 + 3 + 1)
    for (const l of lines) expect(lineWidth(l)).toBeLessThanOrEqual(44)
    expect(text(lines[5]!)).toContain('25%')
  }
  const fin = extremePaneFrame(4, [], 1_000, 44, 0)
  expect(fin.map(text).join('\n')).toContain('All done!')
  for (const l of fin) expect(lineWidth(l)).toBeLessThanOrEqual(44)
  expect(extremePaneFrame(4, [], 10_000, 44, null)).toEqual([])
})
