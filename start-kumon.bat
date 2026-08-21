@echo off
cd /d D:\Project\KumonDB

start "KumonDB Server" cmd /k "npm run dev"

timeout /t 2 /nobreak >nul

start "" http://localhost:3000/worksheet.html