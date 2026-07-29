#include "hud/scene.hpp"

#include <cstdio>

class SvgTarget final : public hud::HudDrawTarget {
 public:
  void line(float x1, float y1, float x2, float y2, const char* color, float thickness) override {
    std::printf("<line x1=\"%.1f\" y1=\"%.1f\" x2=\"%.1f\" y2=\"%.1f\" stroke=\"%s\" stroke-width=\"%.1f\" />\n",
                x1, y1, x2, y2, color, thickness);
  }

  void text(float x, float y, const char* value, const char* color, float size) override {
    std::printf("<text x=\"%.1f\" y=\"%.1f\" fill=\"%s\" font-size=\"%.1f\" font-family=\"monospace\">%s</text>\n",
                x, y, color, size, value);
  }
};

int main() {
  hud::TelemetrySample sample{
      hud::AttitudeSample{10.0F * 0.0174532925199F, 5.0F * 0.0174532925199F,
                          92.0F * 0.0174532925199F},
      hud::VfrHudSample{92.0F},
      std::nullopt,
  };
  std::puts("<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"320\" height=\"240\" viewBox=\"0 0 320 240\">\n<rect width=\"320\" height=\"240\" fill=\"#07131c\" />");
  SvgTarget target;
  hud::compose_primary_flight_display(sample, target);
  std::puts("</svg>");
}
