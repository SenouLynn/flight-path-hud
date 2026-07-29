#pragma once

#include "hud/telemetry.hpp"

namespace hud {

enum class HeadingSource {
  kVfrHud,
  kAttitudeYaw,
  kGlobalPosition,
  kUnavailable,
};

struct HeadingResolution {
  std::optional<float> heading_deg;
  HeadingSource source;
  bool is_fallback;
};

float normalize_degrees(float degrees);
HeadingResolution resolve_heading(const TelemetrySample& sample);
const char* heading_source_name(HeadingSource source);

}  // namespace hud
