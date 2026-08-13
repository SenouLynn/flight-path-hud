#!/usr/bin/env python3
"""Explicit, test-only motion controller for the mixed ArduPilot SITL scenario."""

from __future__ import annotations

import argparse
import math
import signal
import sys
import time
from dataclasses import dataclass, field


EARTH_RADIUS_M = 6_371_000


def distance_m(first, second):
    """Great-circle distance between two (latitude, longitude) degree pairs."""
    lat1, lon1 = map(math.radians, first)
    lat2, lon2 = map(math.radians, second)
    dlat, dlon = lat2 - lat1, lon2 - lon1
    a = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 2 * EARTH_RADIUS_M * math.asin(math.sqrt(a))


def parse_vehicle(value):
    parts = value.split(",")
    if len(parts) != 4:
        raise argparse.ArgumentTypeError("vehicle must be NAME,ENDPOINT,SYSID,COMPID")
    name, endpoint, system, component = parts
    try:
        system, component = int(system), int(component)
    except ValueError as error:
        raise argparse.ArgumentTypeError("SYSID and COMPID must be integers") from error
    if not name or not endpoint or not 1 <= system <= 255 or not 1 <= component <= 255:
        raise argparse.ArgumentTypeError("invalid vehicle name, endpoint, or target IDs")
    return Vehicle(name, endpoint, system, component)


@dataclass
class Vehicle:
    name: str
    endpoint: str
    system: int
    component: int
    connection: object = field(default=None, repr=False)
    initial_position: tuple | None = None
    position: tuple | None = None
    max_displacement_m: float = 0
    max_mission_seq: int = 0
    relative_altitude_m: float = 0
    armed: bool = False
    started: bool = False
    arm_command_sent: bool = False

    def accept(self, message):
        if message.get_srcSystem() != self.system or message.get_srcComponent() != self.component:
            return False
        kind = message.get_type()
        if kind == "GLOBAL_POSITION_INT":
            position = (message.lat / 1e7, message.lon / 1e7)
            self.position = position
            if self.initial_position is None and position != (0, 0):
                self.initial_position = position
            if self.initial_position is not None:
                self.max_displacement_m = max(self.max_displacement_m, distance_m(self.initial_position, position))
            self.relative_altitude_m = getattr(message, "relative_alt", 0) / 1000
        elif kind == "MISSION_CURRENT":
            self.max_mission_seq = max(self.max_mission_seq, message.seq)
        return True


def wait_for_heartbeat(vehicle, mavutil, deadline):
    while time.monotonic() < deadline:
        message = vehicle.connection.recv_match(type="HEARTBEAT", blocking=True, timeout=1)
        if message is None:
            continue
        if not vehicle.accept(message):
            raise RuntimeError(
                f"{vehicle.name} channel received unexpected target "
                f"{message.get_srcSystem()}:{message.get_srcComponent()}"
            )
        mapping = vehicle.connection.mode_mapping()
        if not mapping or "AUTO" not in mapping or "GUIDED" not in mapping:
            raise RuntimeError(f"{vehicle.name} does not advertise AUTO and GUIDED modes")
        print(f"{vehicle.name}: heartbeat from explicit target {vehicle.system}:{vehicle.component}", flush=True)
        return mapping["AUTO"], mapping["GUIDED"]
    raise TimeoutError(f"{vehicle.name}: heartbeat timeout")


def wait_for_position(vehicle, deadline):
    while time.monotonic() < deadline:
        message = vehicle.connection.recv_match(type="GLOBAL_POSITION_INT", blocking=True, timeout=1)
        if message is not None and vehicle.accept(message) and vehicle.initial_position is not None:
            print(f"{vehicle.name}: initialized at {vehicle.initial_position[0]:.7f},{vehicle.initial_position[1]:.7f}", flush=True)
            return
    raise TimeoutError(f"{vehicle.name}: global-position readiness timeout")


def enter_mode(vehicle, mode, label, deadline):
    next_attempt = 0
    while time.monotonic() < deadline:
        now = time.monotonic()
        if now >= next_attempt:
            vehicle.connection.set_mode(mode)
            next_attempt = now + 2
        heartbeat = vehicle.connection.recv_match(type="HEARTBEAT", blocking=True, timeout=1)
        if heartbeat is not None and vehicle.accept(heartbeat) and heartbeat.custom_mode == mode:
            print(f"{vehicle.name}: {label} verified", flush=True)
            return
    raise TimeoutError(f"{vehicle.name}: failed to enter {label}")


