#!/bin/bash
set -euo pipefail
vm_here="$(cd "$(dirname "$0")" && pwd)"
vm_state="${AO_VM_STATE:-$HOME/Projects/ao-reference/runtime/ao-vm}"
test -f "$vm_state/payload.zip" || { echo 'Missing staged payload.zip' >&2; exit 1; }
"$vm_here/../vm-ssh.sh" 'New-Item -ItemType Directory -Force C:/ao | Out-Null'
python3 - "$vm_state" <<'PY'
import datetime, json, pathlib, sys
p = pathlib.Path(sys.argv[1]) / 'windows-installed.json'
p.write_text(json.dumps({'ssh_observed_utc': datetime.datetime.now(datetime.timezone.utc).isoformat()}) + '\n')
PY
scp -F "$vm_state/ssh_config" "$vm_state/payload.zip" "$vm_here/install.ps1" "$vm_here/start-server.ps1" ao-build:C:/ao/
"$vm_here/../vm-ssh.sh" 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:/ao/install.ps1'
"$vm_here/../vm-ssh.sh" 'Get-Content C:/ao/ready.txt'
python3 - "$vm_state" <<'PY'
import datetime, json, pathlib, sys
p = pathlib.Path(sys.argv[1]) / 'provisioned.json'
p.write_text(json.dumps({'dependencies_verified_utc': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'compiled': False}) + '\n')
PY
