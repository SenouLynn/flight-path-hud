# syntax=docker/dockerfile:1.7
FROM ubuntu:24.04

ARG ARDUPILOT_REF=Copter-4.6.2
ARG MAVPROXY_VERSION=1.8.74
ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates git python3 python3-pip python3-venv sudo \
    build-essential ccache g++ wget && \
    rm -rf /var/lib/apt/lists/*

# Keep these as separate layers. The first build on an Apple Silicon laptop is
# substantial, and independent cache points mean an interrupted download or
# compile can resume rather than repeating the entire ArduPilot setup.
RUN git clone --depth 1 --branch ${ARDUPILOT_REF} https://github.com/ArduPilot/ardupilot.git /opt/ardupilot

RUN cd /opt/ardupilot && git submodule update --init --recursive --depth 1

# ArduPilot's own setup script intentionally refuses root. Build as an ordinary
# user with narrowly scoped passwordless sudo, matching its supported Ubuntu
# workflow, while keeping the image's base-package setup above as root.
RUN useradd --create-home --shell /bin/bash ardupilot && \
    echo 'ardupilot ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/ardupilot && \
    chmod 0440 /etc/sudoers.d/ardupilot && \
    chown -R ardupilot:ardupilot /opt/ardupilot

RUN su - ardupilot -c 'cd /opt/ardupilot && Tools/environment_install/install-prereqs-ubuntu.sh -y'

# sim_vehicle.py starts MAVProxy as a separate program; ArduPilot's prerequisite
# installer prepares its dependencies but does not install this executable itself.
# Keep it version-pinned alongside the ArduPilot tag for reproducible SITL links.
RUN su - ardupilot -c "python3 -m pip install --no-cache-dir MAVProxy==${MAVPROXY_VERSION} && command -v mavproxy.py && mavproxy.py --version"

RUN su - ardupilot -c 'cd /opt/ardupilot && CC=/usr/bin/gcc CXX=/usr/bin/g++ ./waf configure --board sitl && CC=/usr/bin/gcc CXX=/usr/bin/g++ ./waf copter -j 4'

RUN su - ardupilot -c 'cd /opt/ardupilot && CC=/usr/bin/gcc CXX=/usr/bin/g++ ./waf plane -j 4'

# MAVProxy is installed into ArduPilot's setup virtualenv, while containers run
# the entrypoint as root. Make the executable visible to sim_vehicle.py at run time.
ENV PATH=/home/ardupilot/venv-ardupilot/bin:${PATH}

COPY entrypoint.sh /usr/local/bin/sitl-entrypoint
RUN chmod +x /usr/local/bin/sitl-entrypoint

COPY seed_mission.py /usr/local/bin/sitl-seed-mission
RUN chmod +x /usr/local/bin/sitl-seed-mission

ENTRYPOINT ["/usr/local/bin/sitl-entrypoint"]
