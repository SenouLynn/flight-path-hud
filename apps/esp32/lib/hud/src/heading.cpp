#include "hud/heading.hpp"

#include <cmath>

namespace hud {
namespace {
constexpr float kRadiansToDegrees = 57.2957795131F;

bool finite(float value) {
  return std::isfinite(value);
}
}  // namespace

float normalize_degrees(float degrees) {
  const float normalized = std::fmod(degrees, 360.0F);
  return normalized < 0.0F ? normalized + 360.0F : normalized;
}

HeadingResolution resolve_heading(const TelemetrySample& sample) {
  if (sample.vfr_hud.has_value() && sample.vfr_hud->heading_deg.has_value() &&
      finite(*sample.vfr_hud->heading_deg)) {
    return {normalize_degrees(*sample.vfr_hud->heading_deg), HeadingSource::kVfrHud, false};
  }

  if (sample.attitude.has_value() && sample.attitude->yaw_rad.has_value() &&
      finite(*sample.attitude->yaw_rad)) {
    return {normalize_degrees(*sample.attitude->yaw_rad * kRadiansToDegrees),
            HeadingSource::kAttitudeYaw, true};
  }

  if (sample.global_position.has_value() && sample.global_position->heading_cdeg.has_value() &&
      *sample.global_position->heading_cdeg != 65535U) {
    return {normalize_degrees(static_cast<float>(*sample.global_position->heading_cdeg) / 100.0F),
            HeadingSource::kGlobalPosition, true};
  }

  return {std::nullopt, HeadingSource::kUnavailable, false};
}

const char* heading_source_name(HeadingSource source) {
  switch (source) {
    case HeadingSource::kVfrHud:
      return "VFR_HUD.heading";
    case HeadingSource::kAttitudeYaw:
      return "ATTITUDE.yaw";
    case HeadingSource::kGlobalPosition:
      return "GLOBAL_POSITION_INT.hdg";
    case HeadingSource::kUnavailable:
      return "unavailable";
  }
  return "unavailable";
}

}  // namespace hud
