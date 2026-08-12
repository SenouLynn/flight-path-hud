/**
 * Mock camera: a moving test pattern served as `multipart/x-mixed-replace`.
 *
 * This is the video analogue of the MAVLink mock fleet — a stand-in so the GCS video
 * path can be built and watched with no capture hardware and no media server.
 *
 * Frames are PNGs encoded here rather than by ffmpeg, so the whole thing runs on
 * a stock Node install with no dependencies. Browsers accept any image type in a
 * multipart-replace stream, so `image/png` plays exactly where MJPEG would.
 *
 * The real path is MediaMTX republishing a capture device over WHEP (ADR-0021);
 * this exists so the panel above it can be finished first.
 */

import http from 'node:http'
import zlib from 'node:zlib'

const PORT = Number.parseInt(process.env.VIDEO_MOCK_PORT ?? '8090', 10)
const PATH_NAME = process.env.VIDEO_MOCK_PATH ?? '/stream'
const WIDTH = Number.parseInt(process.env.VIDEO_MOCK_WIDTH ?? '480', 10)
const HEIGHT = Number.parseInt(process.env.VIDEO_MOCK_HEIGHT ?? '270', 10)
const FPS = Number.parseInt(process.env.VIDEO_MOCK_FPS ?? '15', 10)
const BOUNDARY = 'flightpathframe'

// --- Minimal PNG encoder -----------------------------------------------------
// Only what a truecolour, non-interlaced frame needs: IHDR, IDAT, IEND.

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1
    }
    table[n] = c
  }
  return table
})()

function crc32(buffer) {
  let crc = -1
  for (let i = 0; i < buffer.length; i += 1) {
    crc = CRC_TABLE[(crc ^ buffer[i]) & 0xFF] ^ (crc >>> 8)
  }
  return (crc ^ -1) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)

  const typed = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(typed), 0)

  return Buffer.concat([length, typed, crc])
}

function encodePng(width, height, rgb) {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8 // bit depth
  header[9] = 2 // colour type: truecolour RGB
  header[10] = 0 // deflate
  header[11] = 0 // adaptive filtering
  header[12] = 0 // no interlace

  // Each scanline is prefixed with its filter byte; 0 means "none".
  const raw = Buffer.alloc(height * (1 + width * 3))
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (1 + width * 3)
    raw[rowStart] = 0
    rgb.copy(raw, rowStart + 1, y * width * 3, (y + 1) * width * 3)
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// --- Test pattern ------------------------------------------------------------

/**
 * A sweeping bar over a slowly shifting background, plus a corner block that
 * changes every frame. Motion has to be obvious at a glance: a static pattern
 * cannot tell a working stream from a frozen one.
 */
function renderFrame(frameIndex) {
  const rgb = Buffer.alloc(WIDTH * HEIGHT * 3)
  const barX = Math.floor(((frameIndex * 4) % (WIDTH + 80)) - 40)
  const wash = 20 + Math.floor(18 * Math.sin(frameIndex / 24))

  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const offset = (y * WIDTH + x) * 3
      // Faint grid so motion is readable even where the bar is not.
      const grid = x % 40 === 0 || y % 40 === 0 ? 18 : 0
      let r = wash + grid
      let g = wash + 6 + grid
      let b = wash + 14 + grid

      if (Math.abs(x - barX) < 18) {
        r = 255
        g = 180
        b = 84
      }

      // Frame-parity block: flips every frame, so a freeze is unmistakable.
      if (x < 28 && y < 28) {
        const on = frameIndex % 2 === 0
        r = on ? 116 : 30
        g = on ? 215 : 40
        b = on ? 255 : 55
      }

      rgb[offset] = r
      rgb[offset + 1] = g
      rgb[offset + 2] = b
    }
  }

  return encodePng(WIDTH, HEIGHT, rgb)
}

// --- Server ------------------------------------------------------------------

const server = http.createServer((request, response) => {
  if (!request.url?.startsWith(PATH_NAME)) {
    response.writeHead(404).end('not found')
    return
  }

  response.writeHead(200, {
    /*
     * The GCS demuxes this stream with fetch() to count frames, and fetch is
     * subject to CORS where an <img> is not. Without this header a cross-origin
     * dev server sees an opaque failure rather than a stream.
     */
    'Access-Control-Allow-Origin': '*',
    'Content-Type': `multipart/x-mixed-replace; boundary=${BOUNDARY}`,
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    Connection: 'close',
    Pragma: 'no-cache',
  })

  let frameIndex = 0
  let closed = false

  const timer = setInterval(() => {
    if (closed) {
      return
    }

    const png = renderFrame(frameIndex)
    frameIndex += 1

    // Back-pressure: skip a frame rather than queue, or a slow client drifts
    // further behind forever, which is the opposite of what a live view wants.
    if (response.writableNeedDrain) {
      return
    }

    response.write(`--${BOUNDARY}\r\nContent-Type: image/png\r\nContent-Length: ${png.length}\r\n\r\n`)
    response.write(png)
    response.write('\r\n')
  }, Math.round(1000 / FPS))

  const stop = () => {
    closed = true
    clearInterval(timer)
  }

  request.on('close', stop)
  response.on('error', stop)
})

server.listen(PORT, () => {
  console.log(`[video-mock] test pattern at http://localhost:${PORT}${PATH_NAME} (${WIDTH}x${HEIGHT} @ ${FPS}fps)`)
})

process.on('SIGINT', () => {
  server.close()
  process.exit(0)
})
