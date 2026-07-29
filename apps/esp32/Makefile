CXX := g++
CXXFLAGS := -std=c++17 -Wall -Wextra -Werror -pedantic -Iinclude
CORE := lib/hud/src/heading.cpp lib/hud/src/scene.cpp
BUILD := build

.PHONY: all test run clean

all: test

$(BUILD):
	mkdir -p $(BUILD)

$(BUILD)/hud_tests: test/hud_tests.cpp $(CORE) | $(BUILD)
	$(CXX) $(CXXFLAGS) $^ -o $@

$(BUILD)/hud_preview: native/hud_preview.cpp $(CORE) | $(BUILD)
	$(CXX) $(CXXFLAGS) $^ -o $@

test: $(BUILD)/hud_tests
	./$(BUILD)/hud_tests

run: $(BUILD)/hud_preview
	./$(BUILD)/hud_preview > $(BUILD)/hud-preview.svg
	@echo "Wrote $(BUILD)/hud-preview.svg"

clean:
	rm -rf $(BUILD)
