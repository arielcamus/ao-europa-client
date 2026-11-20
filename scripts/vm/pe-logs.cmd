@echo off
:again
for %%p in (X:\Windows\Panther X:\$WINDOWS.~BT\Sources\Panther C:\$WINDOWS.~BT\Sources\Panther C:\Windows\Panther) do (
  if exist %%p\setupact.log curl.exe -s --max-time 5 -T %%p\setupact.log http://10.0.2.2:18081/setupact.log
  if exist %%p\setuperr.log curl.exe -s --max-time 5 -T %%p\setuperr.log http://10.0.2.2:18081/setuperr.log
)
ping -n 11 127.0.0.1 > nul
goto again
