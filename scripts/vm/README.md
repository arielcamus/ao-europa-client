# Original AO server: Windows / twinBASIC handoff

**Status, 20 November 2026: preparation is blocked before Windows installation.**
UTM **5.0.9-2** is installed through Homebrew and passes macOS notarization
assessment. `ao-build.utm` is staged, **not imported, booted, or logged in**.
Windows, SSH, twinBASIC and COM/ODBC dependencies are **not installed in a guest**.
There is no guest IP or listening forwarded port, and no `server.exe` was built.

The Microsoft ARM64 download API returned `ErrorSettings.SentinelReject`.
Computer Use returned **“Computer Use was not approved to use UTM”** and the
same rejection for Google Chrome; browser inventory also reports its access host
unavailable. The public evaluation download link inspected resolves to **x64**.
`utmctl --help` also failed to start (one attempt was terminated after several
minutes, a second timed out after 10 seconds). No alternate UI mechanism was used.
Resume needs an official ARM64 ISO and working UTM access/launch; enabling Chrome
may permit the normal Microsoft download flow.

## Prepared locally

Everything private or binary is outside Git, in
`~/Projects/ao-reference/runtime/ao-vm/` (directory mode 0700):

- `ao-build.utm`: ARM64/HVF, 4 CPUs, **4096 MiB RAM**, TPM/UEFI, **40,000,000,000-byte
  sparse raw disk** (0 bytes allocated before first boot). No snapshots.
- Emulated VLAN forwards **127.0.0.1:2222 → guest TCP 22** and
  **127.0.0.1:7667 → guest TCP 7667**. Expected QEMU DHCP IP is 10.0.2.15;
  it has **not been observed**.
- `seed/autounattend.xml` and `ao-build.utm/Data/seed.iso`: local administrator
  `aobuilder`, random password, auto-logon, Compact OS, ARM64 network/display
  drivers, key-only OpenSSH bootstrap, RDP off. Credentials are in private
  `identity.json` / `id_ed25519`; never commit these or the seed ISO.
- `payload.zip`: pinned classic source `caac31333f7cefdbe2b7771cf309e555b33a563e`,
  maps/Dat, example INIs and fresh SQLite database; **PYMMO=0**, explicitly
  **DIRECT_PLAY=0**. Original Windows-1252 source bytes are preserved except for
  that VBP constant. Mutable INI paths point into this isolated server copy.
- twinBASIC Community **beta 1044**, Microsoft VB6 extended runtime controls,
  Microsoft WebView2 installer, SQLite x86 ODBC installer, and upstream Aurora /
  DirectX libraries. twinBASIC is a portable ZIP, with no installer to click.
  `sources.json` records provenance and hashes; publisher digests were verified
  for twinBASIC and UTM guest tools. Other recorded hashes are local fingerprints.

The 40 GB disk is below Microsoft's 64 GB Windows 11 storage requirement; the
answer file relaxes **only the storage check** to meet the requested capacity.
It does not activate Windows. `vm-up.sh` requires 28 GiB host free and starts a
monitor that requests a pause below 28 GiB, without saving 4 GiB of RAM to disk.
This is a polling safeguard, not a filesystem quota; other host writers can also
consume space. Do not start this VM directly in UTM without the monitor.

## Resume provisioning (next authorized session)

