@echo off
chcp 65001 >nul
title Bilimlar bellashuvi - server (bu oynani YOPMANG)
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js topilmadi. https://nodejs.org dan o'rnating. & pause & exit /b 1)
start "" /b cmd /c "timeout /t 2 >nul & start http://localhost:3777/host"
node server.js
pause
