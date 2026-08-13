import { readRecording } from './recording.js'

/**
 * Inbound adapter: a recorded session re-emitted with its original pacing.
 * Interchangeable with the UDP adapter — same `start(onDatagram) => stop` shape —
 * which is what proves the bridge core isn't coupled to a single transport.
 *
 * Each datagram carries the wall clock it was captured at, so the core can decode
 * it to exactly the envelope the live run produced.
 */
export function createReplayIngress(filePath, { speed = 1, loop = false } = {}) {
  const entries = readRecording(filePath)

  return {
    describe: () => `replay ${filePath} (${entries.length} datagrams, ${speed}x${loop ? ', looping' : ''})`,

    start(onDatagram, onEvent = () => undefined) {
      if (entries.length === 0) {
        console.warn(`[mavlink-bridge] recording ${filePath} is empty`)
        return () => undefined
      }

      let stopped = false
      let timer = null
      let index = 0
      let previousMs = 0

      const scheduleNext = () => {
        if (stopped) {
          return
        }

        if (index >= entries.length) {
          if (!loop) {
            console.log('[mavlink-bridge] replay finished')
            return
          }
          index = 0
          previousMs = 0
        }

        const entry = entries[index]
        const delayMs = Math.max(0, (entry.tMs - previousMs) / speed)

        timer = setTimeout(() => {
          if (stopped) {
            return
          }

          if (entry.data !== null) onDatagram(entry.data, { source: 'replay', atMs: entry.atMs })
          if (entry.event !== null) onEvent(entry.event, { source: 'replay', atMs: entry.atMs })
          previousMs = entry.tMs
          index += 1
          scheduleNext()
        }, delayMs)
      }

      scheduleNext()

      return () => {
        stopped = true
        if (timer !== null) {
          clearTimeout(timer)
          timer = null
        }
      }
    },
  }
}