def start_vehicle(vehicle, auto_mode, guided_mode, mavutil, deadline):
    # GUIDED is a position-gated mode on both vehicles. Its verified heartbeat
    # is a stronger readiness signal than the first position packet alone.
    enter_mode(vehicle, guided_mode, "GUIDED", deadline)
    vehicle.arm_command_sent = True
    next_attempt = 0
    while time.monotonic() < deadline:
        now = time.monotonic()
        if now >= next_attempt:
            # GPS can begin publishing shortly before EKF/pre-arm readiness.
            # Retry the tightly scoped arm command; Copter deliberately
            # refuses arming in AUTO, hence the GUIDED staging mode above.
            vehicle.connection.mav.command_long_send(
                vehicle.system, vehicle.component,
                mavutil.mavlink.MAV_CMD_COMPONENT_ARM_DISARM,
                0, 1, 0, 0, 0, 0, 0, 0,
            )
            next_attempt = now + 2
        heartbeat = vehicle.connection.recv_match(type="HEARTBEAT", blocking=True, timeout=1)
        if heartbeat is None or not vehicle.accept(heartbeat):
            continue
        vehicle.armed = bool(heartbeat.base_mode & mavutil.mavlink.MAV_MODE_FLAG_SAFETY_ARMED)
        if vehicle.armed:
            vehicle.started = True
            print(f"{vehicle.name}: armed; requesting AUTO", flush=True)
            break
    else:
        raise TimeoutError(f"{vehicle.name}: failed to arm")

    if vehicle.name == "copter":
        vehicle.connection.mav.command_long_send(
            vehicle.system, vehicle.component,
            mavutil.mavlink.MAV_CMD_NAV_TAKEOFF,
            0, 0, 0, 0, 0, 0, 0, 35,
        )
        while time.monotonic() < deadline:
            message = vehicle.connection.recv_match(type="GLOBAL_POSITION_INT", blocking=True, timeout=1)
            if message is not None and vehicle.accept(message) and vehicle.relative_altitude_m >= 10:
                print(f"{vehicle.name}: GUIDED takeoff verified at {vehicle.relative_altitude_m:.1f}m", flush=True)
                vehicle.connection.mav.mission_set_current_send(vehicle.system, vehicle.component, 2)
                break
        else:
            raise TimeoutError(f"{vehicle.name}: GUIDED takeoff failed")

    enter_mode(vehicle, auto_mode, "AUTO", deadline)


def stop_vehicle(vehicle, mavutil):
    if vehicle.connection is None or not vehicle.arm_command_sent:
        return
    # This force-disarm is intentionally confined to disposable SITL containers.
    vehicle.connection.mav.command_long_send(
        vehicle.system, vehicle.component,
        mavutil.mavlink.MAV_CMD_COMPONENT_ARM_DISARM,
        0, 0, 21196, 0, 0, 0, 0, 0,
    )
    print(f"{vehicle.name}: cleanup force-disarm sent to {vehicle.system}:{vehicle.component}", flush=True)


def sample_motion(vehicles, minimum_separation_m):
    """Fold current motion data and enforce separation for every live phase."""
    for vehicle in vehicles:
        while True:
            message = vehicle.connection.recv_match(
                type=["GLOBAL_POSITION_INT", "MISSION_CURRENT"], blocking=False
            )
            if message is None:
                break
            vehicle.accept(message)

    if not all(vehicle.position is not None for vehicle in vehicles):
        return float("nan")

    separation = distance_m(vehicles[0].position, vehicles[1].position)
    if separation < minimum_separation_m:
        raise RuntimeError(f"vehicles breached separation floor: {separation:.1f} m")
    return separation


def run(args):
    from pymavlink import mavutil

    deadline = time.monotonic() + args.timeout
    for vehicle in args.vehicle:
        vehicle.connection = mavutil.mavlink_connection(
            vehicle.endpoint,
            source_system=254,
            source_component=191,
            dialect="ardupilotmega",
        )

    modes = {vehicle.name: wait_for_heartbeat(vehicle, mavutil, deadline) for vehicle in args.vehicle}
    for vehicle in args.vehicle:
        wait_for_position(vehicle, deadline)
    for vehicle in args.vehicle:
        auto_mode, guided_mode = modes[vehicle.name]
        start_vehicle(vehicle, auto_mode, guided_mode, mavutil, deadline)

    last_report = 0
    while time.monotonic() < deadline:
        separation = sample_motion(args.vehicle, args.minimum_separation_m)

        now = time.monotonic()
        if now - last_report >= 5:
            status = ", ".join(
                f"{v.name} displacement={v.max_displacement_m:.1f}m mission={v.max_mission_seq}"
                for v in args.vehicle
            )
            print(f"motion: {status}; separation={separation:.1f}m", flush=True)
            last_report = now

        if all(v.max_displacement_m >= args.minimum_displacement_m and v.max_mission_seq >= 1 for v in args.vehicle):
            print("motion acceptance passed for every explicit target", flush=True)
            observation_deadline = time.monotonic() + args.observation_seconds
            print(
                f"continuing for a {args.observation_seconds:g}s browser observation window",
                flush=True,
            )
            while time.monotonic() < observation_deadline:
                sample_motion(args.vehicle, args.minimum_separation_m)
                time.sleep(0.05)
            print("browser observation window complete", flush=True)
            return
        time.sleep(0.05)
    failures = ", ".join(
        f"{v.name}={v.max_displacement_m:.1f}m/mission-{v.max_mission_seq}" for v in args.vehicle
    )
    raise TimeoutError(f"motion acceptance timeout: {failures}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--vehicle", action="append", required=True, type=parse_vehicle)
    parser.add_argument("--minimum-displacement-m", type=float, default=75)
    parser.add_argument("--minimum-separation-m", type=float, default=150)
    parser.add_argument("--timeout", type=float, default=180)
    parser.add_argument("--observation-seconds", type=float, default=45)
    args = parser.parse_args()
    if len(args.vehicle) != 2:
        parser.error("the mixed motion scenario requires exactly two vehicles")

    stopping = False
    def request_stop(_signum, _frame):
        nonlocal stopping
        stopping = True
        raise KeyboardInterrupt
    signal.signal(signal.SIGTERM, request_stop)
    signal.signal(signal.SIGINT, request_stop)

    try:
        run(args)
    finally:
        try:
            from pymavlink import mavutil
            for vehicle in args.vehicle:
                stop_vehicle(vehicle, mavutil)
        except Exception as error:
            print(f"cleanup error: {error}", file=sys.stderr, flush=True)
        if stopping:
            print("motion controller stopped by signal", flush=True)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(130)
    except Exception as error:
        print(f"motion scenario failed: {error}", file=sys.stderr, flush=True)
        sys.exit(1)
