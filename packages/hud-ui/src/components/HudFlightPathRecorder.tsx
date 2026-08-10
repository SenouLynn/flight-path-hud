import { useMemo, useRef, useState } from 'react'
import type { PositionSource, TrackPoint } from '../logic/position'

/**
 * Fixed, orbitable 3D world showing where the aircraft HAS BEEN — a breadcrumb
 * track in a local ENU frame (x=East, y=North, z=Up). Distinct from the
 * forward-looking, nose-relative HudPredictiveTrajectory: this one is
 * world-referenced and cumulative.
 *
 * Projection is a turntable: rotate each point about the vertical (Up) axis by
 * the drag azimuth, then tilt by a fixed elevation. Orthographic (no
 * perspective divide) so a large logged track stays readable at any zoom.
 */

interface HudFlightPathRecorderProps {
  track: TrackPoint[]
  source: PositionSource
  width?: number
  height?: number
}

interface Bounds {
  centroid: { eastM: number, northM: number, upM: number }
  halfExtentM: number
  minEastM: number
  maxEastM: number
  minNorthM: number
  maxNorthM: number
  minUpM: number
}

const DEFAULT_AZIMUTH_DEG = 30
const DEFAULT_ELEVATION_DEG = 34
const MIN_ELEVATION_DEG = 5
const MAX_ELEVATION_DEG = 89
const MIN_ZOOM = 0.25
const MAX_ZOOM = 8
const RENDER_POINT_CAP = 240 // decimate for drawing; buffer keeps the full track

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function niceStep(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) {
    return 1
  }
  const pow = Math.pow(10, Math.floor(Math.log10(raw)))
  const n = raw / pow
  const nice = n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10
  return nice * pow
}

function computeBounds(track: TrackPoint[]): Bounds {
  let minEastM = Infinity
  let maxEastM = -Infinity
  let minNorthM = Infinity
  let maxNorthM = -Infinity
  let minUpM = Infinity
  let maxUpM = -Infinity

  for (const point of track) {
    minEastM = Math.min(minEastM, point.eastM)
    maxEastM = Math.max(maxEastM, point.eastM)
    minNorthM = Math.min(minNorthM, point.northM)
    maxNorthM = Math.max(maxNorthM, point.northM)
    minUpM = Math.min(minUpM, point.upM)
    maxUpM = Math.max(maxUpM, point.upM)
  }

  const centroid = {
    eastM: (minEastM + maxEastM) / 2,
    northM: (minNorthM + maxNorthM) / 2,
    upM: (minUpM + maxUpM) / 2,
  }
  const halfExtentM = Math.max(
    (maxEastM - minEastM) / 2,
    (maxNorthM - minNorthM) / 2,
    (maxUpM - minUpM) / 2,
    1,
  )

  return { centroid, halfExtentM, minEastM, maxEastM, minNorthM, maxNorthM, minUpM }
}

/** Decimate to at most `cap` points, always keeping the head (most recent). */
function decimate(track: TrackPoint[], cap: number): TrackPoint[] {
  if (track.length <= cap) {
    return track
  }
  const stride = Math.ceil(track.length / cap)
  const out: TrackPoint[] = []
  for (let index = 0; index < track.length; index += stride) {
    out.push(track[index])
  }
  const last = track[track.length - 1]
  if (out[out.length - 1] !== last) {
    out.push(last)
  }
  return out
}

interface ProjectorParams {
  azimuthRad: number
  elevationRad: number
  scale: number
  centroid: { eastM: number, northM: number, upM: number }
  centerX: number
  centerY: number
}

function makeProjector(params: ProjectorParams) {
  const { azimuthRad, elevationRad, scale, centroid, centerX, centerY } = params
  const cosA = Math.cos(azimuthRad)
  const sinA = Math.sin(azimuthRad)
  const sinE = Math.sin(elevationRad)
  const cosE = Math.cos(elevationRad)

  return function project(eastM: number, northM: number, upM: number) {
    const x = (eastM - centroid.eastM) * scale
    const y = (northM - centroid.northM) * scale
    const z = (upM - centroid.upM) * scale
    const east = x * cosA - y * sinA
    const north = x * sinA + y * cosA
    const screenRight = east
    const screenUp = north * sinE + z * cosE
    return { x: centerX + screenRight, y: centerY - screenUp }
  }
}

