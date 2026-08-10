import { useMemo, useState } from 'react'
import { ATTITUDE_VALIDATION_FRAMES, FLIGHT_PATH_VALIDATION_FRAMES, HEADING_VALIDATION_FRAMES, HudFlightPathRecorder, HudOrientationIndicator, HudPredictiveTrajectory, HudPrimaryFlightDisplay, resolveAttitude, resolveFlightPath2d, resolveFlightPath3d, resolveHeading, resolvePredictivePath, resolveScalarTelemetry, runAttitudeReplay, runFlightPathReplay, runHeadingReplay } from '@flight-path-hud/hud-ui'
import { MAVLINK_FIELDS, MAVLINK_FIELD_KEYS } from '../constants/mavlinkInputs'
import {
  buildSyntheticMissionSamples,
  createLiveMockSource,
  createSyntheticReplaySource,
  type TelemetrySourceId,
} from '../stream/telemetrySource'
import { useTelemetryFeed } from '../stream/useTelemetryFeed'
import { useFlightTrack } from '../stream/useFlightTrack'

function HorizonPreview({ x1, y1, x2, y2 }: { x1: number, y1: number, x2: number, y2: number }) {
  return (
    <svg className="horizon-preview" viewBox="-110 -80 220 160" role="img" aria-label="Horizon transform preview">
      <line className="preview-axis" x1={-100} y1={0} x2={100} y2={0} />
      <line className="preview-axis" x1={0} y1={-70} x2={0} y2={70} />
      <line className="preview-horizon" x1={x1} y1={y1} x2={x2} y2={y2} />
    </svg>
  )
}

function PathPreview({
  linear,
  turnAware,
}: {
  linear: Array<{ northM: number, eastM: number }>
  turnAware: Array<{ northM: number, eastM: number }>
}) {
  const polylineFromPoints = (points: Array<{ northM: number, eastM: number }>) => {
    if (points.length === 0) {
      return ''
    }

    const scale = 2
    return points
      .map((point) => `${point.eastM * scale},${-point.northM * scale}`)
      .join(' ')
  }

  return (
    <svg className="path-preview" viewBox="-120 -120 240 240" role="img" aria-label="Predictive path preview">
      <line className="preview-axis" x1={-110} y1={0} x2={110} y2={0} />
      <line className="preview-axis" x1={0} y1={-110} x2={0} y2={110} />
      <polyline className="preview-linear" points={polylineFromPoints(linear)} />
      <polyline className="preview-turn" points={polylineFromPoints(turnAware)} />
    </svg>
  )
}

