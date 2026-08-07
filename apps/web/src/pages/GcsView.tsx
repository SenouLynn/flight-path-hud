import { useMemo, useState } from 'react'
import { HudFlightPathRecorder } from '../components/HudFlightPathRecorder'
import { HudOrientationIndicator } from '../components/HudOrientationIndicator'
import { HudPredictiveTrajectory } from '../components/HudPredictiveTrajectory'
import { HudPrimaryFlightDisplay } from '../components/HudPrimaryFlightDisplay'
import { resolveAttitude } from '../logic/attitude'
import { resolveFlightPath2d, resolveFlightPath3d, resolveScalarTelemetry } from '../logic/flightPath'
import { resolveHeading } from '../logic/heading'
import {
    buildSyntheticMissionSamples,
    createLiveMockSource,
    createSyntheticReplaySource,
    type TelemetrySource,
    type TelemetrySourceId,
} from '../stream/telemetrySource'
import { useFlightTrack } from '../stream/useFlightTrack'
import { useTelemetryFeed } from '../stream/useTelemetryFeed'
import { createWsTelemetrySource } from '../stream/wsTelemetrySource'

const RAD_TO_DEG = 180 / Math.PI

function formatNullable(value: number | null, precision = 2): string {
  return value === null ? 'N/A' : value.toFixed(precision)
}

function formatSampleTimestamp(timestampMs: number | undefined): string {
  if (timestampMs === undefined) {
    return 'N/A'
  }

  return String(timestampMs)
}

