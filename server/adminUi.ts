export const ADMIN_PAGE = `<!doctype html>
<html lang="ru">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="dark" />
    <title>WOW Arena — админка</title>
    <style>
      :root {
        color-scheme: dark;
        --bg: #070b12;
        --panel: #101722;
        --panel-2: #141d2b;
        --line: #243247;
        --text: #e7eef7;
        --muted: #8ea1b8;
        --accent: #53d6a2;
        --accent-2: #f5b85c;
        --danger: #ff6b7a;
        font-family:
          Inter,
          ui-sans-serif,
          system-ui,
          -apple-system,
          'Segoe UI',
          sans-serif;
      }

      * {
        box-sizing: border-box;
      }

      body {
        min-height: 100vh;
        margin: 0;
        color: var(--text);
        background:
          radial-gradient(circle at 15% 0%, rgba(83, 214, 162, 0.09), transparent 32rem),
          radial-gradient(circle at 90% 20%, rgba(245, 184, 92, 0.06), transparent 28rem),
          var(--bg);
      }

      button,
      input {
        font: inherit;
      }

      button {
        padding: 0.65rem 0.9rem;
        color: var(--text);
        cursor: pointer;
        background: var(--panel-2);
        border: 1px solid var(--line);
        border-radius: 0.6rem;
        transition:
          border-color 120ms ease,
          background 120ms ease,
          transform 120ms ease;
      }

      button:hover:not(:disabled) {
        background: #192538;
        border-color: var(--accent);
      }

      button:active:not(:disabled) {
        transform: translateY(1px);
      }

      button:disabled {
        cursor: not-allowed;
        opacity: 0.45;
      }

      button.danger {
        color: #ffb3bb;
        background: rgba(255, 107, 122, 0.08);
        border-color: rgba(255, 107, 122, 0.4);
      }

      button.ghost {
        background: transparent;
      }

      .shell {
        max-width: 1200px;
        padding: 32px 20px 64px;
        margin: 0 auto;
      }

      .topbar {
        display: flex;
        flex-wrap: wrap;
        align-items: flex-end;
        justify-content: space-between;
        gap: 16px;
        margin-bottom: 24px;
      }

      .eyebrow {
        font-size: 11px;
        font-weight: 700;
        color: var(--accent);
        letter-spacing: 0.22em;
      }

      h1 {
        margin: 0.25rem 0 0;
        font-size: clamp(26px, 4vw, 42px);
        letter-spacing: -0.03em;
      }

      h2 {
        margin: 0 0 14px;
        font-size: 15px;
        color: var(--muted);
        text-transform: uppercase;
        letter-spacing: 0.12em;
      }

      .muted {
        color: var(--muted);
      }

      .statusline {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: flex-end;
        gap: 10px;
      }

      .pill {
        display: inline-flex;
        gap: 7px;
        align-items: center;
        padding: 0.35rem 0.7rem;
        font-size: 12px;
        border: 1px solid var(--line);
        border-radius: 999px;
      }

      .pill::before {
        width: 7px;
        height: 7px;
        content: '';
        background: var(--muted);
        border-radius: 50%;
      }

      .pill--ok::before {
        background: var(--accent);
        box-shadow: 0 0 10px var(--accent);
      }

      .pill--error::before {
        background: var(--danger);
        box-shadow: 0 0 10px var(--danger);
      }

      .grid {
        display: grid;
        grid-template-columns: repeat(12, minmax(0, 1fr));
        gap: 16px;
      }

      .card {
        min-width: 0;
        padding: 18px;
        background: linear-gradient(180deg, rgba(20, 29, 43, 0.94), rgba(12, 18, 28, 0.94));
        border: 1px solid var(--line);
        border-radius: 16px;
        box-shadow: 0 18px 50px rgba(0, 0, 0, 0.22);
      }

      .overview {
        grid-column: span 5;
      }

      .players {
        grid-column: span 7;
      }

      .maps {
        grid-column: span 7;
      }

      .announce {
        grid-column: span 5;
      }

      .log {
        grid-column: span 7;
      }

      .danger-zone {
        grid-column: span 5;
      }

      .card-head {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
      }

      .card-head h2 {
        margin-bottom: 0;
      }

      .stats {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 10px;
      }

      .stats > div {
        padding: 10px 12px;
        background: rgba(255, 255, 255, 0.025);
        border: 1px solid var(--line);
        border-radius: 10px;
      }

      .stats span {
        display: block;
        margin-bottom: 4px;
        font-size: 11px;
        color: var(--muted);
        text-transform: uppercase;
        letter-spacing: 0.08em;
      }

      .stats strong {
        font-size: 18px;
      }

      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 14px;
      }

      .table-wrap {
        overflow: auto;
      }

      table {
        width: 100%;
        font-size: 13px;
        border-collapse: collapse;
      }

      th {
        padding: 0 8px 8px;
        font-size: 10px;
        color: var(--muted);
        text-align: left;
        text-transform: uppercase;
        letter-spacing: 0.1em;
        border-bottom: 1px solid var(--line);
      }

      td {
        padding: 10px 8px;
        vertical-align: middle;
        border-bottom: 1px solid rgba(36, 50, 71, 0.55);
      }

      tbody tr:last-child td {
        border-bottom: 0;
      }

      .player-name {
        font-weight: 600;
      }

      .player-id {
        max-width: 180px;
        overflow: hidden;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 11px;
        color: var(--muted);
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .team {
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.08em;
      }

      .team--alpha {
        color: #7cb7ff;
      }

      .team--bravo {
        color: var(--accent-2);
      }

      .online {
        color: var(--accent);
      }

      .offline {
        color: var(--muted);
      }

      .map-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        gap: 12px;
      }

      .map-card {
        display: flex;
        flex-direction: column;
        gap: 10px;
        padding: 14px;
        background: rgba(255, 255, 255, 0.02);
        border: 1px solid var(--line);
        border-radius: 12px;
      }

      .map-card.is-current {
        border-color: rgba(83, 214, 162, 0.55);
        box-shadow: inset 0 0 0 1px rgba(83, 214, 162, 0.1);
      }

      .map-card h3 {
        margin: 0;
        font-size: 17px;
      }

      .map-meta {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 6px;
        font-size: 12px;
        color: var(--muted);
      }

      .map-card button {
        margin-top: auto;
      }

      form {
        display: flex;
        gap: 8px;
      }

      input {
        width: 100%;
        padding: 0.7rem 0.8rem;
        color: var(--text);
        background: #0a111b;
        border: 1px solid var(--line);
        border-radius: 10px;
        outline: none;
      }

      input:focus {
        border-color: var(--accent);
        box-shadow: 0 0 0 3px rgba(83, 214, 162, 0.12);
      }

      .auth {
        max-width: 460px;
        margin: 60px auto;
      }

      .auth form {
        margin-top: 16px;
      }

      .auth-error {
        margin: 12px 0 0;
        color: #ffb3bb;
      }

      .hidden {
        display: none !important;
      }

      .log pre {
        min-height: 150px;
        max-height: 300px;
        margin: 0;
        overflow: auto;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 12px;
        line-height: 1.6;
        color: #c9d6e5;
        white-space: pre-wrap;
        word-break: break-word;
      }

      .log-line {
        display: block;
      }

      .log-line--error {
        color: #ffb3bb;
      }

      .log-line--ok {
        color: #b8f5d8;
      }

      .log-time {
        margin-right: 8px;
        color: var(--muted);
      }

      .danger-zone p {
        margin-top: 0;
      }

      @media (max-width: 900px) {
        .overview,
        .players,
        .maps,
        .announce,
        .log,
        .danger-zone {
          grid-column: span 12;
        }

        .topbar {
          align-items: flex-start;
          flex-direction: column;
        }

        .statusline {
          justify-content: flex-start;
        }
      }
    </style>
  </head>
  <body>
    <div class="shell">
      <header class="topbar">
        <div>
          <div class="eyebrow">WOW ARENA // ADMIN</div>
          <h1>Панель управления</h1>
        </div>
        <div class="statusline">
          <span id="connection" class="pill">подключение…</span>
          <span id="last-update" class="muted"></span>
          <button id="refresh" type="button">Обновить</button>
        </div>
      </header>

      <section id="auth" class="card auth hidden">
        <h2>Доступ к панели</h2>
        <p class="muted">
          Сервер защищён токеном. Введите значение <code>ADMIN_TOKEN</code>, чтобы продолжить.
        </p>
        <form id="auth-form">
          <input
            id="token"
            type="password"
            autocomplete="current-password"
            placeholder="ADMIN_TOKEN"
          />
          <button type="submit">Войти</button>
        </form>
        <p id="auth-error" class="auth-error hidden"></p>
      </section>

      <main id="app" class="grid">
        <section class="card overview">
          <h2>Матч</h2>
          <div class="stats">
            <div><span>Карта</span><strong id="map-name">—</strong></div>
            <div><span>Фаза</span><strong id="phase">—</strong></div>
            <div><span>Раунд</span><strong id="round">—</strong></div>
            <div><span>Счёт</span><strong id="score">—</strong></div>
          </div>
          <div class="actions">
            <button id="restart" type="button">Перезапустить матч</button>
            <button id="end" type="button" class="danger">Завершить матч</button>
          </div>
        </section>

        <section class="card players">
          <div class="card-head">
            <h2>Игроки</h2>
            <span id="player-count" class="muted"></span>
          </div>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Игрок</th>
                  <th>Команда</th>
                  <th>Статус</th>
                  <th>K</th>
                  <th>D</th>
                  <th></th>
                </tr>
              </thead>
              <tbody id="players"></tbody>
            </table>
          </div>
        </section>

        <section class="card maps">
          <h2>Карты</h2>
          <div id="maps" class="map-grid"></div>
        </section>

        <section class="card announce">
          <h2>Объявление</h2>
          <form id="say-form">
            <input id="say-text" maxlength="200" placeholder="Текст для всех игроков" />
            <button type="submit">Отправить</button>
          </form>
          <p class="muted">
            Команды: status, maps, map &lt;id&gt;, kick &lt;id&gt;, restart, end, say, quit.
          </p>
        </section>

        <section class="card log">
          <div class="card-head">
            <h2>Журнал</h2>
            <button id="clear-log" type="button" class="ghost">Очистить</button>
          </div>
          <pre id="log" aria-live="polite"></pre>
        </section>

        <section class="card danger-zone">
          <h2>Сервер</h2>
          <p class="muted">Остановка завершит игру и закроет админ-панель.</p>
          <button id="quit" type="button" class="danger">Остановить сервер</button>
        </section>
      </main>
    </div>

    <script>
      (function () {
        'use strict';

        var TOKEN_KEY = 'wow-admin-token';
        var token = '';
        try {
          token = window.sessionStorage.getItem(TOKEN_KEY) || '';
        } catch (error) {
          token = '';
        }

        var authRequired = false;
        var stopped = false;
        var refreshTimer = null;
        var lastRefreshError = '';
        var refreshing = false;
        var inFlight = false;

        function byId(id) {
          return document.getElementById(id);
        }

        var els = {
          app: byId('app'),
          auth: byId('auth'),
          authForm: byId('auth-form'),
          authError: byId('auth-error'),
          tokenInput: byId('token'),
          connection: byId('connection'),
          lastUpdate: byId('last-update'),
          mapName: byId('map-name'),
          phase: byId('phase'),
          round: byId('round'),
          score: byId('score'),
          players: byId('players'),
          playerCount: byId('player-count'),
          maps: byId('maps'),
          log: byId('log'),
          sayForm: byId('say-form'),
          sayText: byId('say-text'),
          refresh: byId('refresh'),
          restart: byId('restart'),
          end: byId('end'),
          quit: byId('quit'),
          clearLog: byId('clear-log'),
        };

        function timeLabel(value) {
          return new Date(value).toLocaleTimeString('ru-RU', { hour12: false });
        }

        function setConnection(kind, text) {
          els.connection.className = 'pill' + (kind ? ' pill--' + kind : '');
          els.connection.textContent = text;
        }

        function phaseLabel(phase) {
          switch (phase) {
            case 'lobby':
              return 'лобби';
            case 'countdown':
              return 'отсчёт';
            case 'live':
              return 'идёт';
            case 'round_over':
              return 'конец раунда';
            case 'paused':
              return 'пауза';
            case 'ended':
              return 'завершён';
            default:
              return phase;
          }
        }

        function teamLabel(team) {
          return team === 'alpha' ? 'ALPHA' : 'BRAVO';
        }

        function showAuth(message) {
          els.auth.classList.remove('hidden');
          els.app.classList.add('hidden');
          setConnection('error', 'нужен токен');
          if (message) {
            els.authError.textContent = message;
            els.authError.classList.remove('hidden');
          } else {
            els.authError.classList.add('hidden');
          }
        }

        function hideAuth() {
          els.auth.classList.add('hidden');
          els.authError.classList.add('hidden');
          els.app.classList.remove('hidden');
        }

        function request(path, options) {
          var init = options || {};
          var headers = init.headers || {};
          headers.Accept = 'application/json';
          if (init.body) {
            headers['Content-Type'] = 'application/json';
          }
          if (token) {
            headers['X-Admin-Token'] = token;
          }
          init.headers = headers;

          var controller = new AbortController();
          init.signal = controller.signal;
          var timeout = window.setTimeout(function () {
            controller.abort();
          }, 5000);

          return fetch(path, init)
            .then(function (response) {
              return response
                .json()
                .catch(function () {
                  return {};
                })
                .then(function (body) {
                  if (response.status === 401) {
                    authRequired = true;
                    showAuth(
                      token
                        ? 'Неверный токен. Проверьте ADMIN_TOKEN.'
                        : 'Введите токен администратора.',
                    );
                    var authFailure = new Error(body.error || 'Требуется токен администратора');
                    authFailure.auth = true;
                    throw authFailure;
                  }
                  if (!response.ok) {
                    throw new Error(body.error || 'HTTP ' + response.status);
                  }
                  authRequired = false;
                  hideAuth();
                  return body;
                });
            })
            .then(
              function (body) {
                window.clearTimeout(timeout);
                return body;
              },
              function (error) {
                window.clearTimeout(timeout);
                if (error && error.name === 'AbortError') {
                  throw new Error('Сервер не ответил за 5 секунд');
                }
                throw error;
              },
            );
        }

        function appendLog(text, kind) {
          var line = document.createElement('span');
          line.className = 'log-line' + (kind ? ' log-line--' + kind : '');
          var time = document.createElement('span');
          time.className = 'log-time';
          time.textContent = timeLabel(Date.now());
          line.appendChild(time);
          line.appendChild(document.createTextNode(text));
          els.log.appendChild(line);

          while (els.log.childElementCount > 100) {
            els.log.removeChild(els.log.firstChild);
          }
          els.log.scrollTop = els.log.scrollHeight;
        }

        function renderPlayers(players) {
          els.players.replaceChildren();
          if (players.length === 0) {
            var emptyRow = document.createElement('tr');
            var emptyCell = document.createElement('td');
            emptyCell.colSpan = 6;
            emptyCell.className = 'muted';
            emptyCell.textContent = 'Игроков нет.';
            emptyRow.appendChild(emptyCell);
            els.players.appendChild(emptyRow);
            return;
          }

          players.forEach(function (player) {
            var row = document.createElement('tr');

            var nameCell = document.createElement('td');
            var name = document.createElement('div');
            name.className = 'player-name';
            name.textContent = player.name;
            var id = document.createElement('div');
            id.className = 'player-id';
            id.textContent = player.id;
            id.title = player.id;
            nameCell.appendChild(name);
            nameCell.appendChild(id);
            row.appendChild(nameCell);

            var teamCell = document.createElement('td');
            var team = document.createElement('span');
            team.className = 'team team--' + player.team;
            team.textContent = teamLabel(player.team);
            teamCell.appendChild(team);
            row.appendChild(teamCell);

            var statusCell = document.createElement('td');
            var status = document.createElement('span');
            status.className = player.connected ? 'online' : 'offline';
            status.textContent = player.connected ? 'в игре' : 'офлайн';
            statusCell.appendChild(status);
            row.appendChild(statusCell);

            var killsCell = document.createElement('td');
            killsCell.textContent = String(player.kills);
            row.appendChild(killsCell);

            var deathsCell = document.createElement('td');
            deathsCell.textContent = String(player.deaths);
            row.appendChild(deathsCell);

            var actionCell = document.createElement('td');
            var kick = document.createElement('button');
            kick.type = 'button';
            kick.className = 'danger';
            kick.textContent = 'Кикнуть';
            kick.addEventListener('click', function () {
              if (window.confirm('Кикнуть игрока ' + player.name + '?')) {
                runCommand('kick', [player.id]);
              }
            });
            actionCell.appendChild(kick);
            row.appendChild(actionCell);

            els.players.appendChild(row);
          });
        }

        function renderMaps(maps, currentMapId) {
          els.maps.replaceChildren();
          maps.forEach(function (map) {
            var card = document.createElement('article');
            card.className = 'map-card' + (map.id === currentMapId ? ' is-current' : '');

            var title = document.createElement('h3');
            title.textContent = map.name;
            card.appendChild(title);

            var meta = document.createElement('div');
            meta.className = 'map-meta';
            meta.appendChild(textLine('Размер: ' + map.size + ' × ' + map.sizeZ));
            meta.appendChild(textLine('Оружие: ' + map.weapons));
            meta.appendChild(textLine('Броня: ' + map.armor));
            if (Array.isArray(map.bombSites) && map.bombSites.length > 0) {
              meta.appendChild(textLine('Сайты: ' + map.bombSites.join(', ')));
            }
            card.appendChild(meta);

            var button = document.createElement('button');
            button.type = 'button';
            if (map.id === currentMapId) {
              button.disabled = true;
              button.textContent = 'Текущая карта';
            } else {
              button.textContent = 'Сменить карту';
              button.addEventListener('click', function () {
                if (window.confirm('Переключить карту на ' + map.name + '? Матч сбросится.')) {
                  runCommand('map', [map.id]);
                }
              });
            }
            card.appendChild(button);
            els.maps.appendChild(card);
          });
        }

        function textLine(text) {
          var line = document.createElement('span');
          line.textContent = text;
          return line;
        }

        function renderState(state) {
          els.mapName.textContent = state.mapName;
          els.phase.textContent = phaseLabel(state.phase);
          els.round.textContent = String(state.round);
          els.score.textContent =
            'ALPHA ' + state.scores.alpha + ' : ' + state.scores.bravo + ' BRAVO';
          els.playerCount.textContent = state.players.length + ' / 2';
          renderPlayers(state.players);
          renderMaps(state.maps, state.mapId);
        }

        function refresh() {
          if (refreshing) {
            return Promise.resolve();
          }
          refreshing = true;

          return request('/api/state')
            .then(function (state) {
              renderState(state);
              lastRefreshError = '';
              setConnection('ok', 'онлайн');
              els.lastUpdate.textContent = 'обновлено ' + timeLabel(Date.now());
            })
            .catch(function (error) {
              if (!error.auth) {
                setConnection('error', 'ошибка');
                if (error.message !== lastRefreshError) {
                  lastRefreshError = error.message;
                  appendLog('Не удалось обновить состояние: ' + error.message, 'error');
                }
              }
            })
            .then(function () {
              refreshing = false;
            });
        }

        function runCommand(command, args) {
          if (inFlight) {
            return Promise.resolve(null);
          }
          inFlight = true;

          return request('/api/command', {
            method: 'POST',
            body: JSON.stringify({ command: command, args: args || [] }),
          })
            .then(function (result) {
              (result.lines || []).forEach(function (line) {
                appendLog(line, result.ok ? 'ok' : 'error');
              });
              if (result.shutdown) {
                stopped = true;
                if (refreshTimer !== null) {
                  window.clearInterval(refreshTimer);
                  refreshTimer = null;
                }
                setConnection('error', 'остановка');
                appendLog('Сервер останавливается. Панель скоро станет недоступна.', 'error');
                return result;
              }
              return refresh().then(function () {
                return result;
              });
            })
            .catch(function (error) {
              if (!error.auth) {
                setConnection('error', 'ошибка');
                appendLog('Ошибка команды: ' + error.message, 'error');
              }
              return null;
            })
            .then(function (result) {
              inFlight = false;
              return result;
            });
        }

        els.refresh.addEventListener('click', refresh);
        els.restart.addEventListener('click', function () {
          if (window.confirm('Перезапустить матч?')) {
            runCommand('restart');
          }
        });
        els.end.addEventListener('click', function () {
          if (window.confirm('Завершить текущий матч?')) {
            runCommand('end');
          }
        });
        els.quit.addEventListener('click', function () {
          if (window.confirm('Остановить сервер? Игроки будут отключены.')) {
            runCommand('quit');
          }
        });
        els.clearLog.addEventListener('click', function () {
          els.log.replaceChildren();
        });
        els.sayForm.addEventListener('submit', function (event) {
          event.preventDefault();
          var text = els.sayText.value.trim();
          if (text.length === 0) {
            return;
          }
          runCommand('say', [text]).then(function (result) {
            if (result !== null && result.ok) {
              els.sayText.value = '';
            }
          });
        });
        els.authForm.addEventListener('submit', function (event) {
          event.preventDefault();
          token = els.tokenInput.value.trim();
          try {
            if (token) {
              window.sessionStorage.setItem(TOKEN_KEY, token);
            } else {
              window.sessionStorage.removeItem(TOKEN_KEY);
            }
          } catch (error) {
            // sessionStorage may be unavailable in hardened browsers.
          }
          els.authError.classList.add('hidden');
          refresh();
        });

        refresh();
        refreshTimer = window.setInterval(function () {
          if (!stopped && !authRequired && !document.hidden) {
            refresh();
          }
        }, 2000);
      })();
    </script>
  </body>
</html>
`;