export function HudFlightPathRecorder({
  track,
  source,
  width = 620,
  height = 620,
}: HudFlightPathRecorderProps) {
  const [azimuthDeg, setAzimuthDeg] = useState(DEFAULT_AZIMUTH_DEG)
  const [elevationDeg, setElevationDeg] = useState(DEFAULT_ELEVATION_DEG)
  const [zoom, setZoom] = useState(1)
  const dragRef = useRef<{ x: number, y: number } | null>(null)

  const centerX = width / 2
  const centerY = height / 2

  const bounds = useMemo(() => (track.length > 0 ? computeBounds(track) : null), [track])

  if (track.length === 0 || bounds === null) {
    return <div className="hud-orientation-empty">Awaiting position fix…</div>
  }

  const baseScale = (Math.min(width, height) * 0.42) / bounds.halfExtentM
  const scale = baseScale * zoom
  const azimuthRad = (azimuthDeg * Math.PI) / 180
  const elevationRad = (elevationDeg * Math.PI) / 180
  const project = makeProjector({ azimuthRad, elevationRad, scale, centroid: bounds.centroid, centerX, centerY })

  // Ground plane sits at the track's lowest altitude so shadows always fall
  // downward onto it — even when a dead-reckoned track drifts below the origin.
  const groundUpM = bounds.minUpM
  const step = niceStep((bounds.halfExtentM * 2) / 6)
  const gridMin = (v: number) => Math.floor(v / step) * step
  const gridMax = (v: number) => Math.ceil(v / step) * step
  const eastTicks: number[] = []
  for (let e = gridMin(bounds.minEastM); e <= gridMax(bounds.maxEastM); e += step) {
    eastTicks.push(e)
  }
  const northTicks: number[] = []
  for (let n = gridMin(bounds.minNorthM); n <= gridMax(bounds.maxNorthM); n += step) {
    northTicks.push(n)
  }
  const eEdge0 = gridMin(bounds.minEastM)
  const eEdge1 = gridMax(bounds.maxEastM)
  const nEdge0 = gridMin(bounds.minNorthM)
  const nEdge1 = gridMax(bounds.maxNorthM)

  const gridLines: Array<{ x1: number, y1: number, x2: number, y2: number }> = []
  for (const e of eastTicks) {
    const a = project(e, nEdge0, groundUpM)
    const b = project(e, nEdge1, groundUpM)
    gridLines.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y })
  }
  for (const n of northTicks) {
    const a = project(eEdge0, n, groundUpM)
    const b = project(eEdge1, n, groundUpM)
    gridLines.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y })
  }

  const render = decimate(track, RENDER_POINT_CAP)
  const projected = render.map((point) => ({
    air: project(point.eastM, point.northM, point.upM),
    ground: project(point.eastM, point.northM, groundUpM),
    upM: point.upM,
  }))

  // Path polyline (points string) + ground-shadow polyline.
  const airPoints = projected.map((p) => `${p.air.x.toFixed(1)},${p.air.y.toFixed(1)}`).join(' ')
  const shadowPoints = projected.map((p) => `${p.ground.x.toFixed(1)},${p.ground.y.toFixed(1)}`).join(' ')

  // Age-faded path: draw in tiers so older segments read fainter.
  const segments = projected.slice(0, -1).map((p, index) => {
    const q = projected[index + 1]
    const t = index / Math.max(1, projected.length - 1)
    return { x1: p.air.x, y1: p.air.y, x2: q.air.x, y2: q.air.y, opacity: 0.2 + 0.75 * t }
  })

  // Altitude drop-lines (decimated further so they don't clutter).
  const dropStride = Math.max(1, Math.ceil(projected.length / 24))
  const drops = projected.filter((_, index) => index % dropStride === 0 || index === projected.length - 1)

  const headProjected = projected[projected.length - 1]
  const head = headProjected.air
  const headGround = headProjected.ground
  const newest = track[track.length - 1]

  // Compass gnomon: unit ENU axes at a fixed screen anchor.
  const gnomonLen = 34
  const gnomon = makeProjector({
    azimuthRad,
    elevationRad,
    scale: gnomonLen,
    centroid: { eastM: 0, northM: 0, upM: 0 },
    centerX: 52,
    centerY: height - 52,
  })
  const gnomonO = gnomon(0, 0, 0)
  const gnomonN = gnomon(0, 1, 0)
  const gnomonE = gnomon(1, 0, 0)
  const gnomonU = gnomon(0, 0, 1)

  const onPointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = { x: event.clientX, y: event.clientY }
  }
  const onPointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    if (dragRef.current === null) {
      return
    }
    const dx = event.clientX - dragRef.current.x
    const dy = event.clientY - dragRef.current.y
    dragRef.current = { x: event.clientX, y: event.clientY }
    setAzimuthDeg((prev) => prev - dx * 0.5)
    setElevationDeg((prev) => clamp(prev + dy * 0.5, MIN_ELEVATION_DEG, MAX_ELEVATION_DEG))
  }
  const onPointerUp = (event: React.PointerEvent<SVGSVGElement>) => {
    event.currentTarget.releasePointerCapture(event.pointerId)
    dragRef.current = null
  }
  const onWheel = (event: React.WheelEvent<SVGSVGElement>) => {
    setZoom((prev) => clamp(prev * (event.deltaY < 0 ? 1.1 : 1 / 1.1), MIN_ZOOM, MAX_ZOOM))
  }

  const altitudeM = newest.upM

  return (
    <svg
      className="hud-recorder"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="Flight path recorder — 3D breadcrumb track"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onWheel={onWheel}
    >
      <rect x={0} y={0} width={width} height={height} className="hud-recorder-bg" rx={10} ry={10} />

      {/* Ground plane grid (ENU up = 0) */}
      <g className="hud-recorder-grid-group">
        {gridLines.map((line, index) => (
          <line key={`grid-${index}`} x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2} className="hud-recorder-grid" />
        ))}
      </g>

      {/* Ground shadow of the track */}
      <polyline points={shadowPoints} className="hud-recorder-shadow" fill="none" />

      {/* Altitude drop-lines from each sampled point to its ground shadow */}
      <g className="hud-recorder-drop-group">
        {drops.map((p, index) => (
          <line key={`drop-${index}`} x1={p.air.x} y1={p.air.y} x2={p.ground.x} y2={p.ground.y} className="hud-recorder-drop" />
        ))}
      </g>

      {/* Age-faded flight path */}
      <g className="hud-recorder-path-group">
        {segments.map((seg, index) => (
          <line
            key={`seg-${index}`}
            x1={seg.x1}
            y1={seg.y1}
            x2={seg.x2}
            y2={seg.y2}
            className="hud-recorder-path"
            style={{ opacity: seg.opacity }}
          />
        ))}
        {segments.length === 0 ? <polyline points={airPoints} className="hud-recorder-path" fill="none" /> : null}
      </g>

      {/* Current position marker + its ground shadow */}
      <line x1={head.x} y1={head.y} x2={headGround.x} y2={headGround.y} className="hud-recorder-drop" />
      <circle cx={headGround.x} cy={headGround.y} r={2.5} className="hud-recorder-marker-shadow" />
      <circle cx={head.x} cy={head.y} r={5} className="hud-recorder-marker" />

      {/* Compass gnomon (N / E / Up) */}
      <g className="hud-recorder-gnomon">
        <line x1={gnomonO.x} y1={gnomonO.y} x2={gnomonN.x} y2={gnomonN.y} className="hud-recorder-axis-n" />
        <line x1={gnomonO.x} y1={gnomonO.y} x2={gnomonE.x} y2={gnomonE.y} className="hud-recorder-axis-e" />
        <line x1={gnomonO.x} y1={gnomonO.y} x2={gnomonU.x} y2={gnomonU.y} className="hud-recorder-axis-u" />
        <text x={gnomonN.x} y={gnomonN.y - 3} className="hud-recorder-axis-label" textAnchor="middle">N</text>
        <text x={gnomonE.x + 4} y={gnomonE.y} className="hud-recorder-axis-label">E</text>
        <text x={gnomonU.x} y={gnomonU.y - 3} className="hud-recorder-axis-label" textAnchor="middle">↑</text>
      </g>

      {/* Readouts */}
      <text x={18} y={24} className="hud-recorder-label">TRACK {track.length} pts</text>
      <text x={18} y={42} className="hud-recorder-label">ALT {altitudeM.toFixed(1)} m</text>
      <text x={18} y={60} className="hud-recorder-label">E {newest.eastM.toFixed(0)} / N {newest.northM.toFixed(0)} m</text>
      <text x={18} y={78} className="hud-recorder-label hud-recorder-source">{source}</text>

      <text x={width - 18} y={24} textAnchor="end" className="hud-recorder-hint">
        Drag to orbit · scroll to zoom
      </text>
      <text x={width - 18} y={height - 16} textAnchor="end" className="hud-recorder-hint">
        grid {step} m
      </text>
    </svg>
  )
}
