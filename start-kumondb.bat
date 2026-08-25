@echo off
setlocal

set "PROJECT_DIR=D:\Project\KumonDB"
set "APP_URL=http://localhost:3000/login.html"

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$listeners = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique; " ^
  "foreach ($processId in $listeners) { if ($processId) { Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue } }; " ^
  "Start-Process powershell -ArgumentList '-NoExit', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ('Set-Location -LiteralPath ''%PROJECT_DIR%''; npm run dev');"

timeout /t 4 /nobreak >nul
start "" "%APP_URL%"

endlocal
