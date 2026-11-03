# Развёртывание WOW Arena на Ubuntu

Автоматизированный скрипт [`deploy.sh`](deploy.sh) позволяет развернуть игровой сервер WOW Arena на чистом или существующем сервере Ubuntu (20.04 / 22.04 / 24.04 LTS) буквально одной командой.

---

## Быстрый старт (1 команда)

Подключитесь к вашему серверу по SSH и выполните:

```bash
git clone https://github.com/your-username/wow-app.git
cd wow-app
chmod +x deploy.sh
./deploy.sh
```

> **Примечание**: Скрипт сам запросит `sudo`, если запущен обычным пользователем, и настроит запуск службы от имени вашего текущего пользователя (не от root), что безопасно и соответствует лучшим практикам Linux.

---

## Что делает `deploy.sh` автоматически

1. **Системные зависимости**: обновляет кэш `apt` и устанавливает `curl`, `git`, `build-essential`, `ca-certificates`, `ufw`.
2. **Node.js**: проверяет установленную версию Node.js. Если она отсутствует или ниже требуемой `20.19.0`, автоматически подключает официальный репозиторий **NodeSource** и ставит **Node.js 22 LTS**.
3. **Конфигурация окружения**: если файла `.env` ещё нет, копирует его из `.env.example`.
4. **Зависимости проекта**: выполняет `npm install`.
5. **Сборка**: компилирует клиент (`Vite`) и сервер (`esbuild` + `tsc`) в директорию `dist/`.
6. **Служба systemd (`wow-arena.service`)**:
   - Автозапуск при загрузке системы (`systemctl enable`).
   - Автоматический перезапуск при сбоях (`Restart=always`).
   - Потоковое логирование в `journald`.
   - Ограничения дескрипторов файлов (`LimitNOFILE=65536`) для высоких сетевых нагрузок.
7. **Файрвол (UFW)**: если на сервере включён фаервол `ufw`, скрипт автоматически открывает игровой TCP-порт (по умолчанию `3000`).
8. **Диагностика**: определяет внешний IP-адрес сервера и выводит готовую ссылку для входа в игру.

---

## Управление сервером

После завершения работы скрипта сервер работает как системная служба **systemd**.

### Просмотр логов в реальном времени
```bash
sudo journalctl -u wow-arena -f
```

### Статус сервера
```bash
sudo systemctl status wow-arena
```

### Перезапуск
```bash
sudo systemctl restart wow-arena
```

### Остановка
```bash
sudo systemctl stop wow-arena
```

### Запуск
```bash
sudo systemctl start wow-arena
```

### Обновление игры до свежей версии
Скрипт `deploy.sh` полностью идемпотентен — его можно запускать повторно для обновления:
```bash
git pull
./deploy.sh
```
Он сам подтянет новые зависимости, пересоберёт проект и перезапустит сервис без простоя.

---

## Настройка конфигурации (`.env`)

Все параметры сервера хранятся в файле `.env` в корне проекта:

| Параметр | По умолчанию | Описание |
| :--- | :--- | :--- |
| `PORT` | `3000` | Порт игрового веб-сервера и WebSocket (Socket.IO). Открывается в браузере игроками. |
| `HOST` | `0.0.0.0` | Адрес прослушивания игрового сервера (`0.0.0.0` для доступа из интернета). |
| `ADMIN_PORT` | `3001` | Порт панели администратора. |
| `ADMIN_HOST` | `127.0.0.1` | Адрес админки. По умолчанию доступна только локально на сервере. |
| `ADMIN_TOKEN` | — | Секретный токен доступа к админке (обязателен, если `ADMIN_HOST` установлен не в `127.0.0.1`). Минимум 8 символов. |
| `LOG_LEVEL` | `info` | Уровень логирования (`debug`, `info`, `warn`, `error`). |

После изменения `.env` примените настройки перезапуском службы:
```bash
sudo systemctl restart wow-arena
```

---

## Настройка Nginx с SSL (домен и HTTPS / WSS)

Если вы хотите запускать игру на собственном домене (например, `game.example.com`) с защищённым соединением **HTTPS** и **WSS** (WebSocket Secure):

1. Установите Nginx и Certbot:
   ```bash
   sudo apt install -y nginx certbot python3-certbot-nginx
   ```

2. Создайте конфигурацию сайта `/etc/nginx/sites-available/wow-arena`:
   ```nginx
   server {
       server_name game.example.com;

       location / {
           proxy_pass http://127.0.0.1:3000;
           proxy_http_version 1.1;
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection "upgrade";
           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
           proxy_set_header X-Forwarded-Proto $scheme;
       }
   }
   ```

3. Активируйте конфигурацию и выпустите бесплатный SSL-сертификат Let's Encrypt:
   ```bash
   sudo ln -s /etc/nginx/sites-available/wow-arena /etc/nginx/sites-enabled/
   sudo nginx -t && sudo systemctl reload nginx
   sudo certbot --nginx -d game.example.com
   ```

---

## Советы для слабых VPS (1 ГБ RAM)

Если ваш VPS имеет всего 1 ГБ оперативной памяти, компиляция `Vite` и `TypeScript` может вызвать нехватку памяти (OOM). Чтобы этого избежать, добавьте файл подкачки (swap):

```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```
После этого `./deploy.sh` выполнит сборку быстро и без сбоев.

---

## Решение возможных проблем (Troubleshooting)

### Ошибка `sh: 1: tsc: Permission denied`
Такая ошибка возникает, если папка проекта или `node_modules` были ранее скопированы от другого пользователя или без флага исполнения `+x` на бинарниках:
```bash
sudo chown -R $USER:$USER .
chmod -R +x node_modules/.bin
./deploy.sh
```
В актуальной версии `deploy.sh` эти права выставляются автоматически.
