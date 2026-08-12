# Terrain and Future 3D Map Notes

The GCS currently renders a 2D operational map. A terrain-aware 3D scene is a future
operator-view capability, not a prerequisite for the receive-only MAVLink bridge or the
mixed-SITL acceptance harness.

## ArduPilot terrain data is a separate concern

ArduPilot's [Terrain Generator](https://terrain.ardupilot.org/) creates terrain files for
an autopilot SD card. They support ArduPilot terrain-awareness behavior; they are **not**
a web-map terrain API and must not be treated as the data source for a browser 3D map.

The generator offers:

| Dataset | Horizontal resolution | Coverage | ArduPilot setting |
| --- | --- | --- | --- |
| SRTM1 | 30 m / 1 arc-second | 84° N to 84° S | `TERRAIN_SPACING=30` |
| SRTM3 | 100 m / 3 arc-second | 84° N to 84° S | default `TERRAIN_SPACING=100` |

The [continent SRTM3 archive](https://terrain.ardupilot.org/continentsdat3/) is useful
when provisioning a real vehicle, but is intentionally large (roughly 52 MB to 5 GB per
archive at time of writing). Do not commit, bake into Docker images, or download it as
part of the regular GCS/SITL build.

## Implications for this project

- **SITL:** terrain files are optional. The mixed Copter + Plane scenario validates
  MAVLink ingest, identity, mission routing, and replay; it does not validate
  terrain-following behavior.
- **Autopilot provisioning:** if a future test or field vehicle needs ArduPilot terrain
  awareness, generate/download only the local operating area and place the resulting
  `.DAT` files on that vehicle's SD card. Match `TERRAIN_SPACING` to the selected dataset.
- **Browser 3D view:** choose a rendering-oriented terrain service/format separately
  (for example, raster-dem terrain tiles or quantized-mesh terrain) with explicit
  licensing, offline-cache, bandwidth, and elevation-datum decisions. The UI should
  consume a map-scene adapter, not raw ArduPilot `.DAT` files.
- **Telemetry contract:** retain latitude, longitude, altitude, heading, track, and
  mission waypoints as the integration boundary. A future scene adapter can project
  those values onto terrain without changing the bridge's MAVLink decoding or the
  canonical telemetry model.

## Future design gate

Before implementing 3D maps, write a short design covering:

1. rendering library and terrain provider;
2. altitude datum and conversion policy (MAVLink altitude, terrain elevation, and
   camera/scene height must use compatible references);
3. online versus offline terrain-cache behavior and download budgets;
4. degraded behavior when terrain is unavailable; and
5. whether the scene is visual context only or is allowed to influence operational
   warnings.

Until that gate is complete, the 2D map remains the operationally authoritative view.
