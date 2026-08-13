#!/usr/bin/env python3
"""Independent proof consumer for the portable heading vectors; not product code."""

import json
import math
from pathlib import Path


def resolve_heading(sample):
    vfr_heading = sample.get("vfrHud", {}).get("headingDeg")
    if isinstance(vfr_heading, (int, float)) and math.isfinite(vfr_heading):
        return vfr_heading % 360, "VFR_HUD.heading", False

    yaw_rad = sample.get("attitude", {}).get("yawRad")
    if isinstance(yaw_rad, (int, float)) and math.isfinite(yaw_rad):
        return math.degrees(yaw_rad) % 360, "ATTITUDE.yaw", True

    heading_cdeg = sample.get("globalPositionInt", {}).get("headingCdeg")
    if (isinstance(heading_cdeg, (int, float)) and math.isfinite(heading_cdeg)
            and heading_cdeg != 65535):
        return (heading_cdeg / 100) % 360, "GLOBAL_POSITION_INT.hdg", True

    return None, "none", False


def main():
    vector_path = Path(__file__).parents[1] / "semantics" / "heading-cases.json"
    cases = json.loads(vector_path.read_text(encoding="utf-8"))
    failures = []
    for case in cases:
        heading, source, is_fallback = resolve_heading(case["sample"])
        expected = case["expectedHeadingDeg"]
        numeric_match = heading is None and expected is None
        if heading is not None and expected is not None:
            numeric_match = abs(heading - expected) <= case["toleranceDeg"]
        if not numeric_match or source != case["expectedSource"] or is_fallback != case["expectedIsFallback"]:
            failures.append(case["id"])

    if failures:
        raise SystemExit("heading conformance failed: " + ", ".join(failures))
    print(f"heading conformance passed: {len(cases)} shared vectors")


if __name__ == "__main__":
    main()
