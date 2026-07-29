# Dear ImGui React runtime experiment
This is a stepping stone to explore Dear ImGui and its visual capabilities. This is a step to the left, not forward, to getting this onto an ESP32. 


## Important
This directory keeps a local checkout of
[`tmikov/imgui-react-runtime`](https://github.com/tmikov/imgui-react-runtime) under
`runtime/`. It is separate from the web workspace because it uses its own CMake, Static
Hermes, and npm toolchain.

Bootstrap the checkout from the repository root:

```bash
npm run bootstrap:imgui
```

Then follow the upstream build flow:

```bash
cd apps/imgui-react-runtime/runtime
npm install
cmake -B cmake-build-debug -DCMAKE_BUILD_TYPE=Debug -G Ninja
cmake --build cmake-build-debug
./cmake-build-debug/examples/showcase/showcase
```

This is deliberately an isolated desktop prototype. It is not a dependency of the browser
validation app and is not yet an ESP32 deployment target.
