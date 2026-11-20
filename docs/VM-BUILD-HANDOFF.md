# AO Windows build handoff

**20 November 2026 — the first human twinBASIC build failed.** The human imported
`C:\ao\server\Server.VBP` with Option Explicit OFF, saved
`C:\ao\server\Argentum20Server.twinproj`, and used File → Build in Community
BETA 1044. The reported result is **7 errors and 220 warnings**, with
`[LINKER] FAILED due to compilation errors 'C:\ao\server\server.exe'` and
`[BUILD] failed`. See [twinBASIC compile fixes](#twinbasic-compile-fixes) below.
Windows, SSH and the VNC desktop are available; dependency validation passed.

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

Read-only investigation started **20 November 2026 at 13:10:02 UTC**. No
twinBASIC executable, import, compiler restart, build command or IDE automation
was invoked. The running IDE and saved project were left untouched.

The seven compile diagnostics were **not found in the persisted data inspected**:

- `C:\ao\server`, `C:\ao\twinbasic`, `%APPDATA%\twinBASIC`, `%TEMP%` and
  `C:\Windows\Temp` had no readable compile-error log. The exact directory
  `%LOCALAPPDATA%\twinBASIC` does not exist. The actual `twinBASIC_Admin` and
  `twinBASIC_WebPanel_Admin` profiles contain WebView storage/maintenance logs;
  their readable logs had no AO compile diagnostics. Two recent nonempty
  `.tmp` files were read using shared read access: they are PNG/JPEG background
  images, visually inspected, with no diagnostic text.
- A local copy of `Argentum20Server.twinproj` was parsed as a binary container,
  without running twinBASIC. All **214 entries / 5,489,314 bytes** were consumed.
  Its SHA-256 is
  `f6c48722ef6259ae048dfb0bc4f673a33e3d5f52e1355e52b252bd689b110261`.
  Neither its `.meta` nor its other entries contain a compile-error report.
- The embedded `Sources/__IMPORT_LOG.md` ends with **5 ERRORS/WARNINGS**. All
  five are reference-path conversion warnings for ADO, Scripting Runtime,
  MSXML, Aurora.Network and DX8VB; they are unrelated to the reported count of
  seven compile errors. The log explicitly directs the reader to DIAGNOSTICS.
- The registry value under
  `HKCU\Software\VB and VBA Program Settings\twinBASIC_IDE\ProjectState`
  for this project contains editor/layout state, no diagnostics, and an empty
  `debugConsoleEntryHistory` (console command history). Both that state and
  `.meta` have `problemsPanelOptions.showErrors=false`, so the human may need
  to click the red error counter to display the error rows.

This agrees with the publisher's [diagnostic-tool documentation](https://docs.twinbasic.com/tB/IDE/Troubleshooting/Diagnostic-Tools):
the build/debug console is held in memory and is not written to a log file.
The [container format](https://docs.twinbasic.com/Features/Packages/File-Format)
describes `.meta` as editor state. Inspection of BETA 1044's installed
`ide/main.js` also confirms that diagnostics are cached in memory and omitted
from the saved project-state object.

**Exact error list and source patch: pending the existing DIAGNOSTICS report.**
The human can right-click in DIAGNOSTICS → **Copy All Errors** and paste the
report; this requires no new build. The [diagnostics documentation](https://docs.twinbasic.com/tB/IDE/Code/Diagnostics)
describes the report's file, position, code and message fields. The seven
messages must be captured before claiming seven diagnosed or fixed errors.

The reported `UserMod.GetNextAvailableUserSlot at line #1` maps to
`C:\ao\server\Codigo\Modulo_UsUaRiOs.bas`, whose function starts on physical
file line **93**. Physical line **97** is a bare `Return`, and the procedure has
no `GoSub`. The original file and its saved imported copy are byte-identical.
This is a candidate requiring the actual diagnostic, not an extracted error.
The current [Return reference](https://docs.twinbasic.com/tB/Core/Return)
reserves bare `Return` for `GoSub`; [warning TB0027](https://docs.twinbasic.com/Features/Compiler-IDE/Compiler-Warnings)
covers a return without a preceding `GoSub`. Historical [issue #1344](https://github.com/twinbasic/twinbasic/issues/1344)
reported import errors for `Return` in BETA 170; it does not establish a BETA
1044 defect. Replacing it blindly with `Exit Function` would remove VB6's
runtime error-3 path, so no such change has been applied without the report.

No original source files have been changed and no `.orig` backups or source
patch have yet been created. Once confirmed fixes are applied to the original
VB6 files, a **human re-import of `Server.VBP` is required**: the existing
`.twinproj` embeds its own copies. A successful re-import/build remains
unverified and must be performed by the human under the Community licence.

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
