import { describe, expect, it } from 'vitest'
import { createMultipartDemuxer, parseBoundary } from './multipart'

const BOUNDARY = 'frameboundary'

function encodePart(body: string, { withLength = true } = {}): Uint8Array {
  const headers = withLength
    ? `--${BOUNDARY}\r\nContent-Type: image/png\r\nContent-Length: ${body.length}\r\n\r\n`
    : `--${BOUNDARY}\r\nContent-Type: image/png\r\n\r\n`
  return Uint8Array.from(`${headers}${body}\r\n`, (c) => c.charCodeAt(0))
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  return out
}

const decode = (bytes: Uint8Array) => String.fromCharCode(...bytes)

describe('parseBoundary', () => {
  it('reads the boundary from the content type', () => {
    expect(parseBoundary('multipart/x-mixed-replace; boundary=frameboundary')).toBe('frameboundary')
  })

  it('handles a quoted boundary', () => {
    expect(parseBoundary('multipart/x-mixed-replace; boundary="with space"')).toBe('with space')
  })

  it('returns null when there is no boundary or no header', () => {
    expect(parseBoundary('image/png')).toBeNull()
    expect(parseBoundary(null)).toBeNull()
  })
})

describe('createMultipartDemuxer', () => {
  it('yields one part per frame', () => {
    const demuxer = createMultipartDemuxer(BOUNDARY)
    const parts = demuxer.push(concat([encodePart('AAA'), encodePart('BBB')]))

    expect(parts.map((p) => decode(p.bytes))).toEqual(['AAA', 'BBB'])
    expect(parts[0].contentType).toBe('image/png')
  })

  it('reassembles a frame split across reads', () => {
    // The exact case that makes naive framing drop frames: a chunk boundary
    // landing mid-part.
    const whole = encodePart('HELLOWORLD')
    const demuxer = createMultipartDemuxer(BOUNDARY)

    const first = demuxer.push(whole.slice(0, 30))
    expect(first).toHaveLength(0)

    const second = demuxer.push(whole.slice(30))
    expect(second.map((p) => decode(p.bytes))).toEqual(['HELLOWORLD'])
  })

  it('reassembles across many tiny reads', () => {
    const whole = concat([encodePart('ONE'), encodePart('TWO'), encodePart('THREE')])
    const demuxer = createMultipartDemuxer(BOUNDARY)
    const seen: string[] = []

    for (let i = 0; i < whole.length; i += 7) {
      demuxer.push(whole.slice(i, i + 7)).forEach((p) => seen.push(decode(p.bytes)))
    }

    expect(seen).toEqual(['ONE', 'TWO', 'THREE'])
  })

  it('trusts Content-Length over scanning, so payload may contain the delimiter', () => {
    // Binary image data can legitimately contain the boundary bytes; scanning
    // for them would truncate the frame.
    const body = `xx--${BOUNDARY}xx`
    const demuxer = createMultipartDemuxer(BOUNDARY)
    const parts = demuxer.push(concat([encodePart(body), encodePart('NEXT')]))

    expect(decode(parts[0].bytes)).toBe(body)
    expect(decode(parts[1].bytes)).toBe('NEXT')
  })

  it('falls back to delimiter scanning when Content-Length is absent', () => {
    const demuxer = createMultipartDemuxer(BOUNDARY)
    const parts = demuxer.push(concat([
      encodePart('NOLEN', { withLength: false }),
      encodePart('AFTER', { withLength: false }),
    ]))

    expect(decode(parts[0].bytes)).toBe('NOLEN')
  })

  it('holds back an incomplete trailing part rather than emitting it', () => {
    const demuxer = createMultipartDemuxer(BOUNDARY)
    const parts = demuxer.push(concat([encodePart('DONE'), encodePart('PARTIAL').slice(0, 20)]))

    expect(parts.map((p) => decode(p.bytes))).toEqual(['DONE'])
    expect(demuxer.pendingBytes()).toBeGreaterThan(0)
  })
})
