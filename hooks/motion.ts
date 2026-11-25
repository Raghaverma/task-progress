// How much moves, read the same way by the band and both panes.
import { parseMotion, type Motion } from './fx'

const motionRef = { plugin: 'task-progress', key: 'motion' } as const

/** The session's level (session.start mirrors $.store into $.state, which drawings subscribe to); before that, the stored choice; else extreme. */
export async function readMotion($: any): Promise<Motion> {
  const v = parseMotion((await $.state.get(motionRef)).value)
  if (v) return v
  try {
    return parseMotion(await $.store.get('motion')) ?? 'extreme'
  } catch {
    return 'extreme'
  }
}
