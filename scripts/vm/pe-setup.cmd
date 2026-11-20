@echo off
setlocal
set "AOLOG=X:\ao-pe.log"
echo Starting AO unattended setup > "%AOLOG%"
wpeinit >> "%AOLOG%" 2>&1
for %%d in (C D E F G H I J K L M N O P Q R S T U V W Y Z) do if exist %%d:\autounattend.xml set "AOSEED=%%d:"
echo Seed drive: %AOSEED% >> "%AOLOG%"
drvload "%AOSEED%\drivers\NetKVM\netkvm.inf" >> "%AOLOG%" 2>&1
wpeutil InitializeNetwork >> "%AOLOG%" 2>&1
ipconfig >> "%AOLOG%" 2>&1
curl.exe -sS --max-time 10 -T "%AOLOG%" http://10.0.2.2:18081/pe-start.log
start "" /b cmd.exe /c X:\Windows\System32\ao-logs.cmd
X:\sources\setup.exe /unattend:%AOSEED%\autounattend.xml >> "%AOLOG%" 2>&1
echo Setup exit: %ERRORLEVEL% >> "%AOLOG%"
curl.exe -sS --max-time 10 -T "%AOLOG%" http://10.0.2.2:18081/pe-start.log
endlocal
