#!/bin/bash
set -euo pipefail
# Installed Windows boots without installer media. The QEMU backend loads its
# private VNC password via QMP and verifies password authentication on port 5905.
exec python3 "$(cd "$(dirname "$0")" && pwd)/vm/host.py" up "$@"