1. Obtain the English ISO from [Microsoft's ARM64 download page](https://www.microsoft.com/en-us/software-download/windows11arm64).
   For the currently advertised 26H2 English ISO, Microsoft publishes SHA-256
   `8992f2d2cfd2fa647e579e9eb31fc21f34da8333c29b6170fde17d2ed6623e9c`.
   Keep checking `df -h .`; do not download if that would cross the reserve.
2. With the downloaded UTM guest-tools ISO mounted, run:

   ```sh
   hdiutil attach -readonly -nobrowse "$HOME/Projects/ao-reference/runtime/ao-vm/utm-guest-tools-0.1.271.iso"
   python3 scripts/vm/prepare.py --iso "$HOME/Downloads/Win11_26H2_English_Arm64.iso"
   ```

   This verifies the hash and ARM64 boot loader, uses a hard link on the same
   filesystem to avoid a second ISO copy, and does not start the VM. For a
   different official ISO, provide Microsoft's corresponding `--sha256`.
3. In UTM, **File → Open…**, select
   `~/Projects/ao-reference/runtime/ao-vm/ao-build.utm`. Then run
   `scripts/vm-up.sh`. If the DVD boot prompt appears, press Return inside the VM.
   Allow the unattended install and `C:\ao\bootstrap.log` to finish. Do not boot
   the installation DVD again: its answer file wipes **guest disk 0**.
4. After SSH responds, run `scripts/vm/install-over-ssh.sh`. It copies the
   package to `C:\ao`, installs/registers the x86 dependencies, probes Aurora COM
   activation and an ADO/SQLite query, and starts the IDE in the logged-in desktop.
   It does **not** open/import the project or request a build. If an installer
   cannot finish unattended, stop there and report its log/exit code.
5. Verify the visible Windows desktop and twinBASIC window; inspect `C:\ao\ready.txt`,
   `C:\ao\network.txt`, and `C:\ao\install.log` over SSH. Eject installation media
   in UTM after setup and reclaim its task-owned files when no longer attached.
   Retain the running VM, with its display visible and the disk monitor active.

## Human import and build clicks

These are the publisher-documented paths, **not a verified observation of this
guest**, which has not booted yet. In the **twinBASIC window inside UTM ao-build**:

1. **File → Open Project…** (`Ctrl+O`) → `C:\ao\server\Server.VBP` → **Open**.
   Alternatively, the New/Open dialog has **New → Import from VBP…**.
2. Complete **New Project Options**, then **File → Save Project** as
   `C:\ao\server\Server.twinproj`; save once more with `Ctrl+S`.
3. Choose **win32** in the build-configuration toolbar box. Open the **Project
   Settings gear** in Project Explorer; search **Conditional Compilation Args**
   and confirm `PYMMO=0`, `DIRECT_PLAY=0`, `UNIT_TEST=0`. Search **Build Output Path**,
   set **`C:\ao\server\server.exe`**, click **Apply Changes**, and save.
4. The **human** clicks **File → Build** (or the toolbar **Build** button).
   Inspect **DEBUG CONSOLE**. A successful build writes the path configured above;
   source compatibility is not established until that succeeds. `F5` runs inside
   the IDE and is not the executable-build command.

[VBP import](https://docs.twinbasic.com/tB/IDE/Starting/Importing-VB6),
[build command](https://docs.twinbasic.com/tB/IDE/Building/Build-and-Clean), and
[output path](https://docs.twinbasic.com/tB/IDE/Building/Build-Output) are documented
by the publisher. Community excludes automated builds / CI in its
[licensing table](https://twinbasic.com/licensing); no build automation is included.

After a successful human build, start the server from the Mac:

```sh
scripts/vm-ssh.sh 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:/ao/start-server.ps1'
```

That creates an interactive scheduled task with working directory `C:\ao\server`
and waits for TCP 7667. It does not compile. Windows must remain logged in. A
missing listener is reported as an error; a running process alone is not success.
Connect the host bridge/bot to **127.0.0.1:7667**. `scripts/vm-down.sh` requests a
graceful guest shutdown and refuses to force-kill it. `scripts/vm-up.sh` restarts
or resumes it, and `scripts/vm-ssh.sh` opens PowerShell.

## Verification and timing

Host checks passed: shell/Python syntax, XML/plist parsing, archive CRCs, required
payload files, PYMMO/DirectPlay values, sparse disk size/allocation, and refusal
to start without Windows media. Windows bootstrap, installers, COM activation,
SSH, desktop visibility, import, compilation and server startup remain untested.
Concurrent client/UI edits in the shared checkout are outside this VM change.
Measured session start: **2026-11-20 10:13:15 UTC**; closeout below records elapsed
time and host space after the final checks.

At **10:30:10 UTC** (16m 55s after the first recorded clock reading), the host
had **36,832,628 KiB free = 35.13 GiB / 37.72 decimal GB**. The staged task
directory occupies 482 MiB, including its payload and guest-tools media. The
40 GB guest system disk still has **0 physical bytes allocated**. Both loopback
ports were checked and were **not listening**. A simulated low-space condition
verified refusal to start and a pause request without saving RAM. Private keys,
credentials and the generated answer file were checked as mode 0600. The UTM
guest-tools ISO was detached from macOS after staging. No VM process or disk
monitor is running. Final response timing also includes Git closeout.
