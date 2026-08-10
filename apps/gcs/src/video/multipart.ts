/**
 * Incremental `multipart/x-mixed-replace` demuxer.
 *
 * Pure byte handling, no DOM — so the framing logic is testable without a
 * browser, which matters because the failure it fixes was invisible until frames
 * were actually counted.
 *
 * An `<img>` pointed at a multipart stream renders every part but only fires
 * `load` for the first, so it cannot report a frame rate. Demuxing ourselves
 * yields an exact frame count and byte total, which is also the only way this
 * transport can report bitrate at all.
 */

export interface MultipartPart {
  contentType: string
  bytes: Uint8Array
}

const DOUBLE_CRLF = new Uint8Array([13, 10, 13, 10])

function indexOfBytes(haystack: Uint8Array, needle: Uint8Array, from = 0): number {
  outer: for (let i = from; i <= haystack.length - needle.length; i += 1) {
    for (let j = 0; j < needle.length; j += 1) {
      if (haystack[i + j] !== needle[j]) {
        continue outer
      }
    }
    return i
  }
  return -1
}

function asciiToBytes(value: string): Uint8Array {
  return Uint8Array.from(value, (character) => character.charCodeAt(0))
}

/** `multipart/x-mixed-replace; boundary=foo` → `foo`. Quotes are legal. */
export function parseBoundary(contentTypeHeader: string | null): string | null {
  if (contentTypeHeader === null) {
    return null
  }

  const match = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentTypeHeader)
  return match === null ? null : (match[1] ?? match[2])
}

/**
 * Feed bytes, get whole parts back. Retains any trailing partial part, so a frame
 * split across reads is reassembled rather than dropped.
 */
export function createMultipartDemuxer(boundary: string) {
  const delimiter = asciiToBytes(`--${boundary}`)
  let buffer = new Uint8Array(0)

  return {
    push(chunk: Uint8Array): MultipartPart[] {
      const merged = new Uint8Array(buffer.length + chunk.length)
      merged.set(buffer, 0)
      merged.set(chunk, buffer.length)
      buffer = merged

      const parts: MultipartPart[] = []

      for (;;) {
        const start = indexOfBytes(buffer, delimiter)
        if (start === -1) {
          break
        }

        const headerStart = start + delimiter.length
        const headerEnd = indexOfBytes(buffer, DOUBLE_CRLF, headerStart)
        if (headerEnd === -1) {
          // Headers still arriving; keep from the delimiter so nothing is lost.
          buffer = buffer.slice(start)
          break
        }

        const headerText = new TextDecoder().decode(buffer.slice(headerStart, headerEnd))
        const bodyStart = headerEnd + DOUBLE_CRLF.length

        const lengthMatch = /content-length:\s*(\d+)/i.exec(headerText)
        const typeMatch = /content-type:\s*([^\r\n;]+)/i.exec(headerText)
        const contentType = typeMatch?.[1].trim() ?? 'application/octet-stream'

        let bodyEnd: number
        if (lengthMatch !== null) {
          // Content-Length is exact; trust it rather than scanning, since the
          // payload can legitimately contain the delimiter bytes.
          bodyEnd = bodyStart + Number.parseInt(lengthMatch[1], 10)
          if (bodyEnd > buffer.length) {
            buffer = buffer.slice(start)
            break
          }
        } else {
          const next = indexOfBytes(buffer, delimiter, bodyStart)
          if (next === -1) {
            buffer = buffer.slice(start)
            break
          }
          // Trailing CRLF before the next delimiter is framing, not payload.
          bodyEnd = next - 2
        }

        parts.push({ contentType, bytes: buffer.slice(bodyStart, bodyEnd) })
        buffer = buffer.slice(bodyEnd)
      }

      return parts
    },

    /** Bytes held back awaiting the rest of a part. */
    pendingBytes(): number {
      return buffer.length
    },
  }
}
