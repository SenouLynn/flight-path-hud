#!/usr/bin/env python3
"""Load one QGC WPL 110 mission after a SITL vehicle has announced itself.

MAVProxy's startup commands run before a vehicle connection is guaranteed, which
makes ``--cmd='wp load …'`` racy in headless containers. This small SITL-only
helper performs the normal MAVLink mission-count/request/item/ack exchange after
observing a heartbeat, then leaves MAVProxy to be the long-running forwarding hop.
"""

import argparse
import sys
import time

from pymavlink import mavutil


def read_qgc_wpl(path):
    with open(path, encoding="utf-8") as source:
        lines = [line.strip() for line in source if line.strip()]

    if not lines or lines[0] != "QGC WPL 110":
        raise ValueError(f"{path} is not a QGC WPL 110 mission")

    items = []
    for line in lines[1:]:
        fields = line.split()
        if len(fields) != 12:
            raise ValueError(f"invalid waypoint row: {line}")
        seq, current, frame, command = map(int, fields[:4])
        params = list(map(float, fields[4:8]))
        lat, lon, alt = map(float, fields[8:11])
        autocontinue = int(fields[11])
        if seq != len(items):
            raise ValueError(f"waypoint sequence must be contiguous from zero; got {seq}")
        items.append({
            "seq": seq,
            "current": current,
            "frame": frame,
            "command": command,
            "params": params,
            "lat": lat,
            "lon": lon,
            "alt": alt,
            "autocontinue": autocontinue,
        })
    return items


def connect_and_wait(endpoint, timeout_seconds):
    deadline = time.monotonic() + timeout_seconds
    last_error = None
    while time.monotonic() < deadline:
        try:
            master = mavutil.mavlink_connection(
                endpoint,
                source_system=255,
                source_component=190,
                dialect="ardupilotmega",
            )
            heartbeat = master.wait_heartbeat(timeout=2)
            if heartbeat is not None:
                return master, heartbeat
        except Exception as error:  # SITL TCP listener may not exist yet.
            last_error = error
        time.sleep(0.5)
    raise TimeoutError(f"no SITL heartbeat on {endpoint} within {timeout_seconds}s: {last_error}")


def send_item(master, target_system, target_component, item):
    master.mav.mission_item_int_send(
        target_system,
        target_component,
        item["seq"],
        item["frame"],
        item["command"],
        item["current"],
        item["autocontinue"],
        *item["params"],
        round(item["lat"] * 1e7),
        round(item["lon"] * 1e7),
        item["alt"],
    )


def upload(master, heartbeat, items, timeout_seconds):
    target_system = heartbeat.get_srcSystem()
    target_component = heartbeat.get_srcComponent()
    master.mav.mission_count_send(target_system, target_component, len(items))

    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        message = master.recv_match(
            type=["MISSION_REQUEST_INT", "MISSION_REQUEST", "MISSION_ACK"],
            blocking=True,
            timeout=1,
        )
        if message is None:
            continue
        kind = message.get_type()
        print(f"mission protocol: {kind}" + (f" seq={message.seq}" if hasattr(message, "seq") else ""), flush=True)
        if kind == "MISSION_ACK":
            if message.type != mavutil.mavlink.MAV_MISSION_ACCEPTED:
                raise RuntimeError(f"mission rejected with MAV_MISSION_RESULT {message.type}")
            return target_system, target_component
        sequence = message.seq
        if sequence < 0 or sequence >= len(items):
            raise RuntimeError(f"vehicle requested invalid mission sequence {sequence}")
        send_item(master, target_system, target_component, items[sequence])
    raise TimeoutError("timed out waiting for mission requests or final acknowledgement")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--master", default="tcp:127.0.0.1:5760")
    parser.add_argument("--mission", required=True)
    parser.add_argument("--timeout", type=float, default=30)
    parser.add_argument("--ready-delay", type=float, default=3)
    args = parser.parse_args()

    items = read_qgc_wpl(args.mission)
    master, heartbeat = connect_and_wait(args.master, args.timeout)
    print(f"heartbeat from {heartbeat.get_srcSystem()}:{heartbeat.get_srcComponent()}; waiting {args.ready_delay:g}s for mission storage", flush=True)
    time.sleep(args.ready_delay)
    target_system, target_component = upload(master, heartbeat, items, args.timeout)
    print(f"seeded {len(items)} mission items to {target_system}:{target_component}", flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"mission seeding failed: {error}", file=sys.stderr, flush=True)
        sys.exit(1)
