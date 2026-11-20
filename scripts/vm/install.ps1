# Run over SSH AFTER bootstrap. No import, build, compiler command, or F5.
param([switch]$SkipExtraction)
$ErrorActionPreference = 'Stop'
Start-Transcript -Path C:\ao\install.log -Append
try {
    if (-not $SkipExtraction) {
        Expand-Archive C:\ao\payload.zip C:\ao -Force
        Expand-Archive C:\ao\deps\twinBASIC_IDE_BETA_1044.zip C:\ao\twinbasic -Force
    }
    $regsvr32 = "$env:WINDIR\SysWOW64\regsvr32.exe"
    if (-not (Test-Path "$env:WINDIR\SysWOW64\msvbvm60.dll")) {
        throw 'Windows does not provide the x86 VB6 runtime. Stop and obtain an official Microsoft runtime.'
    }
    foreach ($name in 'comctl32.ocx','msinet.ocx','msdatgrd.ocx','msstdfmt.dll','msbind.dll') {
        $source = "C:\ao\deps\vb6\$name"
        if (-not (Test-Path $source)) { throw "Missing Microsoft runtime dependency $name" }
        if ((Get-AuthenticodeSignature $source).Status -ne 'Valid') { throw "Invalid Microsoft signature: $source" }
        Copy-Item $source "$env:WINDIR\SysWOW64\$name" -Force
        $p = Start-Process $regsvr32 -ArgumentList '/s',"$env:WINDIR\SysWOW64\$name" -Wait -PassThru
        if ($p.ExitCode) { throw "Registration failed: $name ($($p.ExitCode))" }
    }
    # Aurora imports MSVCP140 and VCRUNTIME140; Windows does not include them.
    $vcRuntime = 'C:\ao\deps\vc_redist.x86.exe'
    $signature = Get-AuthenticodeSignature $vcRuntime
    if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'O=Microsoft Corporation') {
        throw 'Invalid Microsoft signature on the x86 Visual C++ redistributable.'
    }
    $p = Start-Process $vcRuntime -ArgumentList '/install','/quiet','/norestart' -Wait -PassThru
    if ($p.ExitCode -notin 0,3010) { throw "Visual C++ runtime installation failed ($($p.ExitCode))" }
    foreach ($name in 'Aurora.Network.dll','DX8VB.DLL') {
        $p = Start-Process $regsvr32 -ArgumentList '/s',"C:\ao\server\$name" -Wait -PassThru
        if ($p.ExitCode) { throw "Registration failed: $name ($($p.ExitCode))" }
    }
    # The SQLite driver publisher uses NSIS: /S is its silent install switch.
    $p = Start-Process C:\ao\deps\sqliteodbc.exe -ArgumentList '/S' -Wait -PassThru
    if ($p.ExitCode) { throw "SQLite ODBC install failed ($($p.ExitCode))" }
    if (-not (Test-Path 'HKLM:\SOFTWARE\WOW6432Node\ODBC\ODBCINST.INI\SQLite3 ODBC Driver')) {
        throw 'The x86 SQLite3 ODBC driver was not registered.'
    }
    # The IDE uses WebView2. Invoke only Microsoft's installer if Windows lacks it.
    $webview = Get-ChildItem "${env:ProgramFiles(x86)}\Microsoft\EdgeWebView\Application\*\msedgewebview2.exe" -ErrorAction SilentlyContinue
    if (-not $webview) {
        $p = Start-Process C:\ao\deps\MicrosoftEdgeWebView2RuntimeInstallerX86.exe -ArgumentList '/silent','/install' -Wait -PassThru
        if ($p.ExitCode) { throw "WebView2 installer failed ($($p.ExitCode)); inspect its logs before GUI use." }
    }
    if (-not (Get-NetFirewallRule -Name AOClassicServer -ErrorAction SilentlyContinue)) {
        New-NetFirewallRule -Name AOClassicServer -DisplayName 'AO classic TCP 7667' -Direction Inbound -Protocol TCP -LocalPort 7667 -Action Allow | Out-Null
    }
    # An interactive task makes the IDE visible in the auto-logged-in console.
    $principal = New-ScheduledTaskPrincipal -UserId aobuilder -LogonType Interactive -RunLevel Highest
    $action = New-ScheduledTaskAction -Execute C:\ao\twinbasic\twinBASIC.exe -WorkingDirectory C:\ao\server
    Register-ScheduledTask -TaskName AOTwinBASIC -Action $action -Principal $principal -Force | Out-Null
    Start-ScheduledTask -TaskName AOTwinBASIC
    $x86 = "$env:WINDIR\SysWOW64\WindowsPowerShell\v1.0\powershell.exe"
    $probe = @'
$ErrorActionPreference="Stop"
$a=New-Object -ComObject Server.Server
$c=New-Object -ComObject ADODB.Connection
$c.Open("DRIVER={SQLite3 ODBC Driver};DATABASE=C:\ao\server\Database.db")
$r=$c.Execute("select 1")
if($r.Fields.Item(0).Value -ne 1){throw "SQLite probe failed"}
$c.Close()
"x86 Aurora activation and ADO/SQLite query passed"
'@
    $encodedProbe = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($probe))
    & $x86 -NoProfile -EncodedCommand $encodedProbe
    if ($LASTEXITCODE) { throw 'x86 COM/ADO/ODBC validation failed' }
    Get-Process twinBASIC -ErrorAction Stop | Select-Object Id,ProcessName,SessionId
    Get-NetIPAddress -AddressFamily IPv4 | Select-Object IPAddress,InterfaceAlias
    'Dependencies installed; IDE started; project import and build NOT performed.' | Set-Content C:\ao\ready.txt
} finally { Stop-Transcript }
