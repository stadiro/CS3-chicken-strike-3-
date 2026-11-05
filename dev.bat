@echo off
chcp 65001 >nul
cd /d "%~dp0"
set "PATH=C:\Program Files\nodejs;%APPDATA%\npm;%LOCALAPPDATA%\Programs\node;%PATH%"

where node >nul 2>&1
if %errorLevel% neq 0 (
    echo [INFO] Node.js не найден. Запуск полной автоматической настройки setup.bat...
    call setup.bat
    exit /b
)

if not exist "node_modules\" (
    echo [INFO] Зависимости не установлены. Запуск npm install...
    call npm install
)

echo ========================================================
echo   Запуск WOW Arena в режиме разработки (npm run dev)
echo ========================================================
echo.
call npm run dev
pause