function ValidatorView() {
  const streamSamples = useMemo(() => buildSyntheticMissionSamples(40, 180), [])

  const telemetrySources = useMemo(() => {
    const synthetic = createSyntheticReplaySource(streamSamples, 300)
    const liveMock = createLiveMockSource(100)

    return {
      [synthetic.id]: synthetic,
      [liveMock.id]: liveMock,
    }
  }, [streamSamples])

  const [sourceId, setSourceId] = useState<TelemetrySourceId>('synthetic-replay')
  const activeSource = telemetrySources[sourceId]
  const feed = useTelemetryFeed(activeSource)
  const { latestSample, packetCount } = feed

  // Live feed is open-ended → rolling window; finite/replay sources keep the
  // full track so a whole logged flight is visible at once.
  const trackConfig = useMemo(
    () => (sourceId === 'live-mock' ? { maxPoints: 600, maxAgeSec: 45 } : { maxPoints: 4000 }),
    [sourceId],
  )
  const flightTrack = useFlightTrack(feed, sourceId, trackConfig)

  const liveHeading = latestSample === null ? null : resolveHeading(latestSample)
  const liveAttitude = latestSample === null ? null : resolveAttitude(latestSample)
  const liveYawDeg = latestSample?.attitude?.yawRad === undefined
    ? null
    : (latestSample.attitude.yawRad * 180) / Math.PI
  const liveScalar = latestSample === null ? null : resolveScalarTelemetry(latestSample)
  const liveVector2d = latestSample === null ? null : resolveFlightPath2d(latestSample)
  const liveVector3d = latestSample === null ? null : resolveFlightPath3d(latestSample)
  const livePredictive = latestSample === null ? null : resolvePredictivePath(latestSample)

  const headingReplay = runHeadingReplay(HEADING_VALIDATION_FRAMES)
  const attitudeReplay = runAttitudeReplay(ATTITUDE_VALIDATION_FRAMES)
  const flightPathReplay = runFlightPathReplay(FLIGHT_PATH_VALIDATION_FRAMES)

  return (
    <>
      <section className="header">
        <p className="eyebrow">Validation program bootstrap</p>
        <h1>HUD MAVLink Logic Validator</h1>
        <p className="intro">
          Incremental implementation started with deterministic heading-source resolution and replay
          validation plus a telemetry-source adapter layer for replay/live feed switching.
        </p>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>HUD Instrument Preview</h2>
          <p className="panel-subtitle">Unified primary flight display with heading tape fused above the attitude and horizon view.</p>
        </div>

        <div className="hud-fused-shell">
          <div className="hud-main-row">
            <HudPrimaryFlightDisplay
              headingDeg={liveHeading?.headingDeg ?? null}
              pitchDeg={liveAttitude?.pitchDeg ?? null}
              rollDeg={liveAttitude?.rollDeg ?? null}
            />
          </div>

          <div className="hud-secondary-grid">
            <div className="hud-secondary-card">
              <HudOrientationIndicator
                rollDeg={liveAttitude?.rollDeg ?? null}
                pitchDeg={liveAttitude?.pitchDeg ?? null}
                yawDeg={liveYawDeg}
                width={620}
                height={360}
              />
            </div>
              <div className="hud-secondary-card">
                <HudPredictiveTrajectory sample={latestSample} width={620} height={360} />
              </div>
              <div className="hud-secondary-card">
                <HudFlightPathRecorder track={flightTrack.track} source={flightTrack.source} width={620} height={360} />
              </div>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>Telemetry Source Adapter</h2>
          <p className="panel-subtitle">Switch between deterministic replay input and live-style stream while keeping the same resolver stack.</p>
        </div>
        <div className="adapter-controls">
          <label className="adapter-control">
            <span>Source</span>
            <select value={sourceId} onChange={(event) => setSourceId(event.target.value as TelemetrySourceId)}>
              {Object.values(telemetrySources).map((source) => (
                <option key={source.id} value={source.id}>{source.label}</option>
              ))}
            </select>
          </label>
          <div className="adapter-stat"><span>Packet interval</span><strong>{activeSource.intervalMs} ms</strong></div>
          <div className="adapter-stat"><span>Packets seen</span><strong>{packetCount}</strong></div>
          <div className="adapter-stat"><span>Last sample ts</span><strong>{latestSample === null ? 'N/A' : latestSample.timestampMs}</strong></div>
        </div>
        <table className="mapping-table live-table">
          <thead>
            <tr>
              <th>Heading deg / source</th>
              <th>Pitch deg</th>
              <th>Roll deg</th>
              <th>GS m/s</th>
              <th>Climb m/s</th>
              <th>Track2d deg</th>
              <th>FPA deg</th>
              <th>Predictive source</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                {liveHeading === null || liveHeading.headingDeg === null
                  ? 'N/A'
                  : `${liveHeading.headingDeg.toFixed(2)} / ${liveHeading.source}`}
              </td>
              <td>{liveAttitude?.pitchDeg === null || liveAttitude === null ? 'N/A' : liveAttitude.pitchDeg?.toFixed(2)}</td>
              <td>{liveAttitude?.rollDeg === null || liveAttitude === null ? 'N/A' : liveAttitude.rollDeg?.toFixed(2)}</td>
              <td>{liveScalar?.groundSpeedMps === null || liveScalar === null ? 'N/A' : liveScalar.groundSpeedMps?.toFixed(2)}</td>
              <td>{liveScalar?.climbMps === null || liveScalar === null ? 'N/A' : liveScalar.climbMps?.toFixed(2)}</td>
              <td>{liveVector2d?.trackDeg === null || liveVector2d === null ? 'N/A' : liveVector2d.trackDeg?.toFixed(2)}</td>
              <td>{liveVector3d?.flightPathAngleDeg === null || liveVector3d === null ? 'N/A' : liveVector3d.flightPathAngleDeg?.toFixed(2)}</td>
              <td>{livePredictive === null ? 'N/A' : livePredictive.source}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>Heading Resolver Replay</h2>
          <p className="panel-subtitle">Primary source VFR_HUD.heading, then ATTITUDE.yaw, then GLOBAL_POSITION_INT.hdg.</p>
        </div>
        <table className="mapping-table heading-table">
          <thead>
            <tr>
              <th>Frame</th>
              <th>Expected</th>
              <th>Resolved</th>
              <th>Source</th>
              <th>Fallback</th>
              <th>Error (deg)</th>
            </tr>
          </thead>
          <tbody>
            {headingReplay.map((row) => {
              const expected = row.expectedHeadingDeg === null ? 'N/A' : row.expectedHeadingDeg.toFixed(2)
              const resolved = row.result.headingDeg === null ? 'N/A' : row.result.headingDeg.toFixed(2)
              const error = row.absoluteErrorDeg === null ? 'N/A' : row.absoluteErrorDeg.toFixed(6)

              return (
                <tr key={row.id}>
                  <td>{row.id}</td>
                  <td>{expected}</td>
                  <td>{resolved}</td>
                  <td>{row.result.source}</td>
                  <td>{row.result.isFallback ? 'yes' : 'no'}</td>
                  <td>{error}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>Attitude Horizon Replay</h2>
          <p className="panel-subtitle">Pitch displacement plus roll rotation with deterministic synthetic frames.</p>
        </div>
        <table className="mapping-table attitude-table">
          <thead>
            <tr>
              <th>Frame</th>
              <th>Pitch (exp/res)</th>
              <th>Roll (exp/res)</th>
              <th>Offset px (exp/res)</th>
              <th>Err p/r/o</th>
              <th>Horizon Preview</th>
            </tr>
          </thead>
          <tbody>
            {attitudeReplay.map((row) => {
              const expectedPitch = row.expectedPitchDeg === null ? 'N/A' : row.expectedPitchDeg.toFixed(2)
              const expectedRoll = row.expectedRollDeg === null ? 'N/A' : row.expectedRollDeg.toFixed(2)
              const expectedOffset = row.expectedPitchOffsetPx === null ? 'N/A' : row.expectedPitchOffsetPx.toFixed(2)

              const resolvedPitch = row.transform === null ? 'N/A' : row.transform.pitchDeg.toFixed(2)
              const resolvedRoll = row.transform === null ? 'N/A' : row.transform.rollDeg.toFixed(2)
              const resolvedOffset = row.transform === null ? 'N/A' : row.transform.pitchOffsetPx.toFixed(2)

              const errors =
                row.transform === null
                  ? 'N/A'
                  : `${row.pitchErrorDeg?.toFixed(6)} / ${row.rollErrorDeg?.toFixed(6)} / ${row.pitchOffsetErrorPx?.toFixed(6)}`

              return (
                <tr key={row.id}>
                  <td>{row.id}</td>
                  <td>{`${expectedPitch} / ${resolvedPitch}`}</td>
                  <td>{`${expectedRoll} / ${resolvedRoll}`}</td>
                  <td>{`${expectedOffset} / ${resolvedOffset}`}</td>
                  <td>{errors}</td>
                  <td>
                    {row.transform === null ? (
                      <span>N/A</span>
                    ) : (
                      <HorizonPreview
                        x1={row.transform.start.x}
                        y1={row.transform.start.y}
                        x2={row.transform.end.x}
                        y2={row.transform.end.y}
                      />
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>Flight Path 3D + Predictive Replay</h2>
          <p className="panel-subtitle">Ground speed/climb, 2D track, FPA from vz, and 5-second linear vs turn-aware path endpoints.</p>
        </div>
        <table className="mapping-table flight-table">
          <thead>
            <tr>
              <th>Frame</th>
              <th>Track exp/res</th>
              <th>Speed m/s exp/res</th>
              <th>Climb m/s exp/res</th>
              <th>FPA deg exp/res</th>
              <th>Vector source (2d/3d)</th>
              <th>Scalar source (spd/climb)</th>
              <th>Predictive src</th>
              <th>Linear end N,E exp/res</th>
              <th>Turn end N,E exp/res</th>
              <th>Valid (2d/3d/pred)</th>
              <th>Err t/s/c/f/l/t</th>
              <th>Path Preview</th>
            </tr>
          </thead>
          <tbody>
            {flightPathReplay.map((row) => {
              const expectedTrack = row.expectedTrackDeg === null ? 'N/A' : row.expectedTrackDeg.toFixed(2)
              const resolvedTrack = row.vector2d.trackDeg === null ? 'N/A' : row.vector2d.trackDeg.toFixed(2)

              const expectedSpeed = row.expectedSpeedMps === null ? 'N/A' : row.expectedSpeedMps.toFixed(2)
              const resolvedSpeed = row.scalar.groundSpeedMps === null ? 'N/A' : row.scalar.groundSpeedMps.toFixed(2)

              const expectedClimb = row.expectedClimbMps === null ? 'N/A' : row.expectedClimbMps.toFixed(2)
              const resolvedClimb = row.scalar.climbMps === null ? 'N/A' : row.scalar.climbMps.toFixed(2)

              const expectedFpa = row.expectedFpaDeg === null ? 'N/A' : row.expectedFpaDeg.toFixed(2)
              const resolvedFpa = row.vector3d.flightPathAngleDeg === null ? 'N/A' : row.vector3d.flightPathAngleDeg.toFixed(2)

              const linearEnd = row.predictive.linear.at(-1)
              const turnEnd = row.predictive.turnAware.at(-1)

              const expectedLinearEnd =
                row.expectedLinearEndNorthM === null || row.expectedLinearEndEastM === null
                  ? 'N/A'
                  : `${row.expectedLinearEndNorthM.toFixed(2)}, ${row.expectedLinearEndEastM.toFixed(2)}`
              const resolvedLinearEnd =
                linearEnd === undefined
                  ? 'N/A'
                  : `${linearEnd.northM.toFixed(2)}, ${linearEnd.eastM.toFixed(2)}`

              const expectedTurnEnd =
                row.expectedTurnEndNorthM === null || row.expectedTurnEndEastM === null
                  ? 'N/A'
                  : `${row.expectedTurnEndNorthM.toFixed(2)}, ${row.expectedTurnEndEastM.toFixed(2)}`
              const resolvedTurnEnd =
                turnEnd === undefined
                  ? 'N/A'
                  : `${turnEnd.northM.toFixed(2)}, ${turnEnd.eastM.toFixed(2)}`

              const errors = [
                row.trackErrorDeg === null ? 'N/A' : row.trackErrorDeg.toFixed(6),
                row.speedErrorMps === null ? 'N/A' : row.speedErrorMps.toFixed(6),
                row.climbErrorMps === null ? 'N/A' : row.climbErrorMps.toFixed(6),
                row.fpaErrorDeg === null ? 'N/A' : row.fpaErrorDeg.toFixed(6),
                row.linearEndErrorM === null ? 'N/A' : row.linearEndErrorM.toFixed(6),
                row.turnEndErrorM === null ? 'N/A' : row.turnEndErrorM.toFixed(6),
              ].join(' / ')

              return (
                <tr key={row.id}>
                  <td>{row.id}</td>
                  <td>{`${expectedTrack} / ${resolvedTrack}`}</td>
                  <td>{`${expectedSpeed} / ${resolvedSpeed}`}</td>
                  <td>{`${expectedClimb} / ${resolvedClimb}`}</td>
                  <td>{`${expectedFpa} / ${resolvedFpa}`}</td>
                  <td>{`${row.vector2d.source} / ${row.vector3d.source}`}</td>
                  <td>{`${row.scalar.speedSource} / ${row.scalar.climbSource}`}</td>
                  <td>{row.predictive.source}</td>
                  <td>{`${expectedLinearEnd} / ${resolvedLinearEnd}`}</td>
                  <td>{`${expectedTurnEnd} / ${resolvedTurnEnd}`}</td>
                  <td>{`${row.vector2d.isValid ? 'yes' : 'no'} / ${row.vector3d.isValid ? 'yes' : 'no'} / ${row.predictive.isValid ? 'yes' : 'no'}`}</td>
                  <td>{errors}</td>
                  <td>
                    {row.predictive.isValid ? (
                      <PathPreview linear={row.predictive.linear} turnAware={row.predictive.turnAware} />
                    ) : (
                      <span>N/A</span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>Canonical MAVLink Field Registry</h2>
          <p className="panel-subtitle">Source field map used to drive feature-by-feature validation milestones.</p>
        </div>
        <table className="mapping-table registry-table">
          <thead>
            <tr>
              <th>Key</th>
              <th>Message</th>
              <th>Field</th>
              <th>Units</th>
              <th>Value Type</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {MAVLINK_FIELD_KEYS.map((key) => {
              const entry = MAVLINK_FIELDS[key]

              return (
                <tr key={key}>
                  <td>{key}</td>
                  <td>{entry.message}</td>
                  <td>{entry.field}</td>
                  <td>{entry.units}</td>
                  <td>{entry.valueType}</td>
                  <td>{entry.notes}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </section>
    </>
  )
}

export default ValidatorView
