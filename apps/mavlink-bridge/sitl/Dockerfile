FROM ubuntu:24.04

ARG ARDUPILOT_REF=Copter-4.6.2
ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates git python3 python3-pip python3-venv sudo \
    build-essential ccache g++ wget && \
    rm -rf /var/lib/apt/lists/*

RUN git clone --depth 1 --branch ${ARDUPILOT_REF} https://github.com/ArduPilot/ardupilot.git /opt/ardupilot && \
    cd /opt/ardupilot && git submodule update --init --recursive && \
    Tools/environment_install/install-prereqs-ubuntu.sh -y && \
    ./waf configure --board sitl && ./waf copter && ./waf plane

COPY entrypoint.sh /usr/local/bin/sitl-entrypoint
RUN chmod +x /usr/local/bin/sitl-entrypoint

ENTRYPOINT ["/usr/local/bin/sitl-entrypoint"]
