#pragma once

#include <cstdint>
#include <optional>

namespace hud {

struct AttitudeSample {
  std::optional<float> roll_rad;
  std::optional<float> pitch_rad;
  std::optional<float> yaw_rad;
};

struct VfrHudSample {
  std::optional<float> heading_deg;
};

struct GlobalPositionSample {
  // MAVLink GLOBAL_POSITION_INT.hdg, in centidegrees. 65535 means unknown.
  std::optional<std::uint16_t> heading_cdeg;
};

struct TelemetrySample {
  std::optional<AttitudeSample> attitude;
  std::optional<VfrHudSample> vfr_hud;
  std::optional<GlobalPositionSample> global_position;
};

}  // namespace hud
