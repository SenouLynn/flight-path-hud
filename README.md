# HUD Visualizer
**Setup & Problem Statement**
For my FPV setup, I'm running a Hawkeye Firefly 4k Split camera which supports analog video streaming AND onboard 4k recording. Furthermore the camera is fixed to a pan/tilt gimbal in the general area of a 'cockpit'. The presenting issue with gimbal'd FPV is loss of orientation in relation to the aircraft. Secondarily, I use video quite a bit in my debugging process as I focus 90% of my focus on piloting.

**Solution Statement**
Naively this could be solved with tape or 3d printing a static item and glue to the body. That's no fun though. 
The goal is to make a dashboard HUD projected onto a reflex sight, hard-mounted to the airframe as a visual point of reference. This can be achieved by consuming MAVLINK on an ESP32 board and projecting graphics from a 1inch screen onto an angled piece of glass. 

**Repo Purpose**
1. Flesh out what features I actually want.
2. Establish algorithm for extrapolating cardinality in 3 dimensions. 
3. Prepare for translation into C++ or something. 


## Features
#### Basic Telemetry
1. Attitude Indicator / Artificial Horizon — shows pitch AND roll together
   - Pitch: horizon line moves up/down
   - Roll: horizon line tilts
2. Heading Indicator / Heading Tape — shows yaw (nose direction, compass-referenced)

#### Extrapolation 
1. Flight path indicatork