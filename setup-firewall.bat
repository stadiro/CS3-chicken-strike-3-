@echo off
chcp 65001 >nul
:: Проверка прав администратора
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo [INFO] Запрос прав администратора для настройки Брандмауэра Windows...
    powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process cmd -ArgumentList '/c \"\"%~f0\"\"' -Verb RunAs"
    exit /b
)

echo ======================================================================
echo   Настройка Брандмауэра Windows для WOW Arena
echo ======================================================================
echo.

:: Удаляем старые правила если уже существовали
netsh advfirewall firewall delete rule name="WOW Arena (Port 3000)" >nul 2>&1
netsh advfirewall firewall delete rule name="WOW Arena Admin (Port 3001)" >nul 2>&1

:: Добавляем входящие правила для порта 3000 (игра и клиент) и 3001 (панель)
netsh advfirewall firewall add rule name="WOW Arena (Port 3000)" dir=in action=allow protocol=TCP localport=3000 profile=any >nul
netsh advfirewall firewall add rule name="WOW Arena Admin (Port 3001)" dir=in action=allow protocol=TCP localport=3001 profile=any >nul

if %errorLevel% equ 0 (
    echo [УСПЕХ] Порты 3000 и 3001 успешно открыты в Брандмауэре Windows!
    echo Теперь другие компьютеры и устройства в вашей сети могут подключаться к игре.
) else (
    echo [ОШИБКА] Не удалось настроить брандмауэр. Попробуйте запустить скрипт от имени администратора.
)

echo.
echo IP-адреса этого компьютера в локальной сети:
node -e "const os = require('os'); for (const [name, nets] of Object.entries(os.networkInterfaces())) { for (const net of nets) { if (net.family === 'IPv4' && !net.internal && !net.address.startsWith('169.254.')) { console.log('  👉 http://' + net.address + ':3000  (' + name + ')'); } } }"
echo.
echo ======================================================================
echo Теперь вы можете просто писать в консоли: npm run dev
echo И на втором компьютере открывать в браузере ссылку выше!
echo ======================================================================
echo.
pause
