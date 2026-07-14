# Heading Indicator

## Options
1. VFR_HUD (#74) — heading, int16, degrees, 0-360, ground-course-corrected magnetic heading. This is what most HUD implementations use since it's already in degrees and pre-packaged for display purposes.
2. ATTITUDE.yaw (#30) — float, radians, -π to π, raw EKF yaw estimate (heading, not necessarily magnetic-corrected depending on EKF source).
3. GLOBAL_POSITION_INT.hdg (#33) — uint16, centidegrees (divide by 100), 0-360, vehicle heading — but note this field can report UINT16_MAX if heading is unknown, so needs a validity check.

GPS course over ground (if you want COG instead of heading): GPS_RAW_INT.cog — centidegrees, this is track-over-ground not nose-heading, only relevant if you add a COG bug alongside the heading tape.

For the visualizer: use VFR_HUD.heading as primary — it's already degrees, already magnetic-referenced, and avoids radian conversion. Fall back to ATTITUDE.yaw converted to degrees if VFR_HUD isn't streaming.

## GPS Heading
 

## Flight Path Extrapolation
Use velocity-vector data, not heading
GLOBAL_POSITION_INT (#33) — the key one:

vx, vy, vz — int16, cm/s, NED frame (North-East-Down)
Compute ground track angle: atan2(vy, vx) — this is your true extrapolated direction of travel
Compute flight path angle (climb/descent): atan2(-vz, sqrt(vx² + vy²)) — this gives you the vertical component for a proper FPM (the little circle-with-wings symbol that sits above/below the horizon line depending on climb/descent rate)

This is what real aircraft HUDs use for the velocity vector symbol — it fuses heading, wind drift, and vertical speed into a single "where you're actually headed" indicator, decoupled from where the nose is pointing.
Alternative/supplementary source: GPS_RAW_INT (#24)

vel — cm/s ground speed
cog — centidegrees, course over ground
Simpler 2D-only version if you don't need the vertical FPM component, or as a cross-check against the EKF-derived GLOBAL_POSITION_INT values

For extrapolating forward (projecting a predicted path, not just current instant)
If you want a predictive trail (e.g., "in 3 seconds you'll be here" arc), you'll want to combine the velocity vector with either:

Simple linear extrapolation: current lat/lon/alt + (vx,vy,vz × t) for a few seconds — cheap, decent for short lookaheads, breaks down in turns
Turn-aware extrapolation: incorporate ATTITUDE.yawspeed (turn rate) to curve the projected path — much better for your fixed-wing/QuadPlane since it banks into turns, and a straight-line projection during a bank will look visually wrong on the HUD
