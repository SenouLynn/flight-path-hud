#include <Arduino.h>

#include "hud/heading.hpp"

// Hardware rendering intentionally stays outside the portable hud/ library. Select the actual
// OLED driver once the board and panel controller are known, then implement HudDrawTarget with
// that driver's line/text calls.
void setup() {
  Serial.begin(115200);

  hud::TelemetrySample sample{
      hud::AttitudeSample{0.0F, 0.0F, 1.57079632679F},
      hud::VfrHudSample{90.0F},
      std::nullopt,
  };
  const hud::HeadingResolution heading = hud::resolve_heading(sample);
  Serial.printf("HUD firmware booted; heading %.1f from %s\n", *heading.heading_deg,
                hud::heading_source_name(heading.source));
}

void loop() {
  delay(1000);
}
