# Sets SizeOfStackReserve of a built PE32 exe (twinBASIC defaults to 1 MB; the VB6 server has procedures with 0.7-1.5 MB frames).
# Permanent fix: twinBASIC Project Settings > Build Stack Reserve Size (project.buildStackReserveSize) = 67108864, then rebuild.
param([string]$Path = 'C:\ao\server\server.exe', [uint32]$Reserve = 67108864)
$b = [IO.File]::ReadAllBytes($Path)
$pe = [BitConverter]::ToInt32($b, 0x3C); $opt = $pe + 24
if ([BitConverter]::ToUInt16($b, $opt) -ne 0x10B) { throw 'not a PE32 image' }
$off = $opt + 72                                   # SizeOfStackReserve
'before: ' + [BitConverter]::ToUInt32($b, $off)
[BitConverter]::GetBytes($Reserve).CopyTo($b, $off)
[IO.File]::WriteAllBytes($Path, $b)
'after: ' + [BitConverter]::ToUInt32([IO.File]::ReadAllBytes($Path), $off)
