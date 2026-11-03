#!/usr/bin/env bash
# ==============================================================================
# WOW Arena — Скрипт автоматической установки и развёртывания на Ubuntu
# Поддерживаемые версии: Ubuntu 20.04 / 22.04 / 24.04 LTS (x86_64 / arm64)
# ==============================================================================

set -euo pipefail

# Цвета для красивого вывода
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

log_info() {
  echo -e "${CYAN}[INFO]${NC} $1"
}

log_success() {
  echo -e "${GREEN}[OK]${NC} $1"
}

log_warn() {
  echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
  echo -e "${RED}[ERROR]${NC} $1" >&2
}

echo -e "${CYAN}"
echo "=========================================================="
echo "           WOW Arena — Ubuntu Server Setup                "
echo "=========================================================="
echo -e "${NC}"

# 1. Проверка прав суперпользователя (root / sudo)
if [ "$EUID" -ne 0 ]; then
  log_warn "Скрипт запущен без прав root. Запрашиваю sudo..."
  exec sudo bash "$0" "$@"
fi

# Реальный пользователь, запустивший скрипт через sudo
REAL_USER="${SUDO_USER:-$USER}"
REAL_GROUP="$(id -gn "$REAL_USER" 2>/dev/null || echo "$REAL_USER")"

# Определение рабочей директории проекта
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$SCRIPT_DIR"

log_info "Пользователь сервиса: ${GREEN}${REAL_USER}${NC}"
log_info "Директория проекта:   ${GREEN}${APP_DIR}${NC}"

# 2. Проверка операционной системы
if [ -f /etc/os-release ]; then
  . /etc/os-release
  log_info "Операционная система: ${NAME} ${VERSION_ID}"
  if [[ "${ID:-}" != "ubuntu" && "${ID_LIKE:-}" != *"debian"* && "${ID_LIKE:-}" != *"ubuntu"* ]]; then
    log_warn "Внимание: система не является Ubuntu/Debian. Установка продолжается, но возможны различия пакетов."
  fi
fi

# 3. Обновление apt и установка системных зависимостей
log_info "Проверка и установка системных утилит (curl, git, build-essential)..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl git build-essential ca-certificates ufw >/dev/null

# 4. Проверка и установка Node.js (требуется >= 20.19.0)
REQUIRED_NODE_MAJOR=20
REQUIRED_NODE_MINOR=19
NEED_NODE_INSTALL=true

if command -v node >/dev/null 2>&1; then
  NODE_VER="$(node -v | sed 's/v//')"
  NODE_MAJOR="$(echo "$NODE_VER" | cut -d. -f1)"
  NODE_MINOR="$(echo "$NODE_VER" | cut -d. -f2)"
  log_info "Обнаружен Node.js: v${NODE_VER}"
  
  if [ "$NODE_MAJOR" -gt "$REQUIRED_NODE_MAJOR" ] || { [ "$NODE_MAJOR" -eq "$REQUIRED_NODE_MAJOR" ] && [ "$NODE_MINOR" -ge "$REQUIRED_NODE_MINOR" ]; }; then
    log_success "Текущая версия Node.js подходит (>= 20.19.0)."
    NEED_NODE_INSTALL=false
  else
    log_warn "Версия Node.js устарела (требуется >= 20.19.0). Будет установлен Node.js 22 LTS."
  fi
fi

if [ "$NEED_NODE_INSTALL" = true ]; then
  log_info "Установка Node.js 22 LTS через официальный репозиторий NodeSource..."
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y -qq nodejs
  log_success "Установлен Node.js: $(node -v) и npm: $(npm -v)"
fi

# 5. Проверка файла конфигурации окружения (.env)
cd "$APP_DIR"

if [ ! -f .env ]; then
  log_info "Создание файла .env из .env.example..."
  if [ -f .env.example ]; then
    cp .env.example .env
  else
    cat <<EOF > .env
PORT=3000
HOST=0.0.0.0
ADMIN_PORT=3001
ADMIN_HOST=127.0.0.1
LOG_LEVEL=info
EOF
  fi
  chown "${REAL_USER}:${REAL_GROUP}" .env 2>/dev/null || true
  log_success "Файл .env успешно создан."
else
  log_info "Используется существующий .env"
fi

# 6. Установка зависимостей проекта (npm)
log_info "Проверка прав доступа и установка зависимостей проекта (npm install)..."
# Выравниваем права на директорию проекта перед установкой
chown -R "${REAL_USER}:${REAL_GROUP}" "$APP_DIR"

# Выполняем npm install от имени реального пользователя для корректных прав
if [ "$REAL_USER" != "root" ]; then
  sudo -u "$REAL_USER" npm install --no-audit --prefer-offline 2>&1 | tail -n 10
