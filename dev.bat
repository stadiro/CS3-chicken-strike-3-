@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ========================================================
echo   Запуск WOW Arena в режиме разработки (npm run dev)
echo ========================================================
echo.
npm run dev
pause
