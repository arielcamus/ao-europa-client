$ErrorActionPreference = 'Stop'
$exe = 'C:\ao\server\server.exe'
if (-not (Test-Path $exe)) { throw 'server.exe is missing. A human must build it in twinBASIC first.' }
$action = New-ScheduledTaskAction -Execute $exe -WorkingDirectory C:\ao\server
$principal = New-ScheduledTaskPrincipal -UserId aobuilder -LogonType Interactive -RunLevel Highest
$running = Get-ScheduledTask -TaskName AOClassicServer -ErrorAction SilentlyContinue
if ($running.State -ne 'Running') {
    Register-ScheduledTask -TaskName AOClassicServer -Action $action -Principal $principal -Force | Out-Null
    Start-ScheduledTask -TaskName AOClassicServer
}
foreach ($attempt in 1..30) {
    $listener = Get-NetTCPConnection -State Listen -LocalPort 7667 -ErrorAction SilentlyContinue
    if ($listener) {
        foreach ($socket in $listener) {
            if ((Get-Process -Id $socket.OwningProcess -ErrorAction Stop).Path -ieq $exe) {
                $socket | Select-Object LocalAddress,LocalPort,OwningProcess
                exit 0
            }
        }
        throw 'TCP 7667 belongs to another executable, not C:\ao\server\server.exe.'
    }
    Start-Sleep 1
}
throw 'No TCP listener on 7667 after 30 seconds. Inspect the server window and C:\ao\server logs.'
