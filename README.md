# HUD Visualizer
**Setup & Problem Statement**
I'm running a Hawkeye Firefly 4k Split camera which supports analog video streaming & onboard 4k recording. The camera is fixed to a pan/tilt gimbal. Loss of orientation to the craft and the ground is shockingly easy (and historically catastrophic). Also I use video quite a bit for debugging so having non-telemetry frame of reference can be helpful in log-analysis and debugging. As POV rotates with the gimbal, having a fixed-reference with additional telemetry seems useful.

**Solution Statement**
Yeah this can be solved with a piece of tape. I'd rather over-engineer a solution. 

I want to build a reflex sight/holo sight on which I project a predictive trajectory HUD from an ESP32 board and 1.2in OLED screen. 

**Repo Purpose**
1. Flesh out what features I actually want.
2. Establish core functions and algorithm for extrapolating cardinality in Euclidean space. 
3. Prepare for translation into C++ or lua (or whatever). 


## What this repo actually is
A **monorepo** for HUD validation and rendering experiments, not the flight HUD itself.
The browser validation harness lives in [apps/web](apps/web); the separate native experiment
lives in [apps/desktop](apps/desktop). All browser HUD math lives in
pure, framework-free resolvers under [apps/web/src/logic/](apps/web/src/logic/) so it can be
proven against known-answer replay frames and later ported to C++/ESP32 firmware. The web app
renders both a live mock feed and expected-vs-resolved validation tables.

The future device application starts in [apps/esp32](apps/esp32). Its C++ core can be run on
your local machine before it is flashed to a board: `npm run test:esp32` runs host tests and
`npm run preview:esp32` writes a deterministic SVG preview.

## Features
#### Basic Telemetry
1. Attitude Indicator / Artificial Horizon — shows pitch AND roll together
   - Pitch: horizon line moves up/down
   - Roll: horizon line tilts
2. Heading Indicator / Heading Tape — shows yaw (nose direction, compass-referenced)
3. Rigid body orientation in 3 dimensional space (no velocity)

#### Extrapolation
1. Predictive path — linear and turn-aware (CTRV) projection, plus an integrated
   trajectory that blends heading/track/bank/pitch with wind-drift, stall cues, and 

### Log Consumption
1. GPS/Location positional replay
2. PID replay/tuning

## General Knowledge 
1. Basic physics engine - run mock simulations



## Getting started

### One-time macOS tools

Install the Xcode command-line tools first. They provide the system C++ compiler and `make`
used by the boardless ESP32 validation loop:

```bash
xcode-select --install
```

Install [Homebrew](https://brew.sh/) if it is not already available, then install the shared
JavaScript and native-build tools:

```bash
brew install node cmake ninja
```

`git` is also required when bootstrapping the desktop experiment; Xcode's command-line tools
normally provide it. Verify with `git --version`.

### Browser validation app

```bash
npm install
npm run dev:web      # Vite dev server
npm run test:web     # Vitest known-answer suites
npm run build:web    # tsc -b && vite build
npm run lint:web
```

### Desktop Dear ImGui experiment (optional)

The desktop experiment is an upstream checkout and has its own npm/CMake setup:

```bash
npm run bootstrap:desktop
cd apps/desktop/runtime
npm install
cmake -B cmake-build-debug -DCMAKE_BUILD_TYPE=Debug -G Ninja
cmake --build cmake-build-debug
./cmake-build-debug/examples/showcase/showcase
```

See the experiment's [README](apps/desktop/README.md) for its structure and caveats.

### ESP32 firmware

You can develop the portable C++ core immediately after installing the Xcode command-line
tools—no microcontroller, USB driver, or PlatformIO installation is needed:

```bash
npm run test:esp32       # host C++ tests
npm run preview:esp32    # writes apps/esp32/build/hud-preview.svg
```

For flashing a physical board, use one of these PlatformIO setups:

1. **Recommended IDE path:** install [VS Code](https://code.visualstudio.com/), then install the
   official **PlatformIO IDE** extension. It includes PlatformIO Core, so no separate CLI install
   is necessary. [PlatformIO's VS Code guide](https://docs.platformio.org/en/latest/integration/ide/vscode.html)
   has the current steps.
2. **CLI path:** install PlatformIO's isolated virtual environment using its
   [recommended installer](https://docs.platformio.org/en/latest/core/installation/methods/installer-script.html).
   On macOS/Linux, the official quick-start commands are:

   ```bash
   curl -fsSL -o get-platformio.py https://raw.githubusercontent.com/platformio/platformio-core-installer/master/get-platformio.py
   python3 get-platformio.py
   ```

   The installer creates `~/.platformio/penv/bin/pio`. Follow PlatformIO's
   [shell-command setup](https://docs.platformio.org/en/stable/core/installation/shell-commands.html)
   if `pio` is not available in a new terminal.

With PlatformIO available, build and flash from the firmware directory. The first build
downloads the ESP32 platform/toolchain declared by `platformio.ini`:

```bash
cd apps/esp32
pio run
pio run --target upload
pio device monitor
```

The initial board target is generic `esp32dev`. Before uploading, update `board = esp32dev` in
[apps/esp32/platformio.ini](apps/esp32/platformio.ini) to match the actual board. If it does not
appear as a serial port after connecting it, install the USB-UART driver specified by that
board's manufacturer (commonly CP210x or CH340).

## Documentation
- [docs/architecture.md](docs/architecture.md) — data flow, module map, conventions, tooling
- [docs/heading_indicator.md](docs/heading_indicator.md) — heading source resolution
- [docs/attitude_and_horizon_indicator.md](docs/attitude_and_horizon_indicator.md) — attitude/horizon + 3D orientation
- [docs/flight_path_marker.md](docs/flight_path_marker.md) — FPM, FPA, predictive trajectory
- [docs/decisions.md](docs/decisions.md) — Architecture Decision Record (ADR) log
- [CHANGELOG.md](CHANGELOG.md) — notable changes over time

> **For AI agents & contributors:** `docs/decisions.md` and `CHANGELOG.md` are living
> documents. When you make a decision that shapes the architecture, add an ADR entry;
> when you ship a notable change, add a changelog entry. See each file's header for the
> format.
