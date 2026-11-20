# AO Windows build handoff

**20 November 2026 — blocked before Windows installation; not ready to build.**
UTM **5.0.9-2** is installed and notarization verified. The `ao-build.utm` bundle
is staged but **not imported or running**. No guest IP exists; SSH/game forwards
are configured but inactive. Nothing is installed in Windows and no build ran.

Blockers: Microsoft's ARM64 ISO API returned `SentinelReject`; Computer Use denied
UTM and Chrome access and its browser host is unavailable. The evaluation link
checked supplies x64. `utmctl --help` also hung, including a bounded 10-second retry.
Resume requires an official ARM64 ISO and working UTM access/launch.

Local staging: `~/Projects/ao-reference/runtime/ao-vm/`. Configuration:
**4096 MiB RAM**, **40 GB sparse disk**, local admin `aobuilder`, auto-logon,
key-only OpenSSH, RDP off; loopback **2222 → 22** and **7667 → 7667**, TCP.
Private credentials, media and source packages stay outside Git. The payload
contains twinBASIC Community **1044**, VB6 controls, WebView2, Aurora.Network,
SQLite x86 ODBC, pinned original server source, maps/data and fresh config/database.
These are **staged on the Mac, not installed in a guest**.

The launcher requires 28 GiB free and monitors space, requesting a pause below
28 GiB to protect the 25 GB reserve. The requested 40 GB disk is below Microsoft's
64 GB minimum; the answer file relaxes only that storage check. Full resume steps,
hashes, limitations and validation are in [the provisioning notes](../scripts/vm/README.md).

**Human clicks, after provisioning succeeds** (publisher-documented; not observed
in this unbooted guest):

1. In the **twinBASIC window inside UTM → ao-build**, choose **File → Open Project…**
   → `C:\ao\server\Server.VBP` → **Open**, then complete **New Project Options**.
2. **File → Save Project** → `C:\ao\server\Server.twinproj`; press `Ctrl+S` again.
3. Select **win32** on the toolbar. In Project Explorer, click the **Project
   Settings gear**. Search **Conditional Compilation Args** and confirm
   `PYMMO=0`, `DIRECT_PLAY=0`, `UNIT_TEST=0`. Search **Build Output Path**, set
   **`C:\ao\server\server.exe`**, click **Apply Changes**, then save.
4. The **human** clicks **File → Build** (or toolbar **Build**). Inspect
   **DEBUG CONSOLE** for errors and the output path. `F5` is not this build command.

Sources: twinBASIC's [VBP import](https://docs.twinbasic.com/tB/IDE/Starting/Importing-VB6),
[build menu](https://docs.twinbasic.com/tB/IDE/Building/Build-and-Clean), and
[output setting](https://docs.twinbasic.com/tB/IDE/Building/Build-Output).
[Community licensing](https://twinbasic.com/licensing) excludes automated builds;
the scripts contain no compiler/import/build invocation.

After a successful human build, start the server over SSH:

```sh
scripts/vm-ssh.sh 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:/ao/start-server.ps1'
```

This starts an interactive scheduled task in `C:\ao\server` and verifies a TCP
7667 listener. Windows must remain logged in. Use **127.0.0.1:7667** from the Mac.
`scripts/vm-up.sh` starts/resumes with disk checks; `scripts/vm-down.sh` requests
graceful shutdown; `scripts/vm-ssh.sh` opens PowerShell. Guest execution, VBP
compatibility and server startup remain untested.
