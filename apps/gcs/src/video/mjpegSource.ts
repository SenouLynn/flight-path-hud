/**
 * `multipart/x-mixed-replace` adapter.
 *
 * The least demanding video path: no media server, no codec negotiation, no
 * signalling. Plenty of capture setups emit it directly, which is why it is the
 * adapter that can be built and watched without hardware.
 *
 * It reads the stream with `fetch` and demuxes the parts itself rather than
 * pointing an `<img>` at the URL. An `<img>` renders every part but fires `load`
 * only for the first, so it reports one frame and then looks stalled forever.
 * Demuxing gives an exact frame count and a byte total — the only way this
 * transport can report a real bitrate.
 */

import { createMultipartDemuxer, parseBoundary } from './multipart'
import type { VideoSource, VideoSourceHandlers } from './videoSource'

const STATS_INTERVAL_MS = 500

export function createMjpegSource(url: string): VideoSource {
  return {
    id: 'mjpeg',
    label: 'MJPEG / multipart',
    measures: { fps: true, bitrate: true, dropped: false },

    start(container, handlers: VideoSourceHandlers) {
      handlers.onConnectionState('connecting')

      const canvas = document.createElement('canvas')
      canvas.className = 'video-frame'
      container.appendChild(canvas)
      const context = canvas.getContext('2d')

      const abort = new AbortController()
      let framesDecoded = 0
      let bytesReceived = 0
      let sawFirstFrame = false
      let stopped = false
      let fallbackImage: HTMLImageElement | null = null

      /*
       * `fetch` is subject to CORS; an `<img>` is not. A camera that serves no
       * Access-Control-Allow-Origin cannot be demuxed, but it can still be shown.
       * A picture without statistics beats an error with none, so fall back and
       * report the loss of measurement honestly by leaving the counters at zero.
       */
      const fallBackToImageTag = () => {
        if (stopped || fallbackImage !== null) {
          return
        }

        canvas.remove()
        const image = document.createElement('img')
        image.className = 'video-frame'
        image.alt = 'Live video'
        image.addEventListener('load', () => handlers.onConnectionState('playing'), { once: true })
        image.addEventListener('error', () => handlers.onConnectionState('error'), { once: true })
        image.src = `${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}`
        container.appendChild(image)
        fallbackImage = image
      }

      const statsTimer = setInterval(() => {
        handlers.onStats({ timestampMs: Date.now(), framesDecoded, bytesReceived })
      }, STATS_INTERVAL_MS)

      const draw = async (bytes: Uint8Array, contentType: string) => {
        if (context === null) {
          return
        }

        // ImageBitmap decodes off the main thread and needs no object URL, so
        // there is no per-frame URL churn to leak at 15-30 fps.
        const bitmap = await createImageBitmap(new Blob([bytes as BlobPart], { type: contentType }))

        if (stopped) {
          bitmap.close()
          return
        }

        if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
          canvas.width = bitmap.width
          canvas.height = bitmap.height
        }

        context.drawImage(bitmap, 0, 0)
        bitmap.close()

        framesDecoded += 1
        if (!sawFirstFrame) {
          sawFirstFrame = true
          handlers.onConnectionState('playing')
        }
      }

      const run = async () => {
        try {
          const response = await fetch(url, { signal: abort.signal, cache: 'no-store' })

          if (!response.ok || response.body === null) {
            handlers.onConnectionState('error')
            return
          }

          const boundary = parseBoundary(response.headers.get('content-type'))
          if (boundary === null) {
            // Reachable but not multipart — an <img> may still render it.
            fallBackToImageTag()
            return
          }

          const demuxer = createMultipartDemuxer(boundary)
          const reader = response.body.getReader()

          for (;;) {
            const { done, value } = await reader.read()
            if (done || stopped) {
              break
            }

            bytesReceived += value.length
            for (const part of demuxer.push(value)) {
              await draw(part.bytes, part.contentType)
            }
          }
        } catch (error) {
          // An abort is our own teardown, not a stream failure.
          if (stopped || (error as Error)?.name === 'AbortError') {
            return
          }

          // A blocked cross-origin fetch is indistinguishable from a network
          // failure here, so try the path that CORS does not gate.
          fallBackToImageTag()
        }
      }

      void run()

      return () => {
        stopped = true
        clearInterval(statsTimer)
        // Aborting closes the response; without it the server keeps encoding
        // frames for a reader that has gone away.
        abort.abort()
        canvas.remove()
        if (fallbackImage !== null) {
          // Clearing src aborts the in-flight multipart response.
          fallbackImage.src = ''
          fallbackImage.remove()
        }
        handlers.onConnectionState('idle')
      }
    },
  }
}
