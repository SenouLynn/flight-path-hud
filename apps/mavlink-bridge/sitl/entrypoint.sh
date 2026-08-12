#!/usr/bin/env bash
set -euo pipefail

: "${VEHICLE:?VEHICLE is required}"
: "${SYSID:?SYSID is required}"
: "${MISSION_FILE:?MISSION_FILE is required}"

# MAVProxy is both the mission loader and the MAVLink router. Its UDP output has
# one source endpoint per simulator, which is what lets bridge routing remain
# system-addressed in a mixed fleet.
cd /opt/ardupilot
exec Tools/autotest/sim_vehicle.py \
  --vehicle "${VEHICLE}" \
  --sysid "${SYSID}" \
  --no-extra-ports \
  --out udp:bridge:14550 \
  --mavproxy-args="--cmd=wp load ${MISSION_FILE}" \
  --no-rebuild
