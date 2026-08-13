import argparse
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from motion_controller import Vehicle, distance_m, parse_vehicle


class FakeMessage:
    def __init__(self, kind, system=1, component=1, **values):
        self.kind = kind
        self.system = system
        self.component = component
        self.__dict__.update(values)

    def get_type(self):
        return self.kind

    def get_srcSystem(self):
        return self.system

    def get_srcComponent(self):
        return self.component


class MotionControllerTests(unittest.TestCase):
    def test_distance(self):
        self.assertAlmostEqual(distance_m((0, 0), (0, 0.001)), 111.2, delta=0.2)

    def test_parse_vehicle_requires_explicit_valid_target(self):
        vehicle = parse_vehicle("copter,udpin:0.0.0.0:14601,1,1")
        self.assertEqual((vehicle.name, vehicle.system, vehicle.component), ("copter", 1, 1))
        with self.assertRaises(argparse.ArgumentTypeError):
            parse_vehicle("copter,endpoint,0,1")

    def test_vehicle_rejects_cross_system_data(self):
        vehicle = Vehicle("copter", "endpoint", 1, 1)
        accepted = vehicle.accept(FakeMessage("GLOBAL_POSITION_INT", system=2, lat=1, lon=1))
        self.assertFalse(accepted)
        self.assertIsNone(vehicle.position)

    def test_vehicle_tracks_displacement_and_mission_progress(self):
        vehicle = Vehicle("copter", "endpoint", 1, 1)
        vehicle.accept(FakeMessage("GLOBAL_POSITION_INT", lat=0, lon=10_000_000))
        vehicle.accept(FakeMessage("GLOBAL_POSITION_INT", lat=0, lon=10_010_000))
        vehicle.accept(FakeMessage("MISSION_CURRENT", seq=2))
        self.assertAlmostEqual(vehicle.max_displacement_m, 111.2, delta=0.2)
        self.assertEqual(vehicle.max_mission_seq, 2)


if __name__ == "__main__":
    unittest.main()