function GcsView() {
  const [sourceId, setSourceId] = useState<TelemetrySourceId>('synthetic-replay')
  const [externalWsUrl, setExternalWsUrl] = useState('ws://localhost:8080/telemetry')

  const streamSamples = useMemo(() => buildSyntheticMissionSamples(60, 180), [])
  const telemetrySources = useMemo<Record<TelemetrySourceId, TelemetrySource>>(() => {
    const synthetic = createSyntheticReplaySource(streamSamples, 300)
    const liveMock = createLiveMockSource(100)
    const wsExternal = createWsTelemetrySource({
      url: externalWsUrl,
      label: 'External stream (ws)',
    })

    return {
      'synthetic-replay': synthetic,
      'live-mock': liveMock,
      'ws-external': wsExternal,
    }
  }, [externalWsUrl, streamSamples])

  const activeSource = telemetrySources[sourceId]
  const feed = useTelemetryFeed(activeSource)
  const sample = feed.latestSample

  const trackConfig = useMemo(
    () => (sourceId === 'live-mock' || sourceId === 'ws-external'
      ? { maxPoints: 600, maxAgeSec: 45 }
      : { maxPoints: 4000 }),
    [sourceId],
  )
  const flightTrack = useFlightTrack(feed, sourceId, trackConfig)

  const heading = sample === null ? null : resolveHeading(sample)
  const attitude = sample === null ? null : resolveAttitude(sample)
  const scalar = sample === null ? null : resolveScalarTelemetry(sample)
  const vector2d = sample === null ? null : resolveFlightPath2d(sample)
  const vector3d = sample === null ? null : resolveFlightPath3d(sample)
  const yawDeg = sample?.attitude?.yawRad === undefined
    ? null
    : sample.attitude.yawRad * RAD_TO_DEG

  const connectionClass = `connection-state ${feed.streamHealth.connectionState}`

  return (
    <div className="playground-layout">
      <aside className="playground-sidebar" aria-label="GCS operations controls">
        <section className="header playground-header">
          <p className="eyebrow">Ground control operations</p>
          <p className="intro">
            Receive-only telemetry view with source switching, stream health, and live instrument panes.
          </p>
        </section>

        <section className="panel playground-control-panel">
          <div className="panel-header">
            <h2>Data Source</h2>
            <p className="panel-subtitle">Switch between synthetic replay, live mock, and external WebSocket telemetry.</p>
          </div>
          <div className="adapter-controls source-controls-grid">
            <label className="adapter-control">
              <span>Source</span>
              <select value={sourceId} onChange={(event) => setSourceId(event.target.value as TelemetrySourceId)}>
                {Object.values(telemetrySources).map((source) => (
                  <option key={source.id} value={source.id}>{source.label}</option>
                ))}
              </select>
            </label>
            <div className="adapter-stat"><span>Packet cadence</span><strong>{activeSource.intervalMs <= 0 ? 'event-driven' : `${activeSource.intervalMs} ms`}</strong></div>
            <div className="adapter-stat"><span>Packets seen</span><strong>{feed.packetCount}</strong></div>
            <div className="adapter-stat"><span>Last sample ts</span><strong>{formatSampleTimestamp(sample?.timestampMs)}</strong></div>
          </div>
          {sourceId === 'ws-external' ? (
            <label className="adapter-control source-url-input">
              <span>WebSocket URL</span>
              <input
                type="text"
                value={externalWsUrl}
                onChange={(event) => setExternalWsUrl(event.target.value)}
                spellCheck={false}
              />
            </label>
          ) : null}
        </section>

        <section className="panel playground-control-panel">
          <div className="panel-header">
            <h2>Stream Health</h2>
            <p className="panel-subtitle">Connection state and decode counters for the active source.</p>
          </div>
          <div className="adapter-controls source-controls-grid">
            <div className="adapter-stat">
              <span>Connection</span>
              <strong className={connectionClass}>{feed.streamHealth.connectionState}</strong>
            </div>
            <div className="adapter-stat"><span>Packet rate</span><strong>{feed.streamHealth.packetRateHz.toFixed(0)} /s</strong></div>
            <div className="adapter-stat"><span>Decode errors</span><strong>{feed.streamHealth.decodeErrorCount}</strong></div>
            <div className="adapter-stat"><span>Dropped packets</span><strong>{feed.streamHealth.droppedPacketCount}</strong></div>
            <div className="adapter-stat"><span>Heartbeat age</span><strong>{feed.streamHealth.lastHeartbeatAgeMs} ms</strong></div>
          </div>
        </section>
      </aside>

      <div className="playground-content">
        <section className="panel">
          <div className="panel-header">
            <h2>Live Telemetry Snapshot</h2>
            <p className="panel-subtitle">Resolver outputs from the active telemetry stream.</p>
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
                <th>Vector src 2d/3d</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>{heading === null || heading.headingDeg === null ? 'N/A' : `${heading.headingDeg.toFixed(2)} / ${heading.source}`}</td>
                <td>{attitude === null ? 'N/A' : formatNullable(attitude.pitchDeg)}</td>
                <td>{attitude === null ? 'N/A' : formatNullable(attitude.rollDeg)}</td>
                <td>{scalar === null ? 'N/A' : formatNullable(scalar.groundSpeedMps)}</td>
                <td>{scalar === null ? 'N/A' : formatNullable(scalar.climbMps)}</td>
                <td>{vector2d === null ? 'N/A' : formatNullable(vector2d.trackDeg)}</td>
                <td>{vector3d === null ? 'N/A' : formatNullable(vector3d.flightPathAngleDeg)}</td>
                <td>{vector2d === null || vector3d === null ? 'N/A' : `${vector2d.source} / ${vector3d.source}`}</td>
              </tr>
            </tbody>
          </table>
        </section>

        <section className="panel">
          <div className="panel-header">
            <h2>Live Instruments</h2>
            <p className="panel-subtitle">Operational panes for attitude, orientation, predictive path, and position history.</p>
          </div>
          <div className="unified-instrument-grid-wrap">
            <div className="unified-instrument-grid">
              <div className="hud-secondary-card">
                <HudPrimaryFlightDisplay
                  headingDeg={heading?.headingDeg ?? null}
                  pitchDeg={attitude?.pitchDeg ?? null}
                  rollDeg={attitude?.rollDeg ?? null}
                  width={420}
                  headingHeight={24}
                  attitudeHeight={260}
                />
              </div>
              <div className="hud-secondary-card">
                <HudOrientationIndicator
                  rollDeg={attitude?.rollDeg ?? null}
                  pitchDeg={attitude?.pitchDeg ?? null}
                  yawDeg={yawDeg}
                  width={420}
                  height={280}
                />
              </div>
              <div className="hud-secondary-card">
                <HudPredictiveTrajectory
                  sample={sample}
                  width={420}
                  height={280}
                />
              </div>
              <div className="hud-secondary-card">
                <HudFlightPathRecorder
                  track={flightTrack.track}
                  source={flightTrack.source}
                  width={420}
                  height={280}
                />
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}

export default GcsView
