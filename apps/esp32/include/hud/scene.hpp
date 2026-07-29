#pragma once

#include "hud/heading.hpp"

namespace hud {

// The only rendering contract shared by host validation and the firmware. An ESP32 display
// driver implements this interface; the native preview serializes the same commands to SVG.
class HudDrawTarget {
 public:
  virtual ~HudDrawTarget() = default;
  virtual void line(float x1, float y1, float x2, float y2, const char* color, float thickness = 1.0F) = 0;
  virtual void text(float x, float y, const char* value, const char* color, float size = 12.0F) = 0;
};

struct PrimaryFlightDisplayLayout {
  float width = 320.0F;
  float height = 240.0F;
};

// Builds the heading tape and artificial horizon strictly from resolved telemetry. No Arduino,
// graphics-library, or browser dependency is allowed below this boundary.
void compose_primary_flight_display(
    const TelemetrySample& sample,
    HudDrawTarget& target,
    const PrimaryFlightDisplayLayout& layout = {});

}  // namespace hud
