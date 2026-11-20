# AO Windows build handoff

**20 November 2026 — the first human twinBASIC build failed.** The human imported
`C:\ao\server\Server.VBP` with Option Explicit OFF, saved
`C:\ao\server\Argentum20Server.twinproj`, and used File → Build in Community
BETA 1044. The reported result is **7 errors and 220 warnings**, with
`[LINKER] FAILED due to compilation errors 'C:\ao\server\server.exe'` and
`[BUILD] failed`. See [twinBASIC compile fixes](#twinbasic-compile-fixes) below.
Source fixes for all seven diagnostics are now applied; human re-import/build
remains pending. Windows, SSH and the VNC desktop are available; dependency
validation passed.

The `ao-build` disk is running through a **headless QEMU fallback**, because UTM
5.0.9-2 and `utmctl` hang before application startup on this Mac. Opening UTM,
its documented scripting API, and bounded CLI retries did not resolve it.
The original installation used no GUI automation. The subsequent display repair
was verified by inspecting screenshots of QEMU's VNC framebuffer.
The same `ao-build.utm/Data/windows.img` remains the **40,000,000,000-byte thin
disk**, with **4096 MiB RAM / four CPUs**. Do not open this bundle in UTM while
its disk is in use by the fallback.

Private state: `~/Projects/ao-reference/runtime/ao-vm/` (outside Git).
SSH is configured as **127.0.0.1:2222 → 10.0.2.15:22**, user `aobuilder`, using
its dedicated SSH key. The game forward is **127.0.0.1:7667 → guest:7667**.
The desktop is exposed only on **127.0.0.1:5905 (VNC)** for the human build.

Ariel approved a **12 decimal GB host reserve** for this continuation. The
launcher refuses to start below 14 GB; its monitor polls every 250 ms and pauses
at 14 GB to leave headroom. A monitor timeout stops the emulator process without
saving RAM to disk. Other host programs can consume space; this is not a quota.

## Open the desktop and build manually

These instructions cover initial setup and subsequent human re-imports. The
licence dialogs and first import have already been completed on this VM. The
import/build instructions use the publisher's documented IDE labels.

1. On the Mac, **Finder → Go → Connect to Server…** (`⌘K`) → enter
   **`vnc://127.0.0.1:5905`** → **Connect**. This opens the running Windows desktop.
   The equivalent Mac command is `open 'vnc://127.0.0.1:5905'`.
   Enter the VNC password stored in
   `~/Projects/ao-reference/runtime/ao-vm/vnc-password.txt` (mode `600`, outside Git).
   The launcher enables VNC password authentication and loads this password via QMP
   on every start; macOS Screen Sharing requires it.
2. In twinBASIC's first-run dialogs: review **twinBASIC Licence Agreement →
   I AGREE**; choose **NO** in **Automatic Error Reporting**; choose
   **Save Changes** in **IDE Options**. No twinBASIC account or paid key is needed
   for Community. If the IDE is closed, open `C:\ao\twinbasic\twinBASIC.exe`.
3. **File → Open Project…** (`Ctrl+O`) → **`C:\ao\server\Server.VBP`** → **Open**.
   In **New Project Options**, untick **Option Explicit ON** to retain the
   source files' own declaration rules, then click **Continue**.
   Choose **File → Save Project** →
   **`C:\ao\server\Argentum20Server.twinproj`**. Press `Ctrl+S` once more.
4. Select **win32** in the build-configuration toolbar. In Project Explorer,
   click the **Project Settings gear**. Search **Conditional Compilation Args**
   and confirm **`PYMMO=0`, `DIRECT_PLAY=0`, `UNIT_TEST=0`**. The staged upstream
   project also retains `DEBUGGING=1`, `UNLOCK_CPU=1`, and `BATTLESERVER=0`.
5. Search **Build Output Path**, enter **`C:\ao\server\server.exe`**, click
   **Apply Changes**, and save.
6. Click **File → Build** (or the toolbar **Build** button). Inspect
   **DEBUG CONSOLE** for errors and the executable path. `F5` runs in the IDE;
   it is not the executable-build command. Import/build compatibility remains
   unverified until this human step succeeds.

Sources: [first launch](https://docs.twinbasic.com/tB/IDE/Starting/First-Launch),
[VBP import](https://docs.twinbasic.com/tB/IDE/Starting/Importing-VB6),
[build command](https://docs.twinbasic.com/tB/IDE/Building/Build-and-Clean),
[output setting](https://docs.twinbasic.com/tB/IDE/Building/Build-Output), and
[Community licensing](https://twinbasic.com/licensing). No compiler, import or
build automation is included.

## twinBASIC compile fixes

**20 November 2026 — fixes for all seven recovered diagnostics are applied** to
five files in `C:\ao\server\Codigo`. Each changed file has a byte-identical
pre-edit backup named `<filename>.orig`. No GUI clicks, project import,
compiler restart or twinBASIC build were performed. Compilation after these
changes remains **unverified**; a human must re-import `Server.VBP` and build.

The clipboard export is [tb-errors-2026-11-20.txt](tb-errors-2026-11-20.txt),
copied byte-for-byte from `C:\ao\tb-errors.txt`. Contrary to the initial
expectation, **the clipboard contained only the 63-byte report header**, with
no error rows. The seven diagnostics were recovered separately from the
running IDE's cached diagnostic objects, without changing its state. The
[diagnostic evidence and source hashes](tb-diagnostics-2026-11-20.json) retain
that distinction; the clipboard file has not been replaced with a synthetic
report.

All locations below are **one-based physical source lines**, including the
VB6 `Attribute` line. No source lines were added or removed.

| File under `C:\ao\server\Codigo` | Line | Code and exact message | Applied VB6-compatible fix |
| --- | ---: | --- | --- |
| `Modulo_UsUaRiOs.bas` | 97 | **TB5075** — Return statement is missing an expression | In `GetNextAvailableUserSlot`, replace bare `Return` with `Exit Function` after assigning `-1`. |
| `TCP.bas` | 402 | **TB5134** — duplicate definition in the current scope [PacketCount] | In `CloseSocket`, rename the parameter and its uses to `diagnosticPacketCount`. |
| `TCP.bas` | 437 | **TB5134** — duplicate definition in the current scope [PacketCount] | In `CloseSocketSL`, rename the parameter and its uses to `diagnosticPacketCount`. |
| `Protocol_Writes.bas` | 3222 | **TB5134** — duplicate definition in the current scope [Invasion] | In `WriteInvasionInfo`, rename the parameter to `invasionId` and pass it to `Writer.WriteInt8`. |
| `modNetwork.bas` | 100 | **TB5134** — duplicate definition in the current scope [PacketCount] | In `Kick` under `DIRECT_PLAY = 0`, rename the parameter and its uses to `diagnosticPacketCount`. |
| `modNetwork.bas` | 275 | **TB5134** — duplicate definition in the current scope [PacketCount] | In `KickConnection` under `DIRECT_PLAY = 0`, rename the parameter and its uses to `diagnosticPacketCount`. |
| `DisconnectDiagnostics.bas` | 16 | **TB5134** — duplicate definition in the current scope [PacketCount] | In `LogDisconnectDiag`, rename the parameter and its uses to `diagnosticPacketCount`; retain the `" packetCount="` log key. |

The parameter changes retain types, defaults, argument order, packet encoding
and log text. Inspection of all 195 VB6 source files found no calls using the
renamed parameters as named arguments. The inactive `DIRECT_PLAY` implementations
were left as they were. The empty-slot fix returns the already assigned `-1`
without executing the subsequent slot access. It deliberately replaces the old
invalid bare-`Return` path, which has no corresponding `GoSub`, with the intended
early function exit. See the publisher's [Return reference](https://docs.twinbasic.com/tB/Core/Return)
and Microsoft's [Exit Function reference](https://learn.microsoft.com/en-us/office/vba/language/reference/user-interface-help/exit-statement).

The committed [source patch](../scripts/vm/patches/2026-11-20-twinbasic-compile.patch)
contains all five file changes, relative to the original server root. Its hunk
lines retain CRLF so applying it preserves the original Windows-1252 files.
On a pristine copy of the staged server source, run `git apply --check` with
this patch, then `git apply` to reproduce the changes. The VM already has the
changes; do not apply it again there. Original and patched SHA-256 values are
recorded per file in the evidence JSON. Restore a VM file by copying its `.orig`
backup over it if needed.

Clipboard recovery and diagnosis:

- The original `dumpclip` task exited with code **1**. Its command omitted
  `-ExecutionPolicy Bypass`, and the effective policy is **Restricted**.
  Replaying the original invocation over SSH reproduced
  `running scripts is disabled on this system` / `UnauthorizedAccess` before
  its script could execute. The user was already logged on and the task already
  used an Interactive principal, so the bare username was not the observed fault.
- A temporary on-demand task used principal **`AO-BUILD\aobuilder`** and
  `LogonType Interactive`, equivalent to [`schtasks /IT`](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/schtasks-create).
  Its action was
  `powershell.exe -NoProfile -NonInteractive -STA -WindowStyle Hidden -ExecutionPolicy Bypass -File C:\ao\capture-tb-clipboard.ps1`.
  The script used `Get-Clipboard -Raw` and UTF-8 without a BOM. At
  **16:26:42 UTC**, its log confirmed **session 1**, **STA**, and exit code **0**.
  The temporary task was removed. `C:\ao\tb-clipboard-capture.log` and the capture
  script remain available on the VM.
- UnicodeText, Text and OEMText all held the same 63 characters; no HTML error
  report was present. The saved IDE settings have
  `problemsPanelOptions.showErrors=false`. Installed BETA 1044 `ide/main.js`
  shows that **Copy All Errors** traverses `getNextVisibleNode2`, so hidden
  error rows can produce a header-only report. A future human clipboard export
  should first show errors and expand their file groups; no build is needed.
- The read-only fallback used [ReadProcessMemory](https://learn.microsoft.com/en-us/windows/win32/api/memoryapi/nf-memoryapi-readprocessmemory)
  on the IDE's existing WebView renderer, PID **9232**. Seven cached diagnostic
  objects had severity **1**. Their range/message pointers and numeric positions
  were checked, and their error codes were read through the code-string pointers.
  Every range matched a unique original source location. The two `modNetwork`
  records also matched intact cached `textDocument/publishDiagnostics` JSON.
  Only decoded diagnostic evidence is committed, not process-memory dumps.

Verification completed without a compiler: the patch applies to a pristine
source copy and reverses to the original bytes; all five VM source hashes and
all five `.orig` hashes match the recorded values. CRLF line endings,
non-ASCII source bytes and every string literal were preserved. The existing
IDE remains in session **1**, PID **8496**. Its saved `.twinproj` is unchanged,
SHA-256 `f6c48722ef6259ae048dfb0bc4f673a33e3d5f52e1355e52b252bd689b110261`.
It embeds the old sources, so these disk edits require **human re-import** before
any subsequent human build can validate the fixes. The 220 warnings and runtime
server behavior have not been validated or changed by this work.

## Start the server after the human build

From `~/Projects/ao-client` on the Mac:

```sh
scripts/vm-ssh.sh 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:/ao/start-server.ps1'
```

This creates an interactive scheduled task with working directory `C:\ao\server`
and waits for a TCP 7667 listener. It refuses to run without the built executable.
Windows must remain logged in. Connect the host client/bridge to
**127.0.0.1:7667**. Server startup itself cannot be verified before the human build.

```sh
scripts/vm-up.sh                  # Start/resume the selected backend with its disk guard
python3 scripts/vm/host.py status # VM state and host free space
scripts/vm-ssh.sh                 # Guest PowerShell
scripts/vm-down.sh                # Graceful guest shutdown; no forced power-off
```

## Installation details

The supplied Microsoft English (UK) ARM64 ISO is **8,543,594,496 bytes**, SHA-256
`500bcb6f272b7c455156470ea06816f558f13b885723f84ee9eab7534c7dee61`.
Its Windows 11 Pro image is index 3, ARM64, build **26300.9457**. The original
in `~/Downloads/ao-vm/Win11_ARM64_en-gb.iso` was not modified. Installation used a
hard link and an APFS-cloned no-prompt diagnostic ISO to avoid a full extra copy.
Both installation media were ejected after setup; the two task-created Windows
ISO links/copies were removed. The orchestrator subsequently deleted the original
download to recover host space. Installed boots attach neither installer nor
seed media and do not require the deleted ISO.

Setup uses a local administrator, auto-logon, hidden online-account/OOBE pages,
Compact OS, disabled hibernation and automatic updates, key-only OpenSSH, and
RDP disabled. The public Pro installation key selects the edition and does not
activate Windows. Secure Boot uses UTM's firmware and preloaded Microsoft keys.
The fallback has no TPM: Homebrew QEMU's TPM TIS device failed with
`HV_BAD_ARGUMENT` on this M1. Setup overrides the TPM and 64 GB storage checks.

Installed and verified:

- **twinBASIC Community 1044**, extracted at `C:\ao\twinbasic` and opened in the
  logged-in console. The human has completed its first-run dialogs and build
  attempt; see the compile-fix investigation above.
- Microsoft's built-in x86 VB6 runtime and five signed controls/libraries from
  KB2708437: `comctl32.ocx`, `msinet.ocx`, `msdatgrd.ocx`, `msstdfmt.dll`,
  `msbind.dll`. All five registered successfully with x86 `regsvr32`.
- Microsoft Visual C++ x86 runtime **14.52.37029**, needed by Aurora's
  `MSVCP140.dll` and `VCRUNTIME140.dll` imports. Microsoft's installer signature
  was valid. Aurora.Network 1.5 and DX8VB both registered successfully.
- SQLite x86 ODBC: **32-bit Aurora COM activation and an ADO/SQLite `SELECT 1`
  query passed** against `C:\ao\server\Database.db`.
- WebView2 is present (file versions **152.0.4191.66** and **158.0.4370.33** in
  the Windows runtime directories).
- Original classic source at **`caac31333f7cefdbe2b7771cf309e555b33a563e`** is in
  `C:\ao\server`, with fresh INIs/database; maps/data are in `C:\ao\Recursos`.
- Microsoft OpenSSH **10.4.0.0p1-Preview ARM64**, signed and running automatically.
  Dedicated-key SSH and SFTP both work. `Confirm-SecureBootUEFI` returned `True`.

`C:\ao\ready.txt` and private host `provisioned.json` record successful
provisioning. The post-build launcher was tested with the missing executable
and correctly refused to start. At provisioning closeout no source import,
compiler invocation, server launch or live client test had occurred; the later
human build attempt is recorded above. UTM's macOS startup failure remains;
the working fallback is QEMU. The guest remains unactivated.

See [the provisioning notes](../scripts/vm/README.md) and
[the build log](BUILD-LOG.md) for exact host commands, diagnostics and limitations.

Provisioning closeout at **11:57:51 UTC**: QEMU running, SSH reachable,
local console active, twinBASIC responsive; host free **16,936,652,800 bytes
(16.94 GB)**, minimum observed **16.37 GB**, above the approved
12 GB floor. The disk guard remains active. Elapsed wall-clock through this
check: **1 h 9 min 56 s** since 10:47:55 UTC; commit/push follow.

VNC repair verified at **12:52:25 UTC**: Windows was shut down gracefully over
SSH and QEMU restarted with **`-vnc 127.0.0.1:5,password=on`**, without installer
or seed drives. QMP loaded the private eight-character password; the password
file remains mode **600**. RFB 3.8 and 3.3 client handshakes confirmed **VNC
security type 2**, and an invalid authentication response was rejected.
SSH works, `aobuilder` is active in console session **1**, and twinBASIC process
**3772** is responsive with its **twinBASIC IDE** window present. The window
check ran in that interactive session; no project import or build was performed.
QEMU and the disk guard remain running with more than **22 GB** host space free.

Display repair visually verified at **12:58:56 UTC**: the old process already
had `ramfb`, but its screenshot showed only "Guest has not initialized the
display (yet)" and Windows enumerated no video controller. The guest already
contained ARM64 **viogpudo 22.7.38.43** (`oem1.inf`). After a graceful SSH
shutdown, QEMU restarted with **`virtio-gpu-pci` as the primary display** and
ramfb retained. Private `qemu-display.json` persists this selection; an absent
configuration still defaults to ramfb. Existing PCI device order, USB keyboard
and absolute tablet, firmware, disk, memory, CPUs, forwards and VNC password
authentication were retained. QMP reloaded the same private password.

Windows reports **Red Hat VirtIO GPU DOD controller**, **Status OK**, error code
**0**, at **1024×768**. Auto-logon and SSH succeeded; `AOTwinBASIC` was started
with its existing interactive principal. The saved screenshot shows the Windows
taskbar and twinBASIC licence agreement, ready for the human to continue step 2.
No licence acceptance, project import or build was performed. QEMU PID **45351**
and disk guard PID **45353** remain running; host free space at verification was
**22,620,073,984 bytes (22.62 GB)**. The guard's historical minimum is **14.01 GB**,
above the 12 GB floor. See the [display configuration notes](../scripts/vm/README.md).
