#!/usr/bin/env bash
set -euo pipefail

: "${VEHICLE:?VEHICLE is required}"
: "${SYSID:?SYSID is required}"
: "${MISSION_FILE:?MISSION_FILE is required}"

if ! command -v mavproxy.py >/dev/null 2>&1; then
  echo "SITL image is missing mavproxy.py on PATH: ${PATH}" >&2
  exit 127
fi

# Start SITL without MAVProxy first. `sim_vehicle.py` owns the simulator process;
# the explicit seeder below waits for its heartbeat before exercising the real
# MAVLink mission transaction.
cd /opt/ardupilot
Tools/autotest/sim_vehicle.py \
  --vehicle "${VEHICLE}" \
  --sysid "${SYSID}" \
  --location CMAC \
  --no-extra-ports \
  --no-mavproxy \
  --no-rebuild &

# The no-MAVProxy supervisor blocks while SITL is live, so it must run in the
# background while this script owns the forwarding process below.
sitl_supervisor_pid=$!

cleanup() {
  kill "${sitl_supervisor_pid}" 2>/dev/null || true
  wait "${sitl_supervisor_pid}" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

/usr/local/bin/sitl-seed-mission --mission "${MISSION_FILE}"

# MAVProxy is the persistent MAVLink fan-out hop. In daemon mode it is independent
# of the container's closed stdin; the no-MAVProxy supervisor remains this
# container's foreground process and owns the simulator lifetime.
mavproxy.py \
  --master tcp:127.0.0.1:5760 \
  --sitl 127.0.0.1:5501 \
  --out udp:bridge:14550 \
  --non-interactive \
  --daemon

wait "${sitl_supervisor_pid}"
