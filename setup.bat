@echo off
chcp 65001 >nul
title WOW Arena - Установка и запуск

:: Переходим в папку со скриптом
cd /d "%~dp0"

echo ======================================================================
echo   WOW ARENA — Автоматическая установка и запуск для игры по сети
echo ======================================================================
echo.

:: 1. Проверка прав администратора (нужны для брандмауэра и установки Node.js)
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo [INFO] Запрашиваются права администратора...
    powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process cmd -ArgumentList '/c \"\"%~f0\"\"' -Verb RunAs"
    exit /b
)

:: Добавляем стандартные пути Node.js в текущую сессию
set "PATH=C:\Program Files\nodejs;%APPDATA%\npm;%LOCALAPPDATA%\Programs\node;%PATH%"

:: 2. Проверка наличия Node.js
echo [1/4] Проверка Node.js...
where node >nul 2>&1
if %errorLevel% equ 0 (
    for /f "tokens=*" %%v in ('node -v') do set "NODE_VER=%%v"
    echo   [OK] Node.js уже установлен: %NODE_VER%
) else (
    echo   [!] Node.js не найден на компьютере.
    echo   Скачивание официального установщика Node.js 22 LTS...
    
    set "NODE_MSI=%TEMP%\nodejs-install.msi"
    if exist "%NODE_MSI%" del /f /q "%NODE_MSI%" >nul 2>&1
    
    powershell -NoProfile -ExecutionPolicy Bypass -Command ^
        "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; " ^
        "Write-Host '  Загрузка Node.js LTS MSI (около 30 МБ)...'; " ^
        "$wc = New-Object System.Net.WebClient; " ^
        "$wc.DownloadFile('https://nodejs.org/dist/v22.14.0/node-v22.14.0-x64.msi', $env:NODE_MSI)"

    if not exist "%NODE_MSI%" (
        echo [ОШИБКА] Не удалось скачать Node.js. Проверьте подключение к интернету.
        pause
        exit /b 1
    )

    echo   Установка Node.js (пожалуйста, подождите несколько секунд)...
    msiexec.exe /i "%NODE_MSI%" /qn /norestart
    
    timeout /t 6 /nobreak >nul
    del /f /q "%NODE_MSI%" >nul 2>&1

    set "PATH=C:\Program Files\nodejs;%APPDATA%\npm;%PATH%"
    
    where node >nul 2>&1
    if %errorLevel% neq 0 (
        echo [ОШИБКА] Не удалось завершить автоматическую установку Node.js.
        echo Пожалуйста, установите Node.js вручную с https://nodejs.org
        pause
        exit /b 1
    )
    for /f "tokens=*" %%v in ('node -v') do set "NODE_VER=%%v"
    echo   [УСПЕХ] Node.js успешно установлен: %NODE_VER%
)

:: 3. Настройка Брандмауэра Windows (порты 3000 и 3001)
echo.
echo [2/4] Настройка Брандмауэра Windows для игры по сети...
netsh advfirewall firewall delete rule name="WOW Arena (Port 3000)" >nul 2>&1
netsh advfirewall firewall delete rule name="WOW Arena Admin (Port 3001)" >nul 2>&1
netsh advfirewall firewall add rule name="WOW Arena (Port 3000)" dir=in action=allow protocol=TCP localport=3000 profile=any >nul
netsh advfirewall firewall add rule name="WOW Arena Admin (Port 3001)" dir=in action=allow protocol=TCP localport=3001 profile=any >nul
echo   [OK] Порты 3000 и 3001 открыты в брандмауэре.

:: 4. Установка зависимостей проекта (npm install)
echo.
echo [3/4] Проверка зависимостей проекта (npm install)...
call npm install
if %errorLevel% neq 0 (
    echo [ОШИБКА] Не удалось установить npm-пакеты.
    pause
    exit /b 1
)
echo   [OK] Все зависимости установлены.

:: 5. Вывод ссылок и запуск dev-сервера
echo.
echo [4/4] Запуск сервера WOW Arena!
echo ======================================================================
echo   Ссылка для игры на ЭТОМ компьютере:
echo     👉 http://localhost:3000
echo.
echo   Ссылки для игры со ВТОРОГО компьютера (в этой же сети/Wi-Fi):
node -e "const os = require('os'); for (const [name, nets] of Object.entries(os.networkInterfaces())) { for (const net of nets) { if (net.family === 'IPv4' && !net.internal && !net.address.startsWith('169.254.')) { console.log('    👉 http://' + net.address + ':3000  (' + name + ')'); } } }"
echo ======================================================================
echo.
echo Запуск npm run dev (для остановки нажмите Ctrl+C)...
echo.
call npm run dev
pause