else
  npm install --no-audit --prefer-offline 2>&1 | tail -n 10
fi

# Устраняем ошибку "Permission denied" для tsc, vite, esbuild и других CLI-утилит:
# выставляем права на выполнение (+x) для всех бинарников и ссылок в node_modules/.bin
chown -R "${REAL_USER}:${REAL_GROUP}" "$APP_DIR"
if [ -d "$APP_DIR/node_modules" ]; then
  chmod -R u+x "$APP_DIR/node_modules/.bin" 2>/dev/null || true
  chmod -R +x "$APP_DIR/node_modules/.bin" 2>/dev/null || true
  find "$APP_DIR/node_modules" -path "*/bin/*" -type f -exec chmod +x {} + 2>/dev/null || true
  find "$APP_DIR/node_modules" -name "tsc" -exec chmod +x {} + 2>/dev/null || true
  find "$APP_DIR/node_modules" -name "vite" -exec chmod +x {} + 2>/dev/null || true
  find "$APP_DIR/node_modules" -name "esbuild" -exec chmod +x {} + 2>/dev/null || true
fi
log_success "Зависимости npm установлены, права на запуск бинарников (+x) настроены."

# 7. Сборка клиента и сервера (production build)
log_info "Сборка проекта (npm run build: typecheck, vite client, esbuild server)..."
if [ "$REAL_USER" != "root" ]; then
  sudo -u "$REAL_USER" npm run build
else
  npm run build
fi
log_success "Сборка успешно завершена."

# 8. Создание и настройка службы systemd (wow-arena.service)
SERVICE_FILE="/etc/systemd/system/wow-arena.service"
NODE_BIN="$(command -v node)"

log_info "Конфигурация службы systemd: ${SERVICE_FILE}..."

cat <<EOF > "$SERVICE_FILE"
[Unit]
Description=WOW Arena — Fast-Paced Browser FPS Game Server
After=network.target

[Service]
Type=simple
User=${REAL_USER}
Group=${REAL_GROUP}
WorkingDirectory=${APP_DIR}
EnvironmentFile=-${APP_DIR}/.env
Environment=NODE_ENV=production
ExecStart=${NODE_BIN} dist/server/index.js
Restart=always
RestartSec=3
StandardOutput=journal
StandardError=journal
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable wow-arena.service
log_info "Перезапуск службы wow-arena..."
systemctl restart wow-arena.service
sleep 1

# 9. Проверка статуса службы
if systemctl is-active --quiet wow-arena.service; then
  log_success "Служба wow-arena успешно запущена и активна!"
else
  log_error "Служба wow-arena не смогла запуститься. Логи:"
  journalctl -u wow-arena.service -n 25 --no-pager
  exit 1
fi

# 10. Настройка файрвола (UFW)
# Читаем порт из .env (по умолчанию 3000)
GAME_PORT="$(grep -E '^PORT=' .env 2>/dev/null | cut -d= -f2 | tr -d ' "\r' || echo "3000")"
GAME_PORT="${GAME_PORT:-3000}"

if command -v ufw >/dev/null 2>&1 && ufw status | grep -qw "active"; then
  log_info "Файрвол UFW активен. Открываем порт ${GAME_PORT}/tcp..."
  ufw allow "${GAME_PORT}/tcp" comment "WOW Arena Game Server" >/dev/null || true
  log_success "Порт ${GAME_PORT}/tcp открыт в UFW."
fi

# 11. Определение внешнего IP-адреса для удобства подключения
EXTERNAL_IP="$(curl -s4 --max-time 3 ifconfig.me 2>/dev/null || curl -s4 --max-time 3 api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')"

echo ""
echo -e "${GREEN}==========================================================${NC}"
echo -e "${GREEN}           Сервер WOW Arena успешно запущен!             ${NC}"
echo -e "${GREEN}==========================================================${NC}"
echo ""
echo -e "  🌐 Игра доступна в браузере:  ${CYAN}http://${EXTERNAL_IP}:${GAME_PORT}${NC}"
echo -e "  ⚙️  Веб-админка:              ${CYAN}http://127.0.0.1:3001${NC}"
echo ""
echo -e "${YELLOW}Полезные команды управления сервером:${NC}"
echo -e "  Просмотр логов в реальном времени:  ${CYAN}sudo journalctl -u wow-arena -f${NC}"
echo -e "  Статус сервера:                     ${CYAN}sudo systemctl status wow-arena${NC}"
echo -e "  Перезапуск:                         ${CYAN}sudo systemctl restart wow-arena${NC}"
echo -e "  Остановка:                          ${CYAN}sudo systemctl stop wow-arena${NC}"
echo -e "  Обновление до последней версии:     ${CYAN}git pull && ./deploy.sh${NC}"
echo ""
