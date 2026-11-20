#!/bin/bash
set -euo pipefail
# The QEMU backend enables VNC password auth and loads its private password via QMP.
exec python3 "$(cd "$(dirname "$0")" && pwd)/vm/host.py" up "$@"
