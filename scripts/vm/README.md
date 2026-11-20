# Original AO server: Windows / twinBASIC VM

The current status and human build instructions are in
[VM-BUILD-HANDOFF.md](../../docs/VM-BUILD-HANDOFF.md). The original server build
is manual in twinBASIC Community. These scripts do not import or compile it.

## State and limits

All credentials, sources, guest disks, installers and logs are outside Git in
`~/Projects/ao-reference/runtime/ao-vm/` (0700). `AO_VM_STATE` can select another
state directory. `identity.json`, the generated answer file, SSH key and seed
media must remain private. Source provenance is recorded in `sources.json`.

- 4096 MiB guest RAM, four CPUs, a sparse 40,000,000,000-byte raw system disk.
- Local admin `aobuilder`, auto-logon, key-only SSH; no Microsoft account, RDP off.
- Host loopback TCP 2222 → guest 22; TCP 7667 → guest 7667.
- Ariel's 20 November continuation approves a **12 decimal GB** host free-space
  floor. The launchers require **14 GB** to leave headroom. The QEMU monitor
  polls every 250 ms, pauses through QMP, and uses SIGSTOP on that specific
  emulator if QMP does not respond. It never saves 4 GiB of RAM into the reserve.
  `disk-guard-status.json` records the minimum observed free space.
- UTM calls have explicit timeouts. `qemu-backend.json` selects the headless
  fallback; `vm-up.sh`, `vm-down.sh`, and `host.py status` respect that selection.
  Do not launch UTM against the same disk while QEMU is running.

## Prepare from the supplied official media

The current ISO is English (UK), ARM64, 8,543,594,496 bytes; SHA-256:
`500bcb6f272b7c455156470ea06816f558f13b885723f84ee9eab7534c7dee61`.

For a new, never-booted bundle:

```sh
hdiutil attach -readonly -nobrowse "$HOME/Projects/ao-reference/runtime/ao-vm/utm-guest-tools-0.1.271.iso"
python3 scripts/vm/prepare.py --iso "$HOME/Downloads/ao-vm/Win11_ARM64_en-gb.iso" --locale en-GB
```

`prepare.py` checks the ISO hash/ARM64 loader and packages the UTM ARM64 network
and display drivers plus Microsoft's ARM64 OpenSSH ZIP. It refuses to regenerate
media once firmware state exists. The unattended answer file wipes **guest disk
0**, so never reuse it against an installed system. It uses the public Pro
installation key to avoid an empty-product-key setup error, without activation.

The payload already staged by `stage-payload.py` contains:

- pinned original server source, preserved Windows-1252 bytes, `PYMMO=0` and
  explicit `DIRECT_PLAY=0`; upstream `DEBUGGING=1` remains enabled;
- maps/Dat, example INIs with isolated paths and a fresh SQLite database;
- twinBASIC Community beta 1044 (publisher SHA-256 verified), Microsoft VB6
  controls from KB2708437, Microsoft Visual C++ x86 runtime, Microsoft WebView2,
  SQLite x86 ODBC, Aurora and DX8VB.

## Headless fallback used in this continuation

UTM 5.0.9-2 passes strict signing and notarization checks but its app and CLI hang
before main on this Mac. `open -a UTM` and opening the bundle did not fix it;
`utmctl` help/list/start calls timed out, and the documented AppleScript query
returned `-1712`. No Computer Use or alternate UI automation was used. Removing
the verified app's quarantine metadata did not help; that metadata was restored.

Installed through Homebrew (no automatic update/cleanup):

```sh
HOMEBREW_NO_AUTO_UPDATE=1 HOMEBREW_NO_INSTALL_CLEANUP=1 brew install qemu swtpm
HOMEBREW_NO_AUTO_UPDATE=1 HOMEBREW_NO_INSTALL_CLEANUP=1 brew install wimlib
```

QEMU **11.1.3** uses HVF, the same system disk, UTM Secure Boot firmware and its
Microsoft-key variables. The TPM TIS device failed with `HV_BAD_ARGUMENT` during
initialization, so the fallback has no TPM and the answer file overrides its
setup requirement as well as the 64 GB storage minimum. The unused swtpm helper
was stopped. The guest remains unactivated.

`prepare-boot-media.py` makes an APFS clone, replaces only the EFI boot extent
with the ISO's own `efisys_noprompt.bin`, and optionally instruments WinPE. The
original ISO is untouched; no full extra 8.5 GB copy is made. The diagnostic mode
exports Setup image 2 as the boot image, adds the two command scripts and
Microsoft's native curl extracted from OS image 3, and verifies the original
boot.wim extent before replacing it. It refuses an existing output.

```sh
python3 scripts/vm/prepare-boot-media.py \
  --iso "$HOME/Downloads/ao-vm/Win11_ARM64_en-gb.iso" --diagnostics
python3 scripts/vm/collect-setup-logs.py # Temporary localhost receiver, port 18081
python3 scripts/vm/qemu-host.py up
```

The receiver accepts only three small named log uploads into the private state
directory; it serves no files. WinPE loads NetKVM and invokes Setup explicitly
with the seed answer file. Its logs exposed the empty-product-key error and
missing Secure Boot capability; both were fixed. The receiver is only needed
for provisioning and is stopped afterward.

The desktop is available for the human through **`vnc://127.0.0.1:5905`**, using
Mac Screen Sharing. This loopback display is separate from the SSH service.
`vm-up.sh` starts QEMU with `-vnc 127.0.0.1:5,password=on`, then sets the password
through QMP. Its random eight-character password is created once in private
`vnc-password.txt` (mode `600`) and reused on subsequent starts. The launcher
prints only the file path. A VM started without password authentication needs
a graceful Windows shutdown and QEMU restart before it can accept a password.
The launcher verifies that the VNC handshake offers only security type 2.
After `shutdown /s /t 0` over SSH, wait for `host.py status` to report `shutdown`,
then run `vm-up.sh`; it exits the already-shut-down QEMU process and starts a new
one. Installed guests do not attach installer or seed media on subsequent boots.
The agent does not operate it.

## Install and verify the payload after Windows setup

```sh
scripts/vm/install-over-ssh.sh
```

This copies the payload and scripts into `C:\ao`, extracts twinBASIC and source,
installs/registers the x86 dependencies, probes Aurora COM and an ADO/SQLite
query, then launches the IDE in the logged-in desktop using an interactive task.
It writes `C:\ao\ready.txt` and host `provisioned.json` only on success. It never
opens a VBP or calls a compiler. Check `C:\ao\bootstrap.log`, `network.txt`, and
`install.log` for guest evidence. After successful setup, eject the installation
and seed media; subsequent boots must use the installed system disk.

For an interrupted dependency installation with the payload already extracted,
copy the updated installer/dependencies and run `install.ps1 -SkipExtraction`.
Do not rerun full payload extraction after editing the project or using the
database: it restores the staged source and fresh database. Aurora needs the
x86 Visual C++ runtime; `install.ps1` verifies Microsoft's installer signature
and installs it before COM registration. Its pinned download/hash are in
`stage-payload.py` and private `sources.json`.

Post-build server startup is deliberately separate:

```sh
scripts/vm-ssh.sh 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:/ao/start-server.ps1'
```

The interactive task uses `C:\ao\server` as its working directory and checks
for TCP 7667. Human import/build and live server compatibility remain untested
until the human completes the documented steps.
