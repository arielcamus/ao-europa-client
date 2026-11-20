$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force C:\ao | Out-Null
Start-Transcript -Path C:\ao\bootstrap.log -Append
try {
    powercfg.exe /hibernate off
    powercfg.exe /change standby-timeout-ac 0
    powercfg.exe /change monitor-timeout-ac 0
    Set-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\Terminal Server' fDenyTSConnections 1
    Disable-NetFirewallRule -DisplayGroup 'Remote Desktop' -ErrorAction SilentlyContinue
    # Drivers are from UTM's official guest-tools ISO, pinned in the manifest.
    pnputil.exe /add-driver "$PSScriptRoot\drivers\*.inf" /subdirs /install
    if ($LASTEXITCODE -notin 0, 3010) { throw "pnputil failed: $LASTEXITCODE" }
    $network = $false
    foreach ($attempt in 1..60) {
        if (Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue) { $network = $true; break }
        Start-Sleep 2
    }
    if (-not $network) { throw 'No network route after installing UTM ARM64 drivers' }
    # Official Microsoft ARM64 package, hash checked by prepare.py. Install
    # offline so bootstrap does not need Windows Update / Features on Demand.
    $sshHome = 'C:\Program Files\OpenSSH'
    if (-not (Get-Service sshd -ErrorAction SilentlyContinue)) {
        Expand-Archive "$PSScriptRoot\OpenSSH-ARM64.zip" C:\ao\openssh-stage -Force
        Move-Item C:\ao\openssh-stage\OpenSSH-ARM64 $sshHome
        if ((Get-AuthenticodeSignature "$sshHome\sshd.exe").Status -ne 'Valid') {
            throw 'Invalid Microsoft OpenSSH signature'
        }
        & "$sshHome\install-sshd.ps1"
    }
    Set-Service sshd -StartupType Automatic
    Start-Service sshd
    $keys = 'C:\ProgramData\ssh\administrators_authorized_keys'
    Copy-Item "$PSScriptRoot\authorized_keys" $keys -Force
    icacls.exe $keys /inheritance:r /grant '*S-1-5-18:F' '*S-1-5-32-544:F' | Out-Null
    if ($LASTEXITCODE) { throw 'Could not restrict SSH key ACL' }
    @'
Port 22
PubkeyAuthentication yes
PasswordAuthentication no
KbdInteractiveAuthentication no
AllowUsers aobuilder
AuthorizedKeysFile __PROGRAMDATA__/ssh/administrators_authorized_keys
Subsystem sftp C:/PROGRA~1/OpenSSH/sftp-server.exe
'@ | Set-Content C:\ProgramData\ssh\sshd_config -Encoding ascii
    & "$sshHome\sshd.exe" -t
    if ($LASTEXITCODE) { throw 'Invalid sshd_config' }
    New-ItemProperty 'HKLM:\SOFTWARE\OpenSSH' -Name DefaultShell -Value "$env:WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe" -PropertyType String -Force | Out-Null
    if (-not (Get-NetFirewallRule -Name 'OpenSSH-Server-In-TCP' -ErrorAction SilentlyContinue)) {
        New-NetFirewallRule -Name 'OpenSSH-Server-In-TCP' -DisplayName 'AO build SSH' -Direction Inbound -Protocol TCP -LocalPort 22 -Action Allow | Out-Null
    }
    Restart-Service sshd
    Set-LocalUser aobuilder -PasswordNeverExpires $true
    Get-NetIPAddress -AddressFamily IPv4 | Format-Table | Out-String | Set-Content C:\ao\network.txt
    & "$sshHome\ssh-keygen.exe" -lf C:\ProgramData\ssh\ssh_host_ed25519_key.pub | Set-Content C:\ao\ssh-host-fingerprint.txt
    'SSH bootstrap completed; dependencies must still be installed over SSH.' | Set-Content C:\ao\bootstrap-complete.txt
} finally { Stop-Transcript }
