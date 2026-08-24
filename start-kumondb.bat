@echo off
setlocal

set "PROJECT_DIR=D:\Project\KumonDB"
set "APP_URL=http://localhost:3000/login.html"

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$portOpen = Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue; " ^
  "if (-not $portOpen) { " ^
  "  Start-Process powershell -ArgumentList '-NoExit', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ('Set-Location -LiteralPath ''%PROJECT_DIR%''; npm start'); " ^
  "}"

timeout /t 3 /nobreak >nul
start "" "%APP_URL%"

endlocal
