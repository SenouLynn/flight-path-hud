#!/usr/bin/env python3
"""Put disposable Copter and Plane SITL vehicles safely in airborne Guided state."""

import signal
import time
from dataclasses import dataclass
from pymavlink import mavutil


@dataclass
class Vehicle:
    name: str
    endpoint: str
    system: int
    component: int = 1
    connection: object = None
    armed: bool = False


vehicles = [Vehicle("copter", "udpin:0.0.0.0:14611", 1),
            Vehicle("plane", "udpin:0.0.0.0:14612", 2)]
stopping = False


def receive(vehicle, kinds, timeout=1):
    message = vehicle.connection.recv_match(type=kinds, blocking=True, timeout=timeout)
    if message is None:
        return None
    if message.get_srcSystem() != vehicle.system or message.get_srcComponent() != vehicle.component:
        raise RuntimeError(f"{vehicle.name}: unexpected source {message.get_srcSystem()}:{message.get_srcComponent()}")
    return message


def wait_heartbeat(vehicle, deadline):
    while time.monotonic() < deadline:
        heartbeat = receive(vehicle, "HEARTBEAT")
        if heartbeat is not None:
            mapping = vehicle.connection.mode_mapping()
            if mapping and "GUIDED" in mapping and "AUTO" in mapping:
                return mapping
    raise TimeoutError(f"{vehicle.name}: heartbeat/mode readiness timeout")


def set_mode(vehicle, mode, deadline):
    next_attempt = 0
    while time.monotonic() < deadline:
        now = time.monotonic()
        if now >= next_attempt:
            vehicle.connection.set_mode(mode)
            next_attempt = now + 2
        heartbeat = receive(vehicle, "HEARTBEAT")
        if heartbeat is not None and heartbeat.custom_mode == mode:
            print(f"{vehicle.name}: mode {mode} verified", flush=True)
            return
    raise TimeoutError(f"{vehicle.name}: mode transition timeout")


def arm(vehicle, deadline):
    next_attempt = 0
    while time.monotonic() < deadline:
        now = time.monotonic()
        if now >= next_attempt:
            vehicle.connection.mav.command_long_send(vehicle.system, vehicle.component,
                mavutil.mavlink.MAV_CMD_COMPONENT_ARM_DISARM, 0, 1, 0, 0, 0, 0, 0, 0)
            next_attempt = now + 2
        heartbeat = receive(vehicle, "HEARTBEAT")
        if heartbeat is not None and heartbeat.base_mode & mavutil.mavlink.MAV_MODE_FLAG_SAFETY_ARMED:
            vehicle.armed = True
            print(f"{vehicle.name}: armed", flush=True)
            return
    raise TimeoutError(f"{vehicle.name}: arm timeout")


def wait_altitude(vehicle, minimum_m, deadline):
    while time.monotonic() < deadline:
        position = receive(vehicle, "GLOBAL_POSITION_INT")
        if position is not None and position.relative_alt / 1000 >= minimum_m:
            print(f"{vehicle.name}: airborne at {position.relative_alt / 1000:.1f}m", flush=True)
            return
    raise TimeoutError(f"{vehicle.name}: takeoff timeout")


def setup(deadline):
    modes = {}
    for vehicle in vehicles:
        vehicle.connection = mavutil.mavlink_connection(vehicle.endpoint, source_system=254,
            source_component=191, dialect="ardupilotmega")
        modes[vehicle.name] = wait_heartbeat(vehicle, deadline)
    time.sleep(10)  # GPS can publish before EKF/pre-arm readiness.

    copter, plane = vehicles
    set_mode(copter, modes["copter"]["GUIDED"], deadline)
    arm(copter, deadline)
    copter.connection.mav.command_long_send(copter.system, copter.component,
        mavutil.mavlink.MAV_CMD_NAV_TAKEOFF, 0, 0, 0, 0, 0, 0, 0, 30)
    wait_altitude(copter, 15, deadline)

    set_mode(plane, modes["plane"]["GUIDED"], deadline)
    arm(plane, deadline)
    set_mode(plane, modes["plane"]["AUTO"], deadline)
    wait_altitude(plane, 30, deadline)
    set_mode(plane, modes["plane"]["GUIDED"], deadline)
    print("guided flight setup ready for both explicit targets", flush=True)


def cleanup():
    for vehicle in vehicles:
        if vehicle.connection is None or not vehicle.armed:
            continue
        vehicle.connection.mav.command_long_send(vehicle.system, vehicle.component,
            mavutil.mavlink.MAV_CMD_COMPONENT_ARM_DISARM, 0, 0, 21196, 0, 0, 0, 0, 0)
        print(f"{vehicle.name}: disposable-SITL cleanup force-disarm sent", flush=True)


def stop(_signum, _frame):
    global stopping
    stopping = True


for signal_name in (signal.SIGINT, signal.SIGTERM):
    signal.signal(signal_name, stop)
try:
    setup(time.monotonic() + 180)
    while not stopping:
        time.sleep(0.2)
finally:
    cleanup()
