#include "hud/heading.hpp"
#include "hud/scene.hpp"

#include <cassert>
#include <cmath>
#include <iostream>

class CountingTarget final : public hud::HudDrawTarget {
 public:
  int line_count = 0;
  int text_count = 0;
  void line(float, float, float, float, const char*, float) override { ++line_count; }
  void text(float, float, const char*, const char*, float) override { ++text_count; }
};

int main() {
  assert(std::fabs(hud::normalize_degrees(-10.0F) - 350.0F) < 0.001F);

  hud::TelemetrySample primary{std::nullopt, hud::VfrHudSample{450.0F}, std::nullopt};
  const auto primary_result = hud::resolve_heading(primary);
  assert(primary_result.source == hud::HeadingSource::kVfrHud);
  assert(std::fabs(*primary_result.heading_deg - 90.0F) < 0.001F);

  hud::TelemetrySample fallback{hud::AttitudeSample{std::nullopt, std::nullopt, 1.57079632679F},
                                std::nullopt, std::nullopt};
  const auto fallback_result = hud::resolve_heading(fallback);
  assert(fallback_result.source == hud::HeadingSource::kAttitudeYaw);
  assert(fallback_result.is_fallback);
  assert(std::fabs(*fallback_result.heading_deg - 90.0F) < 0.01F);

  CountingTarget target;
  hud::compose_primary_flight_display(fallback, target);
  assert(target.line_count > 10);
  assert(target.text_count > 0);

  std::cout << "ESP32 HUD host tests passed\n";
}
