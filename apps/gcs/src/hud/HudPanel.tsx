/**
 * The Unified HUD display panel, driven by the same fold that feeds the map.
 *
 * Instruments come from @flight-path-hud/hud-ui — the package the web harness
 * also renders — so the GCS and the validation harness can never drift. The
 * sample arrives already merged by gcs-core; nothing is resolved here beyond
 * what the instruments' own props require.
 */

import {
  HudFlightPathRecorder,
  HudHeadingIndicator,
  HudOrientationIndicator,
  HudUnifiedInstrument,
  resolveAttitude,
  resolveHeading,
  type TelemetrySample,
  type TrackPoint,
} from '@flight-path-hud/hud-ui'

const RAD_TO_DEG = 180 / Math.PI

// Aspect ratios only — CSS scales these to the pane. Kept tallish because the
// unified instrument sits in a narrow two-thirds column.
const UNIFIED_WIDTH = 800
const UNIFIED_HEIGHT = 700
const HEADING_HEIGHT = 30
const SIDE_WIDTH = 360
const SIDE_HEIGHT = 300

interface HudPanelProps {
  sample: TelemetrySample | null
  /** ENU breadcrumb for the recorder — distinct from the map's lat/lon trail. */
  track: TrackPoint[]
}

export function HudPanel({ sample, track }: HudPanelProps) {  const heading = sample === null ? null : resolveHeading(sample)
  const attitude = sample === null ? null : resolveAttitude(sample)
  const yawDeg = sample?.attitude?.yawRad === undefined ? null : sample.attitude.yawRad * RAD_TO_DEG

  return (
    <div className="hud-overlay">
      {/*
        The heading tape is a separate instrument stacked above the unified one —
        the fused-shell wrapper is what pairs them, matching the web harness.
      */}
      <div className="hud-primary">
        <div className="hud-fused-shell hud-fused-shell-screen">
          <div className="hud-main-row hud-main-row-screen">
            <HudHeadingIndicator
              headingDeg={heading?.headingDeg ?? null}
              width={UNIFIED_WIDTH}
              height={HEADING_HEIGHT}
            />
          </div>
          <div className="hud-secondary-card hud-secondary-card-screen">
            <HudUnifiedInstrument sample={sample} width={UNIFIED_WIDTH} height={UNIFIED_HEIGHT} />
          </div>
        </div>
      </div>

      <div className="hud-side">
        <div className="hud-secondary-card">
          <HudOrientationIndicator
            rollDeg={attitude?.rollDeg ?? null}
            pitchDeg={attitude?.pitchDeg ?? null}
            yawDeg={yawDeg}
            width={SIDE_WIDTH}
            height={SIDE_HEIGHT}
          />
        </div>
        <div className="hud-secondary-card">
          <HudFlightPathRecorder
            track={track}
            source={track.length > 0 ? 'GLOBAL_POSITION_INT.lla_enu' : 'none'}
            width={SIDE_WIDTH}
            height={SIDE_HEIGHT}
          />
        </div>
      </div>

      {/*
        Reserved full-width row beneath the instruments. The instrument row is
        content-sized, so leftover height collects here rather than padding out
        each pane — which is what centred the instruments before.
      */}
      <div className="hud-shadow" aria-hidden="true" />
    </div>
  )
}
