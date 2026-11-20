#!/bin/bash
set -euo pipefail
vm_state="${AO_VM_STATE:-$HOME/Projects/ao-reference/runtime/ao-vm}"
if [ ! -f "$vm_state/ssh_config" ]; then
  echo "Missing $vm_state/ssh_config; run scripts/vm/prepare.py first." >&2
  exit 1
fi
exec ssh -F "$vm_state/ssh_config" ao-build "$@"
