#include "hud/scene.hpp"

#include <cmath>
#include <cstdio>

namespace hud {
namespace {
constexpr float kDegreesToRadians = 0.0174532925199F;
constexpr float kRadiansToDegrees = 57.2957795131F;

float shortest_delta_degrees(float from, float to) {
  float delta = normalize_degrees(to) - normalize_degrees(from);
  if (delta > 180.0F) delta -= 360.0F;
  if (delta < -180.0F) delta += 360.0F;
  return delta;
}

const char* heading_label(float heading, char* buffer, std::size_t length) {
  const int rounded = static_cast<int>(std::lround(normalize_degrees(heading)));
  if (rounded == 0) return "N";
  if (rounded == 90) return "E";
  if (rounded == 180) return "S";
  if (rounded == 270) return "W";
  std::snprintf(buffer, length, "%03d", rounded);
  return buffer;
}

void draw_heading_tape(float heading, HudDrawTarget& target, const PrimaryFlightDisplayLayout& layout) {
  const float center_x = layout.width / 2.0F;
  const float tape_bottom = 76.0F;
  const float pixels_per_degree = layout.width / 120.0F;
  target.line(0.0F, tape_bottom, layout.width, tape_bottom, "#74d7ff", 1.0F);

  const int first_tick = static_cast<int>(std::floor((heading - 70.0F) / 5.0F)) * 5;
  for (int tick = first_tick; tick <= heading + 70.0F; tick += 5) {
    const float delta = shortest_delta_degrees(heading, static_cast<float>(tick));
    const float x = center_x + delta * pixels_per_degree;
    const bool major = tick % 10 == 0;
    target.line(x, tape_bottom, x, major ? tape_bottom - 17.0F : tape_bottom - 9.0F, "#d5f5ff", 1.0F);
    if (major) {
      char label[8];
      target.text(x - 10.0F, tape_bottom - 24.0F,
                  heading_label(static_cast<float>(tick), label, sizeof(label)), "#d5f5ff", 11.0F);
    }
  }
  target.line(center_x, 10.0F, center_x, 30.0F, "#ffb454", 2.0F);
}

void draw_attitude(float roll_deg, float pitch_deg, HudDrawTarget& target,
                   const PrimaryFlightDisplayLayout& layout) {
  const float center_x = layout.width / 2.0F;
  const float center_y = 158.0F;
  const float pitch_offset = std::fmax(-30.0F, std::fmin(30.0F, pitch_deg)) * 3.0F;
  const float angle = -roll_deg * kDegreesToRadians;
  const float extent = layout.width;
  const float cos_angle = std::cos(angle);
  const float sin_angle = std::sin(angle);

  const auto rotate_line_point = [&](float x, float y, float* out_x, float* out_y) {
    *out_x = center_x + x * cos_angle - y * sin_angle;
    *out_y = center_y + x * sin_angle + y * cos_angle;
  };

  float x1 = 0.0F;
  float y1 = 0.0F;
  float x2 = 0.0F;
  float y2 = 0.0F;
  rotate_line_point(-extent, pitch_offset, &x1, &y1);
  rotate_line_point(extent, pitch_offset, &x2, &y2);
  target.line(x1, y1, x2, y2, "#74d7ff", 2.0F);

  for (int step = -20; step <= 20; step += 10) {
    if (step == 0) continue;
    const float ladder_y = pitch_offset - static_cast<float>(step) * 3.0F;
    rotate_line_point(-32.0F, ladder_y, &x1, &y1);
    rotate_line_point(32.0F, ladder_y, &x2, &y2);
    target.line(x1, y1, x2, y2, "#d5f5ff", 1.0F);
  }

  target.line(center_x - 48.0F, center_y, center_x - 12.0F, center_y, "#ffb454", 2.0F);
  target.line(center_x + 12.0F, center_y, center_x + 48.0F, center_y, "#ffb454", 2.0F);
  target.line(center_x - 12.0F, center_y, center_x, center_y + 8.0F, "#ffb454", 2.0F);
  target.line(center_x, center_y + 8.0F, center_x + 12.0F, center_y, "#ffb454", 2.0F);
}
}  // namespace

void compose_primary_flight_display(const TelemetrySample& sample, HudDrawTarget& target,
                                    const PrimaryFlightDisplayLayout& layout) {
  const HeadingResolution heading = resolve_heading(sample);
  if (heading.heading_deg.has_value()) {
    draw_heading_tape(*heading.heading_deg, target, layout);
  } else {
    target.text(12.0F, 24.0F, "HEADING UNAVAILABLE", "#ff6b6b", 12.0F);
  }

  const float roll_deg = sample.attitude.has_value() && sample.attitude->roll_rad.has_value()
      ? *sample.attitude->roll_rad * kRadiansToDegrees : 0.0F;
  const float pitch_deg = sample.attitude.has_value() && sample.attitude->pitch_rad.has_value()
      ? *sample.attitude->pitch_rad * kRadiansToDegrees : 0.0F;
  draw_attitude(roll_deg, pitch_deg, target, layout);
}

}  // namespace hud
