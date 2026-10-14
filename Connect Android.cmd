@echo off
cd /d "%~dp0"
echo This connects your authorized USB test phone and updates the Farmconnect preview APK.
node scripts\start-farmconnect.mjs --phone --install
pause
