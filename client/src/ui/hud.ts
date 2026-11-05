import { BOMB } from '../../../shared/config';
import { findBombSiteAt, type ArenaMap } from '../../../shared/map';
import { clamp, distance, type Vec3 } from '../../../shared/math';
import {
  PROTOCOL_VERSION,
  type CountdownState,
  type KillEvent,
  type LobbyState,
  type MatchEndReason,
  type MatchPhase,
  type PlayerSnapshot,
  type RoundEndEvent,
  type BuyResultEvent,
  type RoundSummaryEvent,
  type Snapshot,
  type Team,
  type RoomSummary,
  type RoomGameMode,
} from '../../../shared/protocol';
import {
  BUY_CATEGORY_LABELS,
  BUY_ITEMS,
  GRENADE_LIMITS,
  MAX_GRENADES,
  getBuyItem,
  getBuyPrice,
  isEconomyMode,
  type GrenadeType,
  type BuyCategory,
  type BuyItem,
  type Side,
} from '../../../shared/economy';
import { getWeapon } from '../../../shared/weapons';
import {
  DEFAULT_SETTINGS,
  loadSettings,
  normalizeSettings,
  saveSettings,
  type GameSettings,
} from '../settings';
import {
  DEFAULT_CROSSHAIR,
  sanitizeCrosshairDraft,
  type CrosshairPreset,
} from '../../../shared/crosshair';
import { loadCrosshairPreset, saveCrosshairPreset } from '../net/session';
import { applyVisualStyles, createCrosshairEditor, type CrosshairEditor } from './crosshairEditor';
import { Radar } from './radar';

const SIDE_LABEL: Record<Side, string> = { t: 'T', ct: 'CT' };
const GRENADE_LABEL = {
  flashbang: 'ФЛЕШ',
  hegrenade: 'HE',
  smokegrenade: 'СМОУК',
  molotov: 'МОЛОТОВ',
  incendiary: 'ЗАЖИГ',
} as const;
const BUY_CATEGORIES: BuyCategory[] = ['pistols', 'smgs', 'rifles', 'grenades', 'gear'];
const PHASE_LABEL: Record<MatchPhase, string> = {
  lobby: 'ЛОББИ',
  countdown: 'ПОДГОТОВКА',
  round_over: 'РАУНД ЗАВЕРШЁН',
  live: 'БОЙ',
  paused: 'ПАУЗА',
  ended: 'МАТЧ ОКОНЧЕН',
};

const END_REASON: Record<RoundEndEvent['reason'], string> = {
  frags: 'Достигнут лимит раундов',
  rounds: 'Матч завершён по раундам',
  time: 'Время матча истекло',
  abandon: 'Соперник покинул матч',
  bomb: 'Бомба взорвана',
  defuse: 'Бомба обезврежена',
};

export interface HudCallbacks {
  onJoin(name: string, roomId?: string): void;
  onCreateRoom(name: string, mapId: string, roomMode?: RoomGameMode, playerName?: string): void;
  onRefreshRooms(): void;
  onChooseTeam?(team: Team): void;
  onSetReady?(ready: boolean): void;
  onRematch(): void;
  onResume(): void;
  onLeave(): void;
  onSettingsChange(settings: GameSettings): void;
  onBuy(itemId: string): void;
  onRefund(itemId: string): void;
  onCloseBuy(): void;
}

export interface Hud {
  showStart(prefillName: string, error?: string): void;
  hideStart(): void;
  setJoinBusy(busy: boolean): void;
  setRooms(rooms: RoomSummary[]): void;
  showRooms(show: boolean): void;
  showCreateRoom(show: boolean): void;
  setConnection(connected: boolean, pingMs: number | null): void;
  setNetwork(pingMs: number | null, jitterMs: number, lossPercent: number): void;
  setReconnecting(show: boolean, text?: string): void;
  setProtocolInfo(text: string): void;
  setMapInfo(map: ArenaMap): void;
  setLocalPlayer(playerId: string | null): void;
  updateLobby(state: LobbyState, localPlayerId: string | null): void;
  updateSnapshot(snapshot: Snapshot, localPlayerId: string | null): void;
  tick(serverNow: number): void;
  showCountdown(state: CountdownState): void;
  setScope(visible: boolean): void;
  showLive(): void;
  addKill(event: KillEvent, localPlayerId: string | null): void;
  showDamage(direction?: number | null, damage?: number): void;
  updateRoundStats(event: RoundSummaryEvent, localPlayerId: string | null): void;
  showSettings(show: boolean): void;
  showPickup(weaponName: string): void;
  showBombPlanted(siteId: string): void;
  hideBombAlert(): void;
  showRoundWin(winnerName: string, localWon: boolean, reason?: MatchEndReason): void;
  hideRoundWin(): void;
  showResults(event: RoundEndEvent, localPlayerId: string | null): void;
  hideResults(): void;
  showPause(show: boolean): void;
  showScoreboard(show: boolean): void;
  showToast(text: string, tone?: 'success' | 'error' | 'info'): void;
  showError(message: string): void;
  showBuy(show: boolean): void;
  updateBuy(snapshot: Snapshot, playerId: string | null, inBuyZone: boolean): void;
  setBuyZoneNotice(show: boolean): void;
  showBuyResult(event: BuyResultEvent, playerId: string | null): void;
  setBlind(remainingMs: number): void;
  updateRadar(
    observer: PlayerSnapshot,
    snapshot: Snapshot,
    map: ArenaMap,
    settings: GameSettings,
  ): void;
  registerRadarShot(pos: Vec3): void;
  setRadarSpotted(enemyId: string, pos: Vec3): void;
  markRadarLostSight(enemyId: string): void;
  setRadarVisible(visible: boolean): void;
  /** Spectator info bar; null hides it and restores the local player's HUD. */
  setSpectator(state: SpectatorHudState | null): void;
  /** Black fade between spectator targets, 0..1. */
  setSpectatorFade(alpha: number): void;
  dispose(): void;
}

export interface SpectatorHudState {
  mode: 'self' | 'player' | 'bomb';
  /** Player whose vitals/weapon are shown in the HUD (spectated teammate). */
  targetId: string | null;
  targetName: string | null;
  killerName: string | null;
  canCycle: boolean;
}

function requireElement<T extends HTMLElement>(root: ParentNode, id: string): T {
  const element = root.querySelector<T>(`#${id}`);
  if (element === null) {
    throw new Error(`Missing required HUD element #${id}`);
  }
  return element;
}

function setText(element: Element, text: string): void {
  if (element.textContent !== text) {
    element.textContent = text;
  }
}

function formatTime(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function createElement<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className !== undefined) {
    element.className = className;
  }
  if (text !== undefined) {
    element.textContent = text;
  }
  return element;
}

const HUD_TEMPLATE = `
<div class="hud" id="hud">
  <div class="hud__vignette"></div>
  <div class="hud__scanlines"></div>
  <div class="hud__damage" id="damage-flash"></div>
  <div class="damage-direction" id="damage-direction" aria-hidden="true">
    <span class="damage-direction__arrow"></span>
  </div>
  <div class="flash-overlay" id="flash-overlay" aria-hidden="true"></div>
  <div class="spectator-fade" id="spectator-fade" aria-hidden="true"></div>

  <div class="spectator-bar" id="spectator-bar" role="status" aria-live="polite">
    <div class="spectator-bar__label" id="spectator-label">НАБЛЮДЕНИЕ</div>
    <div class="spectator-bar__name" id="spectator-name"></div>
    <div class="spectator-bar__hint" id="spectator-hint">ЛКМ / ПКМ — СМЕНИТЬ ИГРОКА</div>
    <div class="spectator-bar__killer" id="spectator-killer"></div>
  </div>

  <div class="round-banner" id="round-banner" role="status" aria-live="polite">
    <div class="round-banner__label" id="round-banner-label">РАУНД ЗАВЕРШЁН</div>
    <div class="round-banner__name" id="round-banner-name"></div>
    <div class="round-banner__sub" id="round-banner-sub"></div>
  </div>

  <header class="topbar cs2-topbar" id="cs2-topbar">
    <div class="cs2-topbar__inner">
      <div class="cs2-team cs2-team--ct">
        <div class="cs2-team__players" id="cs2-players-ct"></div>
        <div class="cs2-team__score-badge cs2-team__score-badge--ct">
          <span class="cs2-team__score" id="score-ct">0</span>
          <span class="cs2-team__label">CT</span>
        </div>
      </div>

      <div class="match-clock cs2-clock" id="match-clock">
        <div class="match-clock__time" id="hud-time">10:00</div>
        <div class="match-clock__phase" id="hud-phase">ЛОББИ</div>
        <div class="match-clock__limit" id="hud-fraglimit" style="display: none;">ДО 13 РАУНДОВ</div>
      </div>

      <div class="cs2-team cs2-team--t">
        <div class="cs2-team__score-badge cs2-team__score-badge--t">
          <span class="cs2-team__label">T</span>
          <span class="cs2-team__score" id="score-t">0</span>
        </div>
        <div class="cs2-team__players" id="cs2-players-t"></div>
      </div>
    </div>

    <div class="topbar__meta">
      <span class="status-dot" id="hud-status-dot"></span>
      <span id="hud-status">ПОДКЛЮЧЕНИЕ</span>
      <span class="topbar__sep">/</span>
      <span id="hud-ping">PING —</span>
    </div>

    <div id="team-alpha" style="display: none;"><span id="score-alpha">0</span><span id="bar-alpha"></span><span id="label-alpha"></span></div>
    <div id="team-bravo" style="display: none;"><span id="score-bravo">0</span><span id="bar-bravo"></span><span id="label-bravo"></span></div>
  </header>

  <div class="radar-container" id="radar-container"></div>

  <div class="killfeed" id="killfeed" aria-live="polite"></div>

  <div class="crosshair crosshair-visual" id="crosshair" data-style="dot">
    <span class="crosshair__dot"></span>
    <span class="crosshair__line crosshair__line--top"></span>
    <span class="crosshair__line crosshair__line--right"></span>
    <span class="crosshair__line crosshair__line--bottom"></span>
    <span class="crosshair__line crosshair__line--left"></span>
  </div>
  <div class="scope" id="scope-overlay" aria-hidden="true">
    <span class="scope__line scope__line--horizontal"></span>
    <span class="scope__line scope__line--vertical"></span>
    <span class="scope__dot"></span>
    <span class="scope__label">ОПТИКА · ПРИЦЕЛ</span>
  </div>

  <div class="reload-bar" id="reload-bar"><span id="reload-fill"></span></div>
  <div class="bomb-action" id="bomb-action" aria-live="polite">
    <div class="bomb-action__label" id="bomb-action-label"></div>
    <div class="bomb-action__bar" id="bomb-action-bar"><span id="bomb-action-fill"></span></div>
  </div>
  <div class="bomb-alert" id="bomb-alert" aria-live="polite">
    <div class="bomb-alert__icon">
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="4" y="4" width="16" height="16" rx="3" fill="rgba(239, 68, 68, 0.3)"></rect>
        <line x1="8" y1="8" x2="16" y2="8"></line>
        <line x1="8" y1="12" x2="16" y2="12"></line>
        <circle cx="12" cy="16" r="1.5" fill="#ef4444"></circle>
      </svg>
    </div>
    <div class="bomb-alert__text">
      <span class="bomb-alert__title">БОМБА ЗАЛОЖЕНА</span>
      <span class="bomb-alert__sub" id="bomb-alert-site">ОБЕЗВРЕДЬТЕ БОМБУ</span>
    </div>
  </div>
  <div class="announcement" id="announcement"><span id="announcement-text"></span><small id="announcement-sub"></small></div>
  <div class="toast" id="toast"></div>
  <div class="buy-zone-notice" id="buy-zone-notice" role="status">
    <span class="buy-zone-notice__icon">!</span>
    <span>ВЫ ВЫШЛИ ЗА ПРЕДЕЛЫ ЗОНЫ ПОКУПКИ</span>
  </div>

  <div class="vitals">
    <div class="vital vital--health">
      <div class="vital__head"><span class="vital__label">HP</span><span class="vital__value" id="health-value">100</span></div>
      <div class="vital__bar"><span id="health-fill"></span></div>
    </div>
    <div class="vital vital--armor">
      <div class="vital__head"><span class="vital__label">ARMOR</span><span class="vital__value" id="armor-value">0</span></div>
      <div class="vital__bar"><span id="armor-fill"></span></div>
      <span class="vital__extra" id="armor-extra"></span>
    </div>
    <div class="vital vital--money">
      <div class="vital__head"><span class="vital__label">ДЕНЬГИ</span><span class="vital__value" id="money-value">$800</span></div>
    </div>
    <div class="vital vital--bomb" id="bomb-vital">
      <div class="vital__head"><span class="vital__label">C4</span><span class="vital__value" id="bomb-status-value">BOMB</span></div>
    </div>
  </div>

  <div class="weapon-panel">
    <div class="weapon-panel__top"><span class="weapon-panel__eyebrow">ОРУЖИЕ</span><span class="weapon-panel__name" id="weapon-name">Glock</span></div>
    <div class="weapon-panel__ammo"><span id="ammo-value">20</span><span class="weapon-panel__reserve" id="ammo-reserve">/ 120</span></div>
    <div class="slots">
      <div class="slot" id="slot-primary"><span class="slot__key">1</span><span class="slot__label">ПЕРВИЧНОЕ</span></div>
      <div class="slot" id="slot-secondary"><span class="slot__key">2</span><span class="slot__label">ПИСТОЛЕТ</span></div>
      <div class="slot" id="slot-knife"><span class="slot__key">3</span><span class="slot__label">НОЖ</span></div>
      <div class="slot" id="slot-grenade"><span class="slot__key">4</span><span class="slot__label" id="grenade-slot-label">ГРАНАТЫ</span></div>
    </div>
    <div class="grenade-strip" id="grenade-strip"></div>
  </div>

  <div class="hint-bar"><span><kbd>WASD</kbd> движение</span><span><kbd>ЛКМ</kbd> огонь</span><span><kbd>R</kbd> перезарядка</span><span><kbd>F</kbd> осмотр</span><span><kbd>G</kbd> выброс</span><span><kbd>4</kbd> граната</span><span><kbd>B</kbd> магазин</span><span><kbd>SHIFT</kbd> тихий шаг</span><span><kbd>TAB</kbd> счёт</span><span><kbd>ESC</kbd> курсор</span></div>

  <div class="connection-banner" id="connection-banner"><span class="status-dot status-dot--offline"></span><span id="connection-text">ПЕРЕПОДКЛЮЧЕНИЕ...</span></div>

  <div class="overlay overlay--start" id="start-overlay">
    <div class="start__backdrop"></div>
    <div class="start__content">
      <div class="brand">
        <div class="brand__mark">W</div>
        <div>
          <h1>WOW ARENA</h1>
          <p>SERVER-AUTHORITATIVE 1V1</p>
        </div>
      </div>
      <div class="start__eyebrow">СОРЕВНОВАТЕЛЬНЫЙ РЕЖИМ <span>//</span> <span id="start-map-name">FY_SAND</span></div>
      <h2 id="start-title">Дуэль на арене</h2>
      <p class="start__lead" id="start-lead">Первый до 16 раундов. Каждое убийство завершает раунд и возвращает игроков на спавн. Победитель сохраняет оружие и броню, проигравший получает стартовый набор.</p>

      <form class="join-form" id="join-form">
        <label for="name-input">ПОЗЫВНОЙ</label>
        <div class="join-form__row">
          <input id="name-input" maxlength="16" autocomplete="off" spellcheck="false" placeholder="Введите позывной" />
          <button class="button button--primary" id="open-rooms-button" type="button"><span>НАЙТИ ИГРУ</span><b>→</b></button>
          <button class="button button--secondary" id="open-create-room-button" type="button"><span>СОЗДАТЬ</span><b>+</b></button>
          <button class="button button--primary is-hidden" id="join-button" type="submit"><span>В БОЙ</span></button>
        </div>
        <div class="join-form__tools">
          <button class="button button--ghost button--small" id="crosshair-button" type="button">ИЗМЕНИТЬ ПРИЦЕЛ</button>
          <button class="button button--ghost button--small" id="settings-button" type="button">НАСТРОЙКИ</button>
          <span class="join-form__crosshair" id="crosshair-selected">Классическая точка</span>
        </div>
        <p class="join-form__error" id="join-error"></p>
      </form>

      <div class="start__controls">
        <div><kbd>WASD</kbd><span>движение</span></div>
        <div><kbd>ЛКМ</kbd><span>огонь</span></div>
        <div><kbd>ПКМ</kbd><span>прицел AWP</span></div>
        <div><kbd>R</kbd><span>перезарядка</span></div>
        <div><kbd>F</kbd><span>осмотр оружия</span></div>
        <div><kbd>E</kbd><span>подобрать / заменить</span></div>
        <div><kbd>G</kbd><span>выбросить оружие</span></div>
        <div><kbd>B</kbd><span>магазин / закупка</span></div>
        <div><kbd>SPACE</kbd><span>прыжок</span></div>
        <div><kbd>CTRL</kbd><span>присесть · тихо</span></div>
        <div><kbd>SHIFT</kbd><span>тихий шаг</span></div>
      </div>

      <div class="start__footer">
        <span class="start__status"><span class="status-dot" id="start-status-dot"></span><span id="start-status">ПОДКЛЮЧЕНИЕ К СЕРВЕРУ</span></span>
        <span id="start-protocol">PROTOCOL V${PROTOCOL_VERSION} · 30 HZ</span>
      </div>
    </div>

    <aside class="start__aside">
      <div class="map-card">
        <div class="map-card__head"><span>КАРТА</span><strong id="map-card-name">FY_SAND</strong></div>
        <div class="map-card__preview">
          <div class="map-card__grid"></div>
          <span class="map-card__base map-card__base--alpha" id="map-base-alpha">ALPHA</span>
          <span class="map-card__base map-card__base--bravo" id="map-base-bravo">BRAVO</span>
          <span class="map-card__center"></span>
          <span class="map-card__dot map-card__dot--a"></span>
          <span class="map-card__dot map-card__dot--b"></span>
          <span class="map-card__dot map-card__dot--c"></span>
          <span class="map-card__dot map-card__dot--d"></span>
        </div>
        <div class="map-card__stats">
          <div><span id="map-card-size">44 × 33</span><small>РАЗМЕР</small></div>
          <div><span id="map-card-weapons">16</span><small id="map-card-weapons-label">ОРУЖИЕ</small></div>
          <div><span id="map-card-armor">2</span><small id="map-card-armor-label">БРОНЯ</small></div>
          <div><span>30</span><small>TICK / С</small></div>
        </div>
        <p class="map-card__note" id="map-card-note">Песчаная арена из BSP: две двухэтажные башни с входами со стороны спавна, два гаража с крышами и гранатами, узкие проходы.</p>
      </div>
      <div class="start__tip"><span>СОВЕТ</span> Откройте вторую вкладку, чтобы зайти вдвоём с одной машины.</div>
    </aside>
  </div>

  <div class="overlay overlay--crosshair" id="crosshair-overlay">
    <div class="panel panel--crosshair">
      <div class="eyebrow">ПРИЦЕЛ <span>//</span> ОБЩИЙ КАТАЛОГ</div>
      <h2>Настройка прицела</h2>
      <p class="panel__lead">Создайте точку, крест или крест с точкой. Сохранённый прицел появится в каталоге сервера и будет доступен всем игрокам.</p>
      <div class="crosshair-editor">
        <div class="crosshair-preview">
          <div class="crosshair-visual crosshair-visual--preview" id="crosshair-preview" data-style="dot">
            <span class="crosshair__dot"></span>
            <span class="crosshair__line crosshair__line--top"></span>
            <span class="crosshair__line crosshair__line--right"></span>
            <span class="crosshair__line crosshair__line--bottom"></span>
            <span class="crosshair__line crosshair__line--left"></span>
          </div>
          <span>ПРЕДПРОСМОТР</span>
        </div>
        <div class="crosshair-controls">
          <label class="crosshair-field"><span>НАЗВАНИЕ</span><input id="crosshair-name" maxlength="24" autocomplete="off" spellcheck="false" placeholder="Мой прицел" /></label>
          <label class="crosshair-field"><span>СТИЛЬ</span><select id="crosshair-style"></select></label>
          <label class="crosshair-field crosshair-field--color"><span>ЦВЕТ</span><input id="crosshair-color" type="color" value="#5eead4" /></label>
          <label class="crosshair-field"><span>ДЛИНА</span><input id="crosshair-length" type="range" min="2" max="20" step="1" value="8" /><output id="crosshair-length-value">8 px</output></label>
          <label class="crosshair-field"><span>ТОЛЩИНА</span><input id="crosshair-thickness" type="range" min="1" max="6" step="1" value="2" /><output id="crosshair-thickness-value">2 px</output></label>
          <label class="crosshair-field"><span>ЗАЗОР</span><input id="crosshair-gap" type="range" min="0" max="14" step="1" value="4" /><output id="crosshair-gap-value">4 px</output></label>
          <label class="crosshair-field"><span>ТОЧКА</span><input id="crosshair-dot-size" type="range" min="1" max="8" step="1" value="3" /><output id="crosshair-dot-size-value">3 px</output></label>
          <label class="crosshair-field"><span>ЯРКОСТЬ</span><input id="crosshair-opacity" type="range" min="0.2" max="1" step="0.05" value="1" /><output id="crosshair-opacity-value">100%</output></label>
        </div>
      </div>
      <div class="crosshair-saved">
        <div class="crosshair-saved__head"><span>КАТАЛОГ СЕРВЕРА</span><span id="crosshair-count">1 ВАРИАНТ</span></div>
        <div class="crosshair-list" id="crosshair-list"></div>
      </div>
      <p class="crosshair-status" id="crosshair-status"></p>
      <p class="join-form__error" id="crosshair-error"></p>
      <div class="panel__actions">
        <button class="button button--primary" id="crosshair-save" type="button">СОХРАНИТЬ НА СЕРВЕРЕ</button>
        <button class="button button--ghost" id="crosshair-reset" type="button">СБРОСИТЬ</button>
        <button class="button button--ghost" id="crosshair-close" type="button">ЗАКРЫТЬ</button>
      </div>
    </div>
  </div>

  <div class="overlay overlay--panel overlay--lobby" id="lobby-overlay">
    <div class="panel panel--lobby">
      <div class="eyebrow">ЛОББИ <span class="lobby-mode-tag" id="lobby-mode-tag">2v2</span> <span>//</span> <span id="lobby-map-name">FY_SAND</span></div>
      <h2 id="lobby-title">Ожидание игроков</h2>
      <p class="panel__lead" id="lobby-status">Займите сторону и нажмите «ГОТОВ» для начала игры.</p>

      <div class="lobby-teams" id="lobby-teams">
        <div class="lobby-team-column lobby-team--alpha">
          <div class="lobby-team-header">
            <div class="lobby-team-title">
              <span class="lobby-team-dot dot--t"></span>
              <strong>ТЕРРОРИСТЫ (T)</strong>
            </div>
            <button class="button button--small button--team-switch" id="join-team-alpha-btn" type="button">ВЫБРАТЬ T</button>
          </div>
          <div class="lobby-team-slots" id="slots-alpha"></div>
        </div>

        <div class="lobby-team-column lobby-team--bravo">
          <div class="lobby-team-header">
            <div class="lobby-team-title">
              <span class="lobby-team-dot dot--ct"></span>
              <strong>СПЕЦНАЗ (CT)</strong>
            </div>
            <button class="button button--small button--team-switch" id="join-team-bravo-btn" type="button">ВЫБРАТЬ CT</button>
          </div>
          <div class="lobby-team-slots" id="slots-bravo"></div>
        </div>
      </div>

      <div class="lobby-footer">
        <div class="lobby-footer__controls">
          <button class="button button--primary" id="lobby-ready-btn" type="button">ГОТОВ К ИГРЕ</button>
          <span class="lobby-timer" id="lobby-timer">Ожидание готовности</span>
        </div>
        <div class="lobby-footer__actions">
          <button class="button button--ghost button--small" id="copy-link" type="button">СКОПИРОВАТЬ ССЫЛКУ</button>
          <button class="button button--ghost button--small" id="lobby-leave-button" type="button">ВЫЙТИ</button>
        </div>
      </div>
    </div>
  </div>

  <div class="overlay overlay--panel" id="pause-overlay">
    <div class="panel panel--pause">
      <div class="eyebrow">ПАУЗА</div>
      <h2>Курсор освобождён</h2>
      <p class="panel__lead">Вернитесь в бой, чтобы продолжить. Матч не останавливается.</p>
      <div class="panel__actions">
        <button class="button button--primary" id="resume-button" type="button">ПРОДОЛЖИТЬ</button>
        <button class="button button--ghost" id="pause-settings-button" type="button">НАСТРОЙКИ</button>
        <button class="button button--ghost" id="leave-button" type="button">ВЫЙТИ</button>
      </div>
    </div>
  </div>

  <div class="overlay overlay--death" id="death-overlay">
    <div class="death-card">
      <div class="eyebrow">УСТРАНЕН</div>
      <h2>Вы выбыли</h2>
      <p id="death-sub">Возрождение через</p>
      <div class="death-timer" id="death-timer">3</div>
    </div>
  </div>

  <div class="overlay overlay--settings" id="settings-overlay">
    <div class="panel panel--settings">
      <div class="eyebrow">НАСТРОЙКИ <span>//</span> В ИГРЕ</div>
      <h2>Настройки матча</h2>
      <p class="panel__lead">Настройки управления, звука и прицела сохраняются в браузере и применяются мгновенно во время боя.</p>
      <div class="settings-columns">
        <div class="settings-column">
          <div class="settings-column__head"><span class="settings-column__title">УПРАВЛЕНИЕ И ЗВУК</span></div>
          <div class="settings-grid">
            <label class="settings-field"><span>ЧУВСТВИТЕЛЬНОСТЬ</span><input id="setting-sensitivity" type="range" min="0.2" max="3" step="0.05" value="1" /><output id="setting-sensitivity-value">×1.00</output></label>
            <label class="settings-field"><span>AWP ЧУВСТВИТЕЛЬНОСТЬ</span><input id="setting-awp-sensitivity" type="range" min="0.2" max="2" step="0.05" value="0.7" /><output id="setting-awp-sensitivity-value">×0.70</output></label>
            <label class="settings-field"><span>УГОЛ ОБЗОРА</span><input id="setting-fov" type="range" min="60" max="110" step="1" value="78" /><output id="setting-fov-value">78°</output></label>
            <label class="settings-field"><span>ОБЩАЯ ГРОМКОСТЬ</span><input id="setting-master-volume" type="range" min="0" max="1" step="0.05" value="0.7" /><output id="setting-master-volume-value">70%</output></label>
            <label class="settings-field"><span>ЭФФЕКТЫ</span><input id="setting-effects-volume" type="range" min="0" max="1" step="0.05" value="0.8" /><output id="setting-effects-volume-value">80%</output></label>
            <label class="settings-toggle"><input id="setting-toggle-walk" type="checkbox" /><span>Переключать тихий шаг</span></label>
            <label class="settings-toggle"><input id="setting-toggle-scope" type="checkbox" checked /><span>Переключать прицел AWP</span></label>
            <label class="settings-toggle"><input id="setting-radar-rotate" type="checkbox" checked /><span>Вращение радара</span></label>
            <label class="settings-field"><span>РАЗМЕР РАДАРА</span><input id="setting-radar-scale" type="range" min="0.75" max="1.35" step="0.05" value="1" /><output id="setting-radar-scale-value">100%</output></label>
            <label class="settings-field"><span>МАСШТАБ КАРТЫ</span><input id="setting-radar-zoom" type="range" min="0.7" max="1.4" step="0.05" value="1" /><output id="setting-radar-zoom-value">100%</output></label>
          </div>
        </div>

        <div class="settings-column">
          <div class="settings-column__head"><span class="settings-column__title">ПРИЦЕЛ</span></div>
          <div class="settings-crosshair-preview">
            <div class="crosshair-visual crosshair-visual--preview" id="in-game-crosshair-preview" data-style="dot">
              <span class="crosshair__dot"></span>
              <span class="crosshair__line crosshair__line--top"></span>
              <span class="crosshair__line crosshair__line--right"></span>
              <span class="crosshair__line crosshair__line--bottom"></span>
              <span class="crosshair__line crosshair__line--left"></span>
            </div>
          </div>
          <div class="settings-crosshair-controls">
            <label class="settings-field">
              <span>СТИЛЬ</span>
              <select id="setting-crosshair-style" class="settings-select">
                <option value="dot">ТОЧКА</option>
                <option value="cross">КЛАССИЧЕСКИЙ КРЕСТ</option>
                <option value="cross-dot">КРЕСТ С ТОЧКОЙ</option>
                <option value="none">БЕЗ ПРИЦЕЛА</option>
              </select>
            </label>
            <label class="settings-field settings-field--color">
              <span>ЦВЕТ</span>
              <input id="setting-crosshair-color" type="color" value="#5eead4" />
            </label>
            <label class="settings-field">
              <span>ДЛИНА</span>
              <input id="setting-crosshair-length" type="range" min="2" max="20" step="1" value="8" />
              <output id="setting-crosshair-length-value">8 px</output>
            </label>
            <label class="settings-field">
              <span>ТОЛЩИНА</span>
              <input id="setting-crosshair-thickness" type="range" min="1" max="6" step="1" value="2" />
              <output id="setting-crosshair-thickness-value">2 px</output>
            </label>
            <label class="settings-field">
              <span>ЗАЗОР</span>
              <input id="setting-crosshair-gap" type="range" min="0" max="14" step="1" value="4" />
              <output id="setting-crosshair-gap-value">4 px</output>
            </label>
            <label class="settings-field">
              <span>ТОЧКА</span>
              <input id="setting-crosshair-dot-size" type="range" min="1" max="8" step="1" value="3" />
              <output id="setting-crosshair-dot-size-value">3 px</output>
            </label>
            <label class="settings-field">
              <span>ЯРКОСТЬ</span>
              <input id="setting-crosshair-opacity" type="range" min="0.2" max="1" step="0.05" value="1" />
              <output id="setting-crosshair-opacity-value">100%</output>
            </label>
          </div>
        </div>
      </div>
      <div class="panel__actions">
        <button class="button button--primary" id="settings-reset" type="button">СБРОСИТЬ ВСЁ</button>
        <button class="button button--ghost" id="settings-close" type="button">ЗАКРЫТЬ</button>
      </div>
    </div>
  </div>

  <div class="overlay overlay--panel" id="results-overlay">
    <div class="panel panel--results">
      <div class="eyebrow">МАТЧ ЗАВЕРШЁН <span>//</span> <span id="results-map-name">FY_SAND</span></div>
      <h2 id="results-title">ПОБЕДА</h2>
      <p class="panel__lead" id="results-sub">Отличная игра</p>
      <div class="results-score">
        <div class="results-score__team results-score__team--alpha"><span id="results-alpha-label">ALPHA</span><strong id="results-alpha">0</strong></div>
        <div class="results-score__sep">:</div>
        <div class="results-score__team results-score__team--bravo"><span id="results-bravo-label">BRAVO</span><strong id="results-bravo">0</strong></div>
      </div>
      <div class="results-reason" id="results-reason">Достигнут лимит раундов</div>
      <div class="results-votes" id="results-votes">Голоса за реванш: 0 / 2</div>
      <div class="panel__actions">
        <button class="button button--primary" id="rematch-button" type="button">РЕВАНШ</button>
        <button class="button button--ghost" id="leave-results" type="button">ВЫЙТИ</button>
      </div>
    </div>
  </div>

  <div class="overlay overlay--buy" id="buy-overlay">
    <div class="buy-panel">
      <header class="buy-panel__head">
        <div class="buy-panel__title">
          <div class="eyebrow">ЗАКУПКА <span>//</span> <b id="buy-side">T</b></div>
          <h2>Вооружение</h2>
          <p class="buy-panel__lead">Выберите снаряжение на этот раунд. Все категории доступны сразу.</p>
        </div>
        <div class="buy-panel__stats">
          <div><small>ДЕНЬГИ</small><strong id="buy-money">$800</strong></div>
          <div><small>ДО КОНЦА БАЯ</small><strong id="buy-timer">0:20</strong></div>
        </div>
        <button class="button button--ghost button--small" id="buy-close" type="button">ESC — ЗАКРЫТЬ</button>
      </header>
      <div class="buy-grid" id="buy-grid"></div>
      <footer class="buy-panel__foot">
        <span id="buy-status">Кликните по предмету, чтобы купить</span>
        <span>ESC / B — закрыть · ВОЗВРАТ ТОЛЬКО ПОСЛЕДНЕЙ ПОКУПКИ</span>
      </footer>
    </div>
  </div>

  <div class="overlay overlay--scoreboard" id="scoreboard-overlay">
    <div class="scoreboard">
      <div class="scoreboard__head"><span>ТАБЛИЦА МАТЧА</span><strong id="scoreboard-time">10:00</strong><span id="scoreboard-map-name">FY_SAND</span></div>
      <div class="scoreboard__body" id="scoreboard-body"></div>
      <div class="scoreboard__foot">TAB — ЗАКРЫТЬ</div>
    </div>
  </div>

  <div class="overlay overlay--panel overlay--rooms" id="rooms-overlay">
    <div class="panel panel--rooms">
      <div class="panel__head">
        <div>
          <div class="eyebrow">СЕССИИ <span>//</span> ДОСТУПНЫЕ ИГРЫ</div>
          <h2>Список комнат</h2>
          <p class="panel__lead">Выберите игру для подключения 1v1 или создайте собственную.</p>
        </div>
        <div class="panel__head-actions">
          <button class="button button--primary button--small" id="rooms-create-btn" type="button">+ СОЗДАТЬ ИГРУ</button>
          <button class="button button--ghost button--small" id="rooms-refresh-btn" type="button">ОБНОВИТЬ</button>
          <button class="button button--ghost button--small" id="rooms-close-btn" type="button">✕ В МЕНЮ</button>
        </div>
      </div>
      <div class="rooms-container">
        <div class="rooms-list" id="rooms-list"></div>
      </div>
    </div>
  </div>

  <div class="overlay overlay--panel overlay--create-room" id="create-room-overlay">
    <div class="panel panel--create-room">
      <div class="eyebrow">НОВАЯ СЕССИЯ <span>//</span> НАСТРОЙКА</div>
      <h2>Создать игру</h2>
      <p class="panel__lead">Выберите формат матча, карту и задайте название комнаты.</p>
      <form class="create-room-form" id="create-room-form">
        <label for="create-room-name">НАЗВАНИЕ ИГРЫ</label>
        <input id="create-room-name" maxlength="32" placeholder="Например: Битва на Dust 2" autocomplete="off" />

        <div class="mode-select-title">ФОРМАТ МАТЧА</div>
        <div class="mode-cards-grid" id="mode-cards-grid">
          <label class="mode-radio-card is-selected">
            <input type="radio" name="create-room-mode" value="1v1" checked />
            <div class="mode-radio-card__badge">ДУЭЛЬ</div>
            <div class="mode-radio-card__name">1 VS 1</div>
            <div class="mode-radio-card__desc">2 игрока (1T против 1CT)</div>
          </label>
          <label class="mode-radio-card">
            <input type="radio" name="create-room-mode" value="2v2" />
            <div class="mode-radio-card__badge">КОМАНДЫ</div>
            <div class="mode-radio-card__name">2 VS 2</div>
            <div class="mode-radio-card__desc">4 игрока (2T против 2CT)</div>
          </label>
        </div>

        <div class="map-select-title">ВЫБЕРИТЕ КАРТУ</div>
        <div class="map-cards-grid" id="map-cards-grid">
          <label class="map-radio-card is-selected">
            <input type="radio" name="create-map-id" value="de_dust2" checked />
            <div class="map-radio-card__badge">СОРЕВНОВАТЕЛЬНЫЙ</div>
            <div class="map-radio-card__name">DE_DUST2</div>
            <div class="map-radio-card__desc">Экономика, закупка и закладка C4 на точках A и B.</div>
          </label>
          <label class="map-radio-card">
            <input type="radio" name="create-map-id" value="fy_wow" />
            <div class="map-radio-card__badge">АРЕНА + C4</div>
            <div class="map-radio-card__name">FY_WOW</div>
            <div class="map-radio-card__desc">Двухуровневая арена, закупка оружия и бомба C4.</div>
          </label>
          <label class="map-radio-card">
            <input type="radio" name="create-map-id" value="fy_sand" />
            <div class="map-radio-card__badge">КЛАССИКА</div>
            <div class="map-radio-card__name">FY_SAND</div>
            <div class="map-radio-card__desc">Арена дуэлей до 16 побед со спавном оружия на карте.</div>
          </label>
        </div>

        <p class="join-form__error" id="create-room-error"></p>
        <div class="panel__actions">
          <button class="button button--primary" id="create-room-submit-btn" type="submit">СОЗДАТЬ И ВОЙТИ</button>
          <button class="button button--ghost" id="create-room-cancel-btn" type="button">ОТМЕНА</button>
        </div>
      </form>
    </div>
  </div>
</div>
`;

export function createHud(callbacks: HudCallbacks): Hud {
  const root = document.getElementById('hud-root');
  if (root === null) {
    throw new Error('Missing #hud-root container');
  }
  root.innerHTML = HUD_TEMPLATE;
  const crosshairEditor: CrosshairEditor = createCrosshairEditor(root);

  const startOverlay = requireElement<HTMLDivElement>(root, 'start-overlay');
  const lobbyOverlay = requireElement<HTMLDivElement>(root, 'lobby-overlay');
  const pauseOverlay = requireElement<HTMLDivElement>(root, 'pause-overlay');
  const deathOverlay = requireElement<HTMLDivElement>(root, 'death-overlay');
  const resultsOverlay = requireElement<HTMLDivElement>(root, 'results-overlay');
  const scoreboardOverlay = requireElement<HTMLDivElement>(root, 'scoreboard-overlay');
  const connectionBanner = requireElement<HTMLDivElement>(root, 'connection-banner');
  const connectionText = requireElement<HTMLSpanElement>(root, 'connection-text');
  const nameInput = requireElement<HTMLInputElement>(root, 'name-input');
  const joinForm = requireElement<HTMLFormElement>(root, 'join-form');
  const joinButton = requireElement<HTMLButtonElement>(root, 'join-button');
  const openRoomsButton = requireElement<HTMLButtonElement>(root, 'open-rooms-button');
  const openCreateRoomButton = requireElement<HTMLButtonElement>(root, 'open-create-room-button');
  const joinError = requireElement<HTMLParagraphElement>(root, 'join-error');
  const roomsOverlay = requireElement<HTMLDivElement>(root, 'rooms-overlay');
  const roomsList = requireElement<HTMLDivElement>(root, 'rooms-list');
  const roomsCreateBtn = requireElement<HTMLButtonElement>(root, 'rooms-create-btn');
  const roomsRefreshBtn = requireElement<HTMLButtonElement>(root, 'rooms-refresh-btn');
  const roomsCloseBtn = requireElement<HTMLButtonElement>(root, 'rooms-close-btn');

  const createRoomOverlay = requireElement<HTMLDivElement>(root, 'create-room-overlay');
  const createRoomForm = requireElement<HTMLFormElement>(root, 'create-room-form');
  const createRoomNameInput = requireElement<HTMLInputElement>(root, 'create-room-name');
  const mapCardsGrid = requireElement<HTMLDivElement>(root, 'map-cards-grid');
  const modeCardsGrid = requireElement<HTMLDivElement>(root, 'mode-cards-grid');
  const createRoomError = requireElement<HTMLParagraphElement>(root, 'create-room-error');
  const createRoomCancelBtn = requireElement<HTMLButtonElement>(root, 'create-room-cancel-btn');
  const startStatus = requireElement<HTMLSpanElement>(root, 'start-status');
  const startStatusDot = requireElement<HTMLSpanElement>(root, 'start-status-dot');
  const startProtocol = requireElement<HTMLSpanElement>(root, 'start-protocol');
  const startMapName = requireElement<HTMLSpanElement>(root, 'start-map-name');
  const mapCardName = requireElement<HTMLElement>(root, 'map-card-name');
  const mapCardSize = requireElement<HTMLElement>(root, 'map-card-size');
  const mapCardWeapons = requireElement<HTMLElement>(root, 'map-card-weapons');
  const mapCardArmor = requireElement<HTMLElement>(root, 'map-card-armor');
  const mapCardNote = requireElement<HTMLElement>(root, 'map-card-note');
  const lobbyMapName = requireElement<HTMLElement>(root, 'lobby-map-name');
  const resultsMapName = requireElement<HTMLElement>(root, 'results-map-name');
  const scoreboardMapName = requireElement<HTMLElement>(root, 'scoreboard-map-name');
  const hudStatus = requireElement<HTMLSpanElement>(root, 'hud-status');
  const hudStatusDot = requireElement<HTMLSpanElement>(root, 'hud-status-dot');
  const hudPing = requireElement<HTMLSpanElement>(root, 'hud-ping');
  const matchClock = requireElement<HTMLDivElement>(root, 'match-clock');
  const hudPhase = requireElement<HTMLDivElement>(root, 'hud-phase');
  const hudTime = requireElement<HTMLDivElement>(root, 'hud-time');
  const hudFragLimit = requireElement<HTMLDivElement>(root, 'hud-fraglimit');
  const bombAction = requireElement<HTMLDivElement>(root, 'bomb-action');
  const bombActionLabel = requireElement<HTMLDivElement>(root, 'bomb-action-label');
  const bombActionBar = requireElement<HTMLDivElement>(root, 'bomb-action-bar');
  const bombActionFill = requireElement<HTMLSpanElement>(root, 'bomb-action-fill');
  const bombVital = requireElement<HTMLDivElement>(root, 'bomb-vital');
  const bombStatusValue = requireElement<HTMLSpanElement>(root, 'bomb-status-value');
  const scoreAlpha = requireElement<HTMLDivElement>(root, 'score-alpha');
  const scoreBravo = requireElement<HTMLDivElement>(root, 'score-bravo');
  const barAlpha = requireElement<HTMLSpanElement>(root, 'bar-alpha');
  const barBravo = requireElement<HTMLSpanElement>(root, 'bar-bravo');
  const teamAlpha = requireElement<HTMLDivElement>(root, 'team-alpha');
  const teamBravo = requireElement<HTMLDivElement>(root, 'team-bravo');
  const cs2Topbar = requireElement<HTMLElement>(root, 'cs2-topbar');
  const scoreCt = requireElement<HTMLSpanElement>(root, 'score-ct');
  const scoreT = requireElement<HTMLSpanElement>(root, 'score-t');
  const cs2PlayersCt = requireElement<HTMLDivElement>(root, 'cs2-players-ct');
  const cs2PlayersT = requireElement<HTMLDivElement>(root, 'cs2-players-t');
  const healthValue = requireElement<HTMLSpanElement>(root, 'health-value');
  const healthFill = requireElement<HTMLSpanElement>(root, 'health-fill');
  const armorValue = requireElement<HTMLSpanElement>(root, 'armor-value');
  const armorFill = requireElement<HTMLSpanElement>(root, 'armor-fill');
  const weaponName = requireElement<HTMLSpanElement>(root, 'weapon-name');
  const ammoValue = requireElement<HTMLSpanElement>(root, 'ammo-value');
  const ammoReserve = requireElement<HTMLSpanElement>(root, 'ammo-reserve');
  const slotPrimary = requireElement<HTMLDivElement>(root, 'slot-primary');
  const slotSecondary = requireElement<HTMLDivElement>(root, 'slot-secondary');
  const slotKnife = requireElement<HTMLDivElement>(root, 'slot-knife');
  const slotGrenade = requireElement<HTMLDivElement>(root, 'slot-grenade');
  const scopeOverlay = requireElement<HTMLDivElement>(root, 'scope-overlay');
  const reloadBar = requireElement<HTMLDivElement>(root, 'reload-bar');
  const reloadFill = requireElement<HTMLSpanElement>(root, 'reload-fill');
  const announcement = requireElement<HTMLDivElement>(root, 'announcement');
  const announcementText = requireElement<HTMLSpanElement>(root, 'announcement-text');
  const announcementSub = requireElement<HTMLElement>(root, 'announcement-sub');
  const toast = requireElement<HTMLDivElement>(root, 'toast');
  const buyZoneNotice = requireElement<HTMLDivElement>(root, 'buy-zone-notice');
  const killfeed = requireElement<HTMLDivElement>(root, 'killfeed');
  const damageFlash = requireElement<HTMLDivElement>(root, 'damage-flash');
  const damageDirection = requireElement<HTMLDivElement>(root, 'damage-direction');
  const settingsOverlay = requireElement<HTMLDivElement>(root, 'settings-overlay');
  const settingsButton = requireElement<HTMLButtonElement>(root, 'settings-button');
  const pauseSettingsButton = requireElement<HTMLButtonElement>(root, 'pause-settings-button');
  const settingsClose = requireElement<HTMLButtonElement>(root, 'settings-close');
  const settingsReset = requireElement<HTMLButtonElement>(root, 'settings-reset');
  const settingSensitivity = requireElement<HTMLInputElement>(root, 'setting-sensitivity');
  const settingAwpSensitivity = requireElement<HTMLInputElement>(root, 'setting-awp-sensitivity');
  const settingFov = requireElement<HTMLInputElement>(root, 'setting-fov');
  const settingMasterVolume = requireElement<HTMLInputElement>(root, 'setting-master-volume');
  const settingEffectsVolume = requireElement<HTMLInputElement>(root, 'setting-effects-volume');
  const settingToggleWalk = requireElement<HTMLInputElement>(root, 'setting-toggle-walk');
  const settingToggleScope = requireElement<HTMLInputElement>(root, 'setting-toggle-scope');
  const settingRadarRotate = requireElement<HTMLInputElement>(root, 'setting-radar-rotate');
  const settingRadarScale = requireElement<HTMLInputElement>(root, 'setting-radar-scale');
  const settingRadarScaleValue = requireElement<HTMLOutputElement>(root, 'setting-radar-scale-value');
  const settingRadarZoom = requireElement<HTMLInputElement>(root, 'setting-radar-zoom');
  const settingRadarZoomValue = requireElement<HTMLOutputElement>(root, 'setting-radar-zoom-value');
  const radarContainer = requireElement<HTMLDivElement>(root, 'radar-container');
  const radar = new Radar(radarContainer);
  const settingSensitivityValue = requireElement<HTMLOutputElement>(
    root,
    'setting-sensitivity-value',
  );
  const settingAwpSensitivityValue = requireElement<HTMLOutputElement>(
    root,
    'setting-awp-sensitivity-value',
  );
  const settingFovValue = requireElement<HTMLOutputElement>(root, 'setting-fov-value');
  const settingMasterVolumeValue = requireElement<HTMLOutputElement>(
    root,
    'setting-master-volume-value',
  );
  const settingEffectsVolumeValue = requireElement<HTMLOutputElement>(
    root,
    'setting-effects-volume-value',
  );
  const hudCrosshair = requireElement<HTMLDivElement>(root, 'crosshair');
  const inGameCrosshairPreview = requireElement<HTMLDivElement>(root, 'in-game-crosshair-preview');
  const settingCrosshairStyle = requireElement<HTMLSelectElement>(root, 'setting-crosshair-style');
  const settingCrosshairColor = requireElement<HTMLInputElement>(root, 'setting-crosshair-color');
  const settingCrosshairLength = requireElement<HTMLInputElement>(root, 'setting-crosshair-length');
  const settingCrosshairThickness = requireElement<HTMLInputElement>(
    root,
    'setting-crosshair-thickness',
  );
  const settingCrosshairGap = requireElement<HTMLInputElement>(root, 'setting-crosshair-gap');
  const settingCrosshairDotSize = requireElement<HTMLInputElement>(
    root,
    'setting-crosshair-dot-size',
  );
  const settingCrosshairOpacity = requireElement<HTMLInputElement>(
    root,
    'setting-crosshair-opacity',
  );
  const settingCrosshairLengthValue = requireElement<HTMLOutputElement>(
    root,
    'setting-crosshair-length-value',
  );
  const settingCrosshairThicknessValue = requireElement<HTMLOutputElement>(
    root,
    'setting-crosshair-thickness-value',
  );
  const settingCrosshairGapValue = requireElement<HTMLOutputElement>(
    root,
    'setting-crosshair-gap-value',
  );
  const settingCrosshairDotSizeValue = requireElement<HTMLOutputElement>(
    root,
    'setting-crosshair-dot-size-value',
  );
  const settingCrosshairOpacityValue = requireElement<HTMLOutputElement>(
    root,
    'setting-crosshair-opacity-value',
  );

  const bombAlert = requireElement<HTMLDivElement>(root, 'bomb-alert');
  const bombAlertSite = requireElement<HTMLSpanElement>(root, 'bomb-alert-site');
  let bombAlertTimer: number | undefined;
  const lobbyTitle = requireElement<HTMLHeadingElement>(root, 'lobby-title');
  const lobbyStatus = requireElement<HTMLParagraphElement>(root, 'lobby-status');
  const lobbyModeTag = requireElement<HTMLSpanElement>(root, 'lobby-mode-tag');
  const joinTeamAlphaBtn = requireElement<HTMLButtonElement>(root, 'join-team-alpha-btn');
  const joinTeamBravoBtn = requireElement<HTMLButtonElement>(root, 'join-team-bravo-btn');
  const slotsAlpha = requireElement<HTMLDivElement>(root, 'slots-alpha');
  const slotsBravo = requireElement<HTMLDivElement>(root, 'slots-bravo');
  const lobbyReadyBtn = requireElement<HTMLButtonElement>(root, 'lobby-ready-btn');
  const lobbyLeaveButton = requireElement<HTMLButtonElement>(root, 'lobby-leave-button');
  const lobbyTimer = requireElement<HTMLSpanElement>(root, 'lobby-timer');
  const copyLinkButton = requireElement<HTMLButtonElement>(root, 'copy-link');
  const resumeButton = requireElement<HTMLButtonElement>(root, 'resume-button');
  const leaveButton = requireElement<HTMLButtonElement>(root, 'leave-button');
  const resultsTitle = requireElement<HTMLHeadingElement>(root, 'results-title');
  const resultsSub = requireElement<HTMLParagraphElement>(root, 'results-sub');
  const resultsAlpha = requireElement<HTMLElement>(root, 'results-alpha');
  const resultsBravo = requireElement<HTMLElement>(root, 'results-bravo');
  const resultsReason = requireElement<HTMLDivElement>(root, 'results-reason');
  const resultsVotes = requireElement<HTMLDivElement>(root, 'results-votes');
  const rematchButton = requireElement<HTMLButtonElement>(root, 'rematch-button');
  const leaveResults = requireElement<HTMLButtonElement>(root, 'leave-results');
  const scoreboardTime = requireElement<HTMLElement>(root, 'scoreboard-time');
  const scoreboardBody = requireElement<HTMLDivElement>(root, 'scoreboard-body');
  const deathSub = requireElement<HTMLParagraphElement>(root, 'death-sub');
  const deathTimer = requireElement<HTMLDivElement>(root, 'death-timer');
  const labelAlpha = requireElement<HTMLSpanElement>(root, 'label-alpha');
  const labelBravo = requireElement<HTMLSpanElement>(root, 'label-bravo');
  const armorExtra = requireElement<HTMLSpanElement>(root, 'armor-extra');
  const moneyValue = requireElement<HTMLSpanElement>(root, 'money-value');
  const grenadeStrip = requireElement<HTMLDivElement>(root, 'grenade-strip');
  const grenadeSlotLabel = requireElement<HTMLSpanElement>(root, 'grenade-slot-label');
  const flashOverlay = requireElement<HTMLDivElement>(root, 'flash-overlay');
  const buyOverlay = requireElement<HTMLDivElement>(root, 'buy-overlay');
  const buyGrid = requireElement<HTMLDivElement>(root, 'buy-grid');
  const buySideLabel = requireElement<HTMLElement>(root, 'buy-side');
  const buyMoney = requireElement<HTMLElement>(root, 'buy-money');
  const buyTimer = requireElement<HTMLElement>(root, 'buy-timer');
  const buyStatus = requireElement<HTMLElement>(root, 'buy-status');
  const buyClose = requireElement<HTMLButtonElement>(root, 'buy-close');
  const startTitle = requireElement<HTMLHeadingElement>(root, 'start-title');
  const mapCardWeaponsLabel = requireElement<HTMLElement>(root, 'map-card-weapons-label');
  const mapCardArmorLabel = requireElement<HTMLElement>(root, 'map-card-armor-label');
  const mapBaseAlpha = requireElement<HTMLElement>(root, 'map-base-alpha');
  const mapBaseBravo = requireElement<HTMLElement>(root, 'map-base-bravo');
  const resultsAlphaLabel = requireElement<HTMLElement>(root, 'results-alpha-label');
  const resultsBravoLabel = requireElement<HTMLElement>(root, 'results-bravo-label');
  const startLead = requireElement<HTMLParagraphElement>(root, 'start-lead');
  const roundBanner = requireElement<HTMLDivElement>(root, 'round-banner');
  const roundBannerLabel = requireElement<HTMLDivElement>(root, 'round-banner-label');
  const roundBannerName = requireElement<HTMLDivElement>(root, 'round-banner-name');
  const roundBannerSub = requireElement<HTMLDivElement>(root, 'round-banner-sub');
  const spectatorFade = requireElement<HTMLDivElement>(root, 'spectator-fade');
  const spectatorBar = requireElement<HTMLDivElement>(root, 'spectator-bar');
  const spectatorLabel = requireElement<HTMLDivElement>(root, 'spectator-label');
  const spectatorName = requireElement<HTMLDivElement>(root, 'spectator-name');
  const spectatorHint = requireElement<HTMLDivElement>(root, 'spectator-hint');
  const spectatorKiller = requireElement<HTMLDivElement>(root, 'spectator-killer');

  let spectatorState: SpectatorHudState | null = null;

  let latestSnapshot: Snapshot | null = null;
  let latestLobby: LobbyState | null = null;
  let currentMap: ArenaMap | null = null;
  let localPlayerId: string | null = null;
  let connected = false;
  let joinBusy = false;
  let resultsEvent: RoundEndEvent | null = null;
  let announcementTimer: number | undefined;
  let toastTimer: number | undefined;
  let damageTimer: number | undefined;
  let latestRoundSummary: RoundSummaryEvent | null = null;
  let pendingRoundSummary: RoundSummaryEvent | null = null;
  let lastSummaryAppliedRound = 0;
  let networkPing: number | null = null;
  let networkJitter = 0;
  let networkLoss = 0;
  let buySide: Side | null = null;
  let buyOpen = false;
  let lastBuyInZone = false;
  let blindPeakMs = 0;
  let lastBlindRemainingMs = 0;
  const buyButtons = new Map<
    string,
    {
      buy: HTMLButtonElement;
      refund: HTMLButtonElement;
      card: HTMLDivElement;
      price: HTMLSpanElement;
    }
  >();
  let settings = loadSettings();
  let disposed = false;
  const timeouts = new Set<number>();

  const schedule = (callback: () => void, delay: number): number => {
    const id = window.setTimeout(() => {
      timeouts.delete(id);
      callback();
    }, delay);
    timeouts.add(id);
    return id;
  };

  const setOverlayVisible = (element: HTMLElement, visible: boolean): void => {
    element.classList.toggle('is-visible', visible);
  };

  const isOverlayVisible = (element: HTMLElement): boolean =>
    element.classList.contains('is-visible');

  const renderNetwork = (): void => {
    if (networkPing === null) {
      setText(hudPing, 'PING —');
      return;
    }
    setText(
      hudPing,
      `PING ${Math.round(networkPing)} MS · JIT ${Math.round(networkJitter)} · LOSS ${networkLoss.toFixed(1)}%`,
    );
  };

  const formatMoney = (money: number): string => `$${Math.round(money).toLocaleString('en-US')}`;

  const sideForTeam = (team: Team): Side =>
    latestSnapshot?.players.find((player) => player.team === team)?.side ??
    (team === 'alpha' ? 't' : 'ct');

  const buyItemStats = (item: BuyItem): string[] => {
    if (item.weapon !== undefined) {
      const definition = getWeapon(item.weapon);
      if (definition.slot === 'grenade') {
        if (item.weapon === 'flashbang') {
          return ['ОСЛЕПЛЕНИЕ', 'ДО 4.8 С'];
        }
        if (item.weapon === 'smokegrenade') {
          return ['ДЫМ', '15 С'];
        }
        if (item.weapon === 'molotov' || item.weapon === 'incendiary') {
          return ['ОГОНЬ', '7 С'];
        }
        return ['УРОН 85', 'РАДИУС 4 М'];
      }
      return [
        `УРОН ${definition.damage}`,
        `MAG ${definition.magazine}`,
        `RPM ${Math.round(definition.rpm)}`,
      ];
    }
    if (item.gear === 'kevlar') {
      return ['БРОНЯ 100'];
    }
    if (item.gear === 'kevlar_helmet') {
      return ['БРОНЯ 100', 'ШЛЕМ'];
    }
    return ['ДЕФЬЮЗ', '4 СЕК'];
  };

  const renderBuyGrid = (side: Side): void => {
    buyGrid.replaceChildren();
    buyButtons.clear();
    for (const category of BUY_CATEGORIES) {
      const column = createElement('section', `buy-column buy-column--${category}`);
      column.append(createElement('h3', 'buy-column__title', BUY_CATEGORY_LABELS[category]));
      const list = createElement('div', 'buy-column__list');
      for (const item of BUY_ITEMS) {
        if (item.category !== category || (item.side !== 'both' && item.side !== side)) {
          continue;
        }
        const card = createElement('div', `buy-item buy-item--${category}`);
        card.dataset.itemId = item.id;
        const buyButton = createElement('button', 'buy-item__buy') as HTMLButtonElement;
        buyButton.type = 'button';
        buyButton.dataset.buyAction = 'buy';
        buyButton.dataset.itemId = item.id;
        const price = createElement('span', 'buy-item__price', formatMoney(item.price));
        const head = createElement('span', 'buy-item__head');
        head.append(createElement('span', 'buy-item__name', item.name), price);
        const stats = createElement('span', 'buy-item__stats');
        for (const stat of buyItemStats(item)) {
          stats.append(createElement('span', 'buy-item__stat', stat));
        }
        buyButton.append(head, stats);
        const refundButton = createElement(
          'button',
          'buy-item__refund',
          'ВЕРНУТЬ ПОСЛЕДНЮЮ ПОКУПКУ',
        ) as HTMLButtonElement;
        refundButton.type = 'button';
        refundButton.dataset.buyAction = 'refund';
        refundButton.dataset.itemId = item.id;
        card.append(buyButton, refundButton);
        list.append(card);
        buyButtons.set(item.id, { buy: buyButton, refund: refundButton, card, price });
      }
      column.append(list);
      buyGrid.append(column);
    }
  };

  const itemAvailability = (
    item: BuyItem,
    local: PlayerSnapshot,
    canBuy: boolean,
  ): { disabled: boolean; reason: string } => {
    if (!canBuy) {
      return { disabled: true, reason: 'Закупка сейчас недоступна' };
    }
    if (local.money < getBuyPrice(item, local.armor, local.helmet)) {
      return { disabled: true, reason: 'Недостаточно денег' };
    }
    if (item.weapon !== undefined) {
      const definition = getWeapon(item.weapon);
      if (definition.slot === 'grenade') {
        const type = item.weapon as GrenadeType;
        const count = local.grenades[type] ?? 0;
        const total = Object.values(local.grenades).reduce((sum, value) => sum + (value ?? 0), 0);
        if (count >= GRENADE_LIMITS[type]) {
          return { disabled: true, reason: 'Лимит этого типа гранат' };
        }
        if (total >= MAX_GRENADES) {
          return { disabled: true, reason: 'Лимит гранат: 4' };
        }
      } else if (local.activeWeapon === item.weapon && local.activeSlot === definition.slot) {
        return { disabled: true, reason: 'Уже в руках' };
      }
    } else if (item.gear === 'kevlar') {
      if (local.armor >= 100) {
        return { disabled: true, reason: 'Броня уже надета' };
      }
    } else if (item.gear === 'kevlar_helmet') {
      if (local.armor >= 100 && local.helmet) {
        return { disabled: true, reason: 'Броня и шлем уже надеты' };
      }
    } else if (item.gear === 'defuse_kit' && local.defuseKit) {
      return { disabled: true, reason: 'Кит уже куплен' };
    }
    return { disabled: false, reason: '' };
  };

  const renderMoney = (money: number): void => {
    setText(moneyValue, formatMoney(money));
    setText(buyMoney, formatMoney(money));
    moneyValue.classList.toggle('is-low', money < 1_000);
  };

  const renderSettings = (): void => {
    settingSensitivity.value = String(settings.sensitivity);
    settingAwpSensitivity.value = String(settings.awpSensitivity);
    settingFov.value = String(settings.fov);
    settingMasterVolume.value = String(settings.masterVolume);
    settingEffectsVolume.value = String(settings.effectsVolume);
    settingToggleWalk.checked = settings.toggleWalk;
    settingToggleScope.checked = settings.toggleScope;
    settingRadarRotate.checked = settings.radarRotate;
    settingRadarScale.value = String(settings.radarScale);
    settingRadarZoom.value = String(settings.radarZoom);
    setText(settingSensitivityValue, `×${settings.sensitivity.toFixed(2)}`);
    setText(settingAwpSensitivityValue, `×${settings.awpSensitivity.toFixed(2)}`);
    setText(settingFovValue, `${settings.fov}°`);
    setText(settingMasterVolumeValue, `${Math.round(settings.masterVolume * 100)}%`);
    setText(settingEffectsVolumeValue, `${Math.round(settings.effectsVolume * 100)}%`);
    setText(settingRadarScaleValue, `${Math.round(settings.radarScale * 100)}%`);
    setText(settingRadarZoomValue, `${Math.round(settings.radarZoom * 100)}%`);
    radarContainer.style.transform = `scale(${settings.radarScale})`;
  };

  let currentCrosshair: CrosshairPreset = loadCrosshairPreset();

  const updateCrosshairOutputs = (): void => {
    setText(settingCrosshairLengthValue, `${settingCrosshairLength.value} px`);
    setText(settingCrosshairThicknessValue, `${settingCrosshairThickness.value} px`);
    setText(settingCrosshairGapValue, `${settingCrosshairGap.value} px`);
    setText(settingCrosshairDotSizeValue, `${settingCrosshairDotSize.value} px`);
    setText(
      settingCrosshairOpacityValue,
      `${Math.round(Number(settingCrosshairOpacity.value) * 100)}%`,
    );
  };

  const renderCrosshairSettings = (): void => {
    currentCrosshair = loadCrosshairPreset();
    settingCrosshairStyle.value = currentCrosshair.style;
    settingCrosshairColor.value = currentCrosshair.color;
    settingCrosshairLength.value = String(currentCrosshair.length);
    settingCrosshairThickness.value = String(currentCrosshair.thickness);
    settingCrosshairGap.value = String(currentCrosshair.gap);
    settingCrosshairDotSize.value = String(currentCrosshair.dotSize);
    settingCrosshairOpacity.value = String(currentCrosshair.opacity);
    updateCrosshairOutputs();
    applyVisualStyles(inGameCrosshairPreview, currentCrosshair);
    applyVisualStyles(hudCrosshair, currentCrosshair);
  };

  const readCrosshairSettings = (): void => {
    const draft = sanitizeCrosshairDraft({
      name: currentCrosshair.name,
      style: settingCrosshairStyle.value,
      color: settingCrosshairColor.value,
      length: Number(settingCrosshairLength.value),
      thickness: Number(settingCrosshairThickness.value),
      gap: Number(settingCrosshairGap.value),
      dotSize: Number(settingCrosshairDotSize.value),
      opacity: Number(settingCrosshairOpacity.value),
    });
    if (draft === null) {
      return;
    }
    currentCrosshair = {
      ...currentCrosshair,
      ...draft,
    };
    updateCrosshairOutputs();
    applyVisualStyles(inGameCrosshairPreview, currentCrosshair);
    applyVisualStyles(hudCrosshair, currentCrosshair);
    saveCrosshairPreset(currentCrosshair);
  };

  const readSettings = (): void => {
    settings = normalizeSettings({
      sensitivity: Number(settingSensitivity.value),
      awpSensitivity: Number(settingAwpSensitivity.value),
      fov: Number(settingFov.value),
      masterVolume: Number(settingMasterVolume.value),
      effectsVolume: Number(settingEffectsVolume.value),
      toggleWalk: settingToggleWalk.checked,
      toggleScope: settingToggleScope.checked,
      radarRotate: settingRadarRotate.checked,
      radarScale: Number(settingRadarScale.value),
      radarZoom: Number(settingRadarZoom.value),
    });
    saveSettings(settings);
    renderSettings();
    callbacks.onSettingsChange(settings);
  };

  const showSettings = (show: boolean): void => {
    setOverlayVisible(settingsOverlay, show);
    settingsOverlay.setAttribute('aria-hidden', String(!show));
    if (show) {
      renderSettings();
      renderCrosshairSettings();
    }
  };

  const percentage = (value: number, total: number): number =>
    total > 0 ? Math.round((value / total) * 100) : 0;

  const showAnnouncement = (
    text: string,
    sub: string,
    tone: 'neutral' | 'countdown' | 'live' | 'danger',
    duration: number,
  ): void => {
    setText(announcementText, text);
    setText(announcementSub, sub);
    announcement.classList.remove(
      'announcement--neutral',
      'announcement--countdown',
      'announcement--live',
      'announcement--danger',
    );
    announcement.classList.add(`announcement--${tone}`, 'is-visible');
    if (announcementTimer !== undefined) {
      window.clearTimeout(announcementTimer);
    }
    announcementTimer = schedule(() => {
      announcement.classList.remove('is-visible');
    }, duration);
  };

  const renderCs2TeamCards = (
    container: HTMLDivElement,
    players: PlayerSnapshot[],
    side: 'ct' | 't',
    snapshot: Snapshot,
  ): void => {
    container.replaceChildren();
    const localPlayer = snapshot.players.find((p) => p.id === localPlayerId);
    const isMyTeam = localPlayer !== undefined && localPlayer.side === side;

    for (const player of players) {
      const isTeammate = isMyTeam || player.id === localPlayerId;
      const card = createElement('div', `cs2-player-card cs2-player-card--${side}`);
      if (!player.alive) {
        card.classList.add('is-dead');
      }
      if (player.id === localPlayerId) {
        card.classList.add('is-you');
      }

      const avatar = createElement('div', 'cs2-player-card__avatar');
      if (!player.alive) {
        avatar.append(createElement('span', 'cs2-player-card__dead-icon', '✕'));
      } else {
        // Only show HP bar for teammates (or pure spectators); enemies never display their HP bar
        const showHp = isTeammate || localPlayer === undefined;
        if (showHp) {
          const hpBar = createElement('div', 'cs2-player-card__hp-bar');
          const hpFill = createElement('span', 'cs2-player-card__hp-fill');
          hpFill.style.height = `${clamp(player.health, 0, 100)}%`;
          if (player.health <= 25) {
            hpFill.classList.add('is-critical');
          } else if (player.health <= 50) {
            hpFill.classList.add('is-warning');
          }
          hpBar.append(hpFill);
          avatar.append(hpBar);
        }

        if (side === 'ct' && player.defuseKit && isTeammate) {
          const kitIcon = createElement('span', 'cs2-player-card__icon cs2-player-card__icon--kit', '✂');
          kitIcon.title = 'Набор сапёра';
          avatar.append(kitIcon);
        }
        if (side === 't' && snapshot.bomb?.carrierId === player.id && isTeammate) {
          const bombIcon = createElement('span', 'cs2-player-card__icon cs2-player-card__icon--bomb', '💣');
          bombIcon.title = 'Бомба C4';
          avatar.append(bombIcon);
        }
      }

      const nameSpan = createElement('span', 'cs2-player-card__name', player.name);
      avatar.append(nameSpan);
      card.append(avatar);

      // Detailed dropdown for TAB: ONLY for own team
      if (isTeammate) {
        const dropdown = createElement('div', 'cs2-player-card__dropdown');
        const moneyText = player.money !== undefined ? `$${player.money.toLocaleString()}` : '$0';
        dropdown.append(createElement('div', 'cs2-dropdown__money', moneyText));

        const weaponName = player.alive ? getWeapon(player.activeWeapon).name : '—';
        dropdown.append(createElement('div', 'cs2-dropdown__weapon', weaponName));

        const nadesDiv = createElement('div', 'cs2-dropdown__nades');
        if (player.alive && player.grenades) {
          for (const [type, count] of Object.entries(player.grenades)) {
            if (count && count > 0) {
              const shortName = type === 'he' ? 'HE' : type === 'flash' ? 'FB' : 'SG';
              const badge = createElement(
                'span',
                `cs2-nade-tag cs2-nade-tag--${type}`,
                count > 1 ? `${shortName}×${count}` : shortName,
              );
              nadesDiv.append(badge);
            }
          }
        }
        dropdown.append(nadesDiv);

        const equipDiv = createElement('div', 'cs2-dropdown__equip');
        if (player.alive) {
          if (player.armor > 0) {
            equipDiv.append(createElement('span', 'cs2-equip-badge', player.helmet ? '🛡️+H' : '🛡️'));
          }
          if (player.defuseKit) {
            equipDiv.append(createElement('span', 'cs2-equip-badge cs2-equip-badge--kit', '🔧KIT'));
          }
        }
        dropdown.append(equipDiv);

        card.append(dropdown);
      }

      container.append(card);
    }
  };

  const updateScores = (snapshot: Snapshot): void => {
    const alpha = snapshot.match.scores.alpha;
    const bravo = snapshot.match.scores.bravo;
    setText(scoreAlpha, String(alpha));
    setText(scoreBravo, String(bravo));
    const buyMode = snapshot.match.mode === 'buy';
    const limit = buyMode
      ? Math.max(1, snapshot.match.roundsToWin)
      : Math.max(1, snapshot.match.fragLimit);
    barAlpha.style.width = `${clamp((alpha / limit) * 100, 0, 100)}%`;
    barBravo.style.width = `${clamp((bravo / limit) * 100, 0, 100)}%`;
    teamAlpha.classList.toggle('is-leading', alpha > bravo);
    teamBravo.classList.toggle('is-leading', bravo > alpha);
    setText(
      hudFragLimit,
      buyMode
        ? `ДО ${snapshot.match.roundsToWin} ПОБЕД · РАУНД ${snapshot.match.round}`
        : `РАУНД ${snapshot.match.round} / ${snapshot.match.fragLimit}`,
    );

    const ctTeam = sideForTeam('alpha') === 'ct' ? 'alpha' : 'bravo';
    const tTeam = ctTeam === 'alpha' ? 'bravo' : 'alpha';
    const ctScore = snapshot.match.scores[ctTeam] ?? 0;
    const tScore = snapshot.match.scores[tTeam] ?? 0;
    setText(scoreCt, String(ctScore));
    setText(scoreT, String(tScore));

    renderCs2TeamCards(cs2PlayersCt, snapshot.players.filter((p) => p.side === 'ct'), 'ct', snapshot);
    renderCs2TeamCards(cs2PlayersT, snapshot.players.filter((p) => p.side === 't'), 't', snapshot);
  };

  const updateLocal = (snapshot: Snapshot): void => {
    const player = snapshot.players.find((candidate) => candidate.id === localPlayerId);
    if (player === undefined) {
      setOverlayVisible(deathOverlay, false);
      return;
    }
    // While spectating a teammate the vitals/weapon block shows their state,
    // like CS2. Money and side colours always belong to the local player.
    const spectatedId = spectatorState?.targetId ?? null;
    const spectated =
      spectatedId === null
        ? undefined
        : snapshot.players.find((candidate) => candidate.id === spectatedId);
    const shown = spectated !== undefined && spectated.alive ? spectated : player;

    setText(healthValue, String(Math.round(shown.health)));
    healthFill.style.width = `${clamp(shown.health, 0, 100)}%`;
    healthFill.classList.toggle('is-low', shown.health <= 30);
    setText(armorValue, String(Math.round(shown.armor)));
    armorFill.style.width = `${clamp(shown.armor, 0, 100)}%`;
    setText(
      armorExtra,
      `${shown.helmet ? 'ШЛЕМ' : ''}${shown.helmet && shown.defuseKit ? ' · ' : ''}${shown.defuseKit ? 'КИТ' : ''}`,
    );
    renderMoney(player.money);

    const definition = getWeapon(shown.activeWeapon);
    setText(weaponName, definition.name);
    if (shown.activeWeapon === 'knife') {
      setText(ammoValue, '∞');
      setText(ammoReserve, '');
    } else {
      setText(ammoValue, String(shown.ammo));
      setText(ammoReserve, `/ ${shown.reserve}`);
    }
    ammoValue.classList.toggle('is-empty', shown.activeWeapon !== 'knife' && shown.ammo === 0);

    const owningTeams: Team[] = ['alpha', 'bravo'];
    for (const team of owningTeams) {
      const side = sideForTeam(team);
      setText(team === 'alpha' ? labelAlpha : labelBravo, SIDE_LABEL[side]);
    }

    slotPrimary.classList.toggle('is-active', shown.activeSlot === 'primary');
    slotSecondary.classList.toggle('is-active', shown.activeSlot === 'secondary');
    slotKnife.classList.toggle('is-active', shown.activeSlot === 'knife');
    slotGrenade.classList.toggle('is-active', shown.activeSlot === 'grenade');
    const activeGrenade =
      definition.slot === 'grenade' ? GRENADE_LABEL[shown.activeWeapon as GrenadeType] : 'ГРАНАТЫ';
    setText(grenadeSlotLabel, activeGrenade);

    grenadeStrip.replaceChildren();
    for (const [type, count] of Object.entries(shown.grenades) as Array<[GrenadeType, number]>) {
      if (count > 0) {
        grenadeStrip.append(
          createElement('span', 'grenade-chip', `${GRENADE_LABEL[type]} ×${count}`),
        );
      }
    }
    grenadeStrip.classList.toggle('is-empty', grenadeStrip.children.length === 0);
    document.body.classList.toggle('is-t', player.side === 't');
    document.body.classList.toggle('is-ct', player.side === 'ct');

    teamAlpha.dataset.side = sideForTeam('alpha');
    teamBravo.dataset.side = sideForTeam('bravo');
    teamAlpha.classList.toggle('is-you', player.team === 'alpha');
    teamBravo.classList.toggle('is-you', player.team === 'bravo');

    const dead =
      !player.alive && (snapshot.match.phase === 'live' || snapshot.match.phase === 'round_over');
    // Economy rounds have no respawn: the spectator bar replaces the timer card.
    setOverlayVisible(deathOverlay, dead && !isEconomyMode(snapshot.match.mode));
    if (dead) {
      setText(deathSub, 'Возрождение через');
    }

    updateBombHud(snapshot, player);
  };

  const updateBombHud = (snapshot: Snapshot, player: PlayerSnapshot): void => {
    const bomb = snapshot.bomb ?? null;
    const economy = isEconomyMode(snapshot.match.mode);
    bombVital.classList.toggle('is-visible', economy && bomb !== null);
    if (!economy || bomb === null) {
      bombAction.classList.remove('is-visible', 'is-danger', 'is-defuse');
      matchClock.classList.remove('is-bomb-planted');
      return;
    }

    const site =
      currentMap !== null && player.alive ? findBombSiteAt(currentMap, player.position) : null;
    if (bomb.state === 'planted') {
      setText(bombStatusValue, player.side === 't' ? `САЙТ ${bomb.siteId ?? 'A'}` : 'УСТАНОВЛЕНА');
      bombVital.dataset.state = 'planted';
    } else if (bomb.state === 'carried' && bomb.carrierId === player.id) {
      setText(bombStatusValue, site !== null ? `C4 · САЙТ ${site.id}` : 'У ВАС C4');
      bombVital.dataset.state = 'carried';
    } else if (bomb.state === 'dropped') {
      setText(bombStatusValue, 'C4 НА ЗЕМЛЕ');
      bombVital.dataset.state = 'dropped';
    } else if (player.side === 'ct' && player.defuseKit) {
      setText(bombStatusValue, 'КИТ · 4 С');
      bombVital.dataset.state = 'kit';
    } else {
      setText(bombStatusValue, 'САЙТЫ A/B');
      bombVital.dataset.state = 'idle';
    }

    if (snapshot.match.phase !== 'live' || !player.alive) {
      bombAction.classList.remove('is-visible', 'is-danger', 'is-defuse');
      return;
    }

    if (bomb.planterId === player.id && bomb.plantProgress > 0) {
      setText(
        bombActionLabel,
        `УСТАНОВКА БОМБЫ · САЙТ ${bomb.siteId ?? site?.id ?? 'A'} (${Math.round(bomb.plantProgress * 100)}%)`,
      );
      bombActionFill.style.width = `${clamp(bomb.plantProgress * 100, 0, 100)}%`;
      bombActionBar.classList.add('is-visible');
      bombAction.classList.remove('is-defuse');
      bombAction.classList.add('is-visible', 'is-danger');
      return;
    }

    if (bomb.defuserId === player.id && bomb.defuseProgress > 0) {
      setText(
        bombActionLabel,
        `РАЗМИНИРОВАНИЕ C4${bomb.defuseHasKit ? ' · КИТ' : ''} (${Math.round(bomb.defuseProgress * 100)}%)`,
      );
      bombActionFill.style.width = `${clamp(bomb.defuseProgress * 100, 0, 100)}%`;
      bombActionBar.classList.add('is-visible');
      bombAction.classList.remove('is-danger');
      bombAction.classList.add('is-visible', 'is-defuse');
      return;
    }

    if (
      player.side === 't' &&
      bomb.state === 'carried' &&
      bomb.carrierId === player.id &&
      site !== null
    ) {
      setText(bombActionLabel, `УДЕРЖИВАЙТЕ [E] — УСТАНОВИТЬ C4 (САЙТ ${site.id})`);
      bombActionFill.style.width = '0%';
      bombActionBar.classList.remove('is-visible');
      bombAction.classList.remove('is-defuse');
      bombAction.classList.add('is-visible', 'is-danger');
      return;
    }

    if (
      player.side === 'ct' &&
      bomb.state === 'planted' &&
      bomb.position !== null &&
      distance(player.position, bomb.position) <= BOMB.defuseRadius &&
      Math.abs(player.position.y - bomb.position.y) <= 1.5
    ) {
      setText(
        bombActionLabel,
        `УДЕРЖИВАЙТЕ [E] — РАЗМИНИРОВАТЬ C4 (${player.defuseKit ? '4 С С КИТОМ' : '8 С БЕЗ КИТА'})`,
      );
      bombActionFill.style.width = '0%';
      bombActionBar.classList.remove('is-visible');
      bombAction.classList.remove('is-danger');
      bombAction.classList.add('is-visible', 'is-defuse');
      return;
    }

    bombAction.classList.remove('is-visible', 'is-danger', 'is-defuse');
  };

  const updatePhase = (phase: MatchPhase): void => {
    const bomb = latestSnapshot?.bomb ?? null;
    const localSide =
      latestSnapshot?.players.find((candidate) => candidate.id === localPlayerId)?.side ?? null;
    if (phase === 'live' && bomb?.state === 'planted') {
      setText(
        hudPhase,
        localSide === 't' ? `БОМБА · САЙТ ${bomb.siteId ?? 'A'}` : 'БОМБА УСТАНОВЛЕНА',
      );
      hudPhase.dataset.phase = 'bomb';
      matchClock.classList.add('is-bomb-planted');
      return;
    }
    matchClock.classList.remove('is-bomb-planted');
    setText(hudPhase, PHASE_LABEL[phase]);
    hudPhase.dataset.phase = phase;
  };

  const updateTimer = (serverNow: number): void => {
    if (latestSnapshot === null) {
      return;
    }
    const match = latestSnapshot.match;
    const bomb = latestSnapshot.bomb ?? null;
    if (match.phase === 'live' && bomb?.state === 'planted') {
      setText(hudTime, 'C4');
      setText(scoreboardTime, 'C4');
      hudTime.classList.add('is-low');
      if (buyOpen) {
        const buyRemaining =
          match.buyEndsAt === null ? 0 : Math.max(0, match.buyEndsAt - serverNow);
        setText(buyTimer, match.buyEndsAt === null ? '—' : formatTime(buyRemaining));
      }
      return;
    }
    let remaining = match.timeRemainingMs;
    if (match.phase === 'live') {
      if (isEconomyMode(match.mode) && match.roundEndsAt !== null) {
        remaining = match.roundEndsAt - serverNow;
      } else if (match.matchEndsAt !== null) {
        remaining = match.matchEndsAt - serverNow;
      }
    } else if (match.phase === 'countdown' && match.countdownEndsAt !== null) {
      remaining = match.countdownEndsAt - serverNow;
    } else if (match.phase === 'round_over' && match.roundOverEndsAt !== null) {
      remaining = match.roundOverEndsAt - serverNow;
    }
    const text = formatTime(remaining);
    setText(hudTime, text);
    setText(scoreboardTime, text);
    hudTime.classList.toggle('is-low', match.phase === 'live' && remaining <= 30_000);
    if (buyOpen) {
      const buyRemaining = match.buyEndsAt === null ? 0 : Math.max(0, match.buyEndsAt - serverNow);
      setText(buyTimer, match.buyEndsAt === null ? '—' : formatTime(buyRemaining));
    }
  };

  const updateDeathTimer = (serverNow: number): void => {
    if (latestSnapshot === null || localPlayerId === null) {
      return;
    }
    const player = latestSnapshot.players.find((candidate) => candidate.id === localPlayerId);
    if (player === undefined || player.alive || player.respawnAt === null) {
      return;
    }
    const remaining = Math.max(0, player.respawnAt - serverNow);
    setText(deathTimer, String(Math.ceil(remaining / 1000)));
  };

  const updateReloadBar = (serverNow: number): void => {
    if (latestSnapshot === null || localPlayerId === null) {
      reloadBar.classList.remove('is-visible');
      return;
    }
    const player = latestSnapshot.players.find((candidate) => candidate.id === localPlayerId);
    if (
      player === undefined ||
      player.reloadingUntil === null ||
      player.reloadingUntil <= serverNow
    ) {
      reloadBar.classList.remove('is-visible');
      return;
    }
    const definition = getWeapon(player.activeWeapon);
    const duration = Math.max(1, definition.reloadMs);
    const progress = clamp(1 - (player.reloadingUntil - serverNow) / duration, 0, 1);
    reloadFill.style.width = `${progress * 100}%`;
    reloadBar.classList.add('is-visible');
  };

  const updatePauseTimer = (serverNow: number): void => {
    if (
      latestLobby === null ||
      latestLobby.phase !== 'paused' ||
      latestLobby.pauseDeadline === null
    ) {
      return;
    }
    const remaining = Math.max(0, latestLobby.pauseDeadline - serverNow);
    setText(
      lobbyTimer,
      remaining > 0
        ? `Соперник вернётся через ${Math.ceil(remaining / 1000)} с`
        : 'Соперник не вернулся — завершаем матч',
    );
  };

  const renderLobbyPlayers = (state: LobbyState): void => {
    slotsAlpha.replaceChildren();
    slotsBravo.replaceChildren();

    const maxPerTeam = state.maxPlayers ? Math.floor(state.maxPlayers / 2) : 1;
    const is2v2 = state.roomMode === '2v2';

    setText(lobbyModeTag, is2v2 ? '2 VS 2' : '1 VS 1');

    const alphaPlayers = state.players.filter((p) => p.team === 'alpha');
    const bravoPlayers = state.players.filter((p) => p.team === 'bravo');

    const localPlayer = state.players.find((p) => p.id === localPlayerId);

    // Update Team switch buttons
    if (localPlayer) {
      joinTeamAlphaBtn.disabled = localPlayer.team === 'alpha' || alphaPlayers.length >= maxPerTeam;
      joinTeamBravoBtn.disabled = localPlayer.team === 'bravo' || bravoPlayers.length >= maxPerTeam;

      if (is2v2) {
        lobbyReadyBtn.style.display = '';
        if (localPlayer.ready) {
          setText(lobbyReadyBtn, 'НЕ ГОТОВ (ОТМЕНА)');
          lobbyReadyBtn.classList.add('is-ready');
          lobbyReadyBtn.classList.remove('button--primary');
          lobbyReadyBtn.classList.add('button--secondary');
        } else {
          setText(lobbyReadyBtn, 'ГОТОВ К ИГРЕ');
          lobbyReadyBtn.classList.remove('is-ready');
          lobbyReadyBtn.classList.remove('button--secondary');
          lobbyReadyBtn.classList.add('button--primary');
        }
      } else {
        lobbyReadyBtn.style.display = 'none';
      }
    } else {
      joinTeamAlphaBtn.disabled = alphaPlayers.length >= maxPerTeam;
      joinTeamBravoBtn.disabled = bravoPlayers.length >= maxPerTeam;
      lobbyReadyBtn.style.display = is2v2 ? '' : 'none';
    }

    const renderTeamSlots = (container: HTMLElement, team: Team, teamPlayers: typeof state.players) => {
      for (let i = 0; i < maxPerTeam; i++) {
        const player = teamPlayers[i];
        const slotEl = createElement('div', `lobby-slot lobby-slot--${team}`);
        if (!player) {
          slotEl.classList.add('lobby-slot--empty');
          slotEl.append(
            createElement('span', 'lobby-slot__empty-icon', '👤'),
            createElement('strong', 'lobby-slot__empty-text', 'Свободный слот'),
            createElement('span', 'lobby-slot__empty-hint', 'Ожидание игрока'),
          );
        } else {
          const isLocal = player.id === localPlayerId;
          if (isLocal) {
            slotEl.classList.add('is-local');
          }
          const infoEl = createElement('div', 'lobby-slot__info');
          const nameRow = createElement('div', 'lobby-slot__name-row');
          nameRow.append(createElement('strong', 'lobby-slot__name', player.name));
          if (isLocal) {
            nameRow.append(createElement('span', 'lobby-slot__you', 'ВЫ'));
          }
          infoEl.append(nameRow);

          const statusRow = createElement('div', 'lobby-slot__status-row');
          statusRow.append(
            createElement(
              'span',
              `lobby-slot__conn ${player.connected ? 'is-online' : 'is-offline'}`,
              player.connected ? 'В сети' : 'Связь потеряна',
            ),
          );

          if (is2v2) {
            statusRow.append(
              createElement(
                'span',
                `lobby-slot__ready-badge ${player.ready ? 'is-ready' : 'is-not-ready'}`,
                player.ready ? 'ГОТОВ ✓' : 'НЕ ГОТОВ',
              ),
            );
          }
          infoEl.append(statusRow);
          slotEl.append(infoEl);
        }
        container.append(slotEl);
      }
    };

    renderTeamSlots(slotsAlpha, 'alpha', alphaPlayers);
    renderTeamSlots(slotsBravo, 'bravo', bravoPlayers);
  };

  const updateVotes = (): void => {
    if (resultsEvent === null) {
      return;
    }
    const votes =
      latestLobby !== null && latestLobby.phase === 'ended'
        ? latestLobby.players.filter((player) => player.rematchVote).map((player) => player.id)
        : (latestSnapshot?.match.rematchVotes ?? []);
    setText(resultsVotes, `Голоса за реванш: ${votes.length} / 2`);
    const voted = localPlayerId !== null && votes.includes(localPlayerId);
    rematchButton.disabled = voted;
    setText(rematchButton, voted ? 'ГОЛОС УЧТЁН' : 'РЕВАНШ');
  };

  const renderScoreboard = (): void => {
    if (latestSnapshot === null) {
      scoreboardBody.replaceChildren();
      return;
    }
    scoreboardBody.replaceChildren();
    const statsFor = (playerId: string): RoundSummaryEvent['players'][number] | null =>
      latestRoundSummary?.players.find((player) => player.playerId === playerId) ?? null;
    const ctTeam = sideForTeam('alpha') === 'ct' ? 'alpha' : 'bravo';
    const tTeam = ctTeam === 'alpha' ? 'bravo' : 'alpha';
    const teams: Team[] = [ctTeam, tTeam];
    for (const team of teams) {
      const side = sideForTeam(team);
      const column = createElement('div', `scoreboard-team scoreboard-team--${side}`);
      const head = createElement('div', 'scoreboard-team__head');
      head.append(
        createElement(
          'span',
          'scoreboard-team__label',
          side === 'ct' ? 'COUNTER-TERRORISTS (CT)' : 'TERRORISTS (T)',
        ),
        createElement(
          'strong',
          'scoreboard-team__score',
          String(latestSnapshot.match.scores[team]),
        ),
      );
      column.append(head);

      const columns = createElement('div', 'scoreboard-team__columns');
      for (const label of ['ИГРОК', 'K', 'D', 'DMG', 'HS%', 'ACC']) {
        columns.append(createElement('span', 'scoreboard-team__column', label));
      }
      column.append(columns);

      const players = latestSnapshot.players.filter((player) => player.team === team);
      if (players.length === 0) {
        column.append(createElement('div', 'scoreboard-row scoreboard-row--empty', 'Нет игрока'));
      }
      for (const player of players) {
        const stats = statsFor(player.id);
        const row = createElement('div', 'scoreboard-row');
        const identity = createElement('div', 'scoreboard-row__identity');
        identity.append(
          createElement('span', 'scoreboard-row__name', player.name),
          createElement(
            'span',
            `scoreboard-row__status ${player.connected ? 'is-online' : 'is-offline'}`,
            `${SIDE_LABEL[player.side]} · ${player.connected ? 'В СЕТИ' : 'ПАУЗА'}`,
          ),
        );
        if (player.id === localPlayerId) {
          identity.append(createElement('span', 'scoreboard-row__you', 'ВЫ'));
        }
        row.append(
          identity,
          createElement('span', 'scoreboard-row__stat', String(player.kills)),
          createElement(
            'span',
            'scoreboard-row__stat scoreboard-row__stat--muted',
            String(player.deaths),
          ),
          createElement('span', 'scoreboard-row__stat', String(stats?.matchDamage ?? 0)),
          createElement(
            'span',
            'scoreboard-row__stat',
            `${percentage(stats?.matchHeadshotKills ?? 0, stats?.kills ?? player.kills)}%`,
          ),
          createElement(
            'span',
            'scoreboard-row__stat',
            `${percentage(stats?.matchHits ?? 0, stats?.matchShots ?? 0)}%`,
          ),
        );
        column.append(row);
      }
      scoreboardBody.append(column);
    }
  };

  const updateHudStatus = (): void => {
    setText(hudStatus, connected ? 'В СЕТИ' : 'НЕТ СВЯЗИ');
    hudStatusDot.classList.toggle('status-dot--online', connected);
    hudStatusDot.classList.toggle('status-dot--offline', !connected);
    setText(startStatus, connected ? 'СЕРВЕР ДОСТУПЕН' : 'НЕТ СВЯЗИ С СЕРВЕРОМ');
    startStatusDot.classList.toggle('status-dot--online', connected);
    startStatusDot.classList.toggle('status-dot--offline', !connected);
    joinButton.disabled = !connected || joinBusy;
  };

  joinForm.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!connected || joinBusy) {
      return;
    }
    const name = nameInput.value.trim();
    if (name.length === 0) {
      setText(joinError, 'Введите позывной');
      nameInput.focus();
      return;
    }
    setText(joinError, '');
    callbacks.onJoin(name);
  });

  const validateName = (): string | null => {
    const name = nameInput.value.trim();
    if (name.length === 0) {
      setText(joinError, 'Введите позывной');
      nameInput.focus();
      return null;
    }
    setText(joinError, '');
    return name;
  };

  openRoomsButton.addEventListener('click', () => {
    const name = validateName();
    if (name === null) {
      return;
    }
    setOverlayVisible(roomsOverlay, true);
    setOverlayVisible(createRoomOverlay, false);
    callbacks.onRefreshRooms();
  });

  openCreateRoomButton.addEventListener('click', () => {
    const name = validateName();
    if (name === null) {
      return;
    }
    setOverlayVisible(createRoomOverlay, true);
    setOverlayVisible(roomsOverlay, false);
    createRoomNameInput.focus();
  });

  roomsCreateBtn.addEventListener('click', () => {
    setOverlayVisible(roomsOverlay, false);
    setOverlayVisible(createRoomOverlay, true);
    createRoomNameInput.focus();
  });

  roomsRefreshBtn.addEventListener('click', () => {
    callbacks.onRefreshRooms();
  });

  roomsCloseBtn.addEventListener('click', () => {
    setOverlayVisible(roomsOverlay, false);
  });

  mapCardsGrid.addEventListener('change', () => {
    for (const label of mapCardsGrid.querySelectorAll('.map-radio-card')) {
      const radio = label.querySelector<HTMLInputElement>('input[type="radio"]');
      label.classList.toggle('is-selected', radio?.checked === true);
    }
  });

  modeCardsGrid.addEventListener('change', () => {
    for (const label of modeCardsGrid.querySelectorAll('.mode-radio-card')) {
      const radio = label.querySelector<HTMLInputElement>('input[type="radio"]');
      label.classList.toggle('is-selected', radio?.checked === true);
    }
  });

  createRoomCancelBtn.addEventListener('click', () => {
    setOverlayVisible(createRoomOverlay, false);
  });

  createRoomForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const name = validateName();
    if (name === null) {
      setOverlayVisible(createRoomOverlay, false);
      return;
    }
    const selectedMode = modeCardsGrid.querySelector<HTMLInputElement>(
      'input[name="create-room-mode"]:checked',
    );
    const roomMode: RoomGameMode = selectedMode?.value === '2v2' ? '2v2' : '1v1';
    const roomName = createRoomNameInput.value.trim() || `Матч ${roomMode}`;
    setText(createRoomError, '');
    const selectedRadio = mapCardsGrid.querySelector<HTMLInputElement>(
      'input[name="create-map-id"]:checked',
    );
    const mapId = selectedRadio?.value ?? 'de_dust2';
    callbacks.onCreateRoom(roomName, mapId, roomMode, name);
  });

  joinTeamAlphaBtn.addEventListener('click', () => {
    callbacks.onChooseTeam?.('alpha');
  });

  joinTeamBravoBtn.addEventListener('click', () => {
    callbacks.onChooseTeam?.('bravo');
  });

  lobbyReadyBtn.addEventListener('click', () => {
    const local = latestLobby?.players.find((p) => p.id === localPlayerId);
    const nextReady = local ? !local.ready : true;
    callbacks.onSetReady?.(nextReady);
  });

  lobbyLeaveButton.addEventListener('click', () => {
    callbacks.onLeave();
  });

  const renderRooms = (rooms: RoomSummary[]): void => {
    roomsList.replaceChildren();
    if (rooms.length === 0) {
      const empty = createElement(
        'div',
        'rooms-empty',
        'Нет активных комнат. Нажмите «+ СОЗДАТЬ ИГРУ», чтобы открыть первую сессию!',
      );
      roomsList.appendChild(empty);
      return;
    }

    for (const room of rooms) {
      const card = createElement('div', 'room-card');
      const info = createElement('div', 'room-card__info');
      const titleRow = createElement('div', 'room-card__title-row');
      titleRow.appendChild(createElement('strong', 'room-card__name', room.name));
      titleRow.appendChild(
        createElement(
          'span',
          `room-card__mode-tag mode-tag--${room.roomMode ?? '1v1'}`,
          room.roomMode === '2v2' ? '2 VS 2' : '1 VS 1',
        ),
      );
      titleRow.appendChild(
        createElement(
          'span',
          `room-card__badge badge--${room.mode}`,
          room.mode === 'buy' ? 'ЭКОНОМИКА · C4' : 'АРЕНА',
        ),
      );
      info.appendChild(titleRow);

      const metaRow = createElement('div', 'room-card__meta');
      metaRow.appendChild(createElement('span', 'room-card__map', `Карта: ${room.mapName}`));
      const isFull = room.playerCount >= room.maxPlayers;
      metaRow.appendChild(
        createElement(
          'span',
          `room-card__status ${isFull ? 'is-full' : 'is-waiting'}`,
          isFull ? 'Матч заполнен' : 'Ожидание игроков',
        ),
      );
      info.appendChild(metaRow);
      card.appendChild(info);

      const actions = createElement('div', 'room-card__actions');
      actions.appendChild(
        createElement(
          'span',
          `room-card__count ${isFull ? 'is-full' : ''}`,
          `${room.playerCount} / ${room.maxPlayers}`,
        ),
      );

      const joinBtn = createElement(
        'button',
        `button ${isFull ? 'button--ghost' : 'button--primary'} button--small`,
        isFull ? 'ЗАНЯТО' : 'ВОЙТИ',
      );
      joinBtn.disabled = isFull || joinBusy || !connected;
      joinBtn.addEventListener('click', () => {
        const name = validateName();
        if (name === null) {
          setOverlayVisible(roomsOverlay, false);
          return;
        }
        setOverlayVisible(roomsOverlay, false);
        callbacks.onJoin(name, room.id);
      });
      actions.appendChild(joinBtn);
      card.appendChild(actions);

      roomsList.appendChild(card);
    }
  };

  buyClose.addEventListener('click', () => callbacks.onCloseBuy());
  buyGrid.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    const button = target.closest<HTMLButtonElement>('[data-buy-action][data-item-id]');
    if (button === null || button.disabled) {
      return;
    }
    const itemId = button.dataset.itemId;
    if (itemId === undefined) {
      return;
    }
    if (button.dataset.buyAction === 'refund') {
      callbacks.onRefund(itemId);
    } else {
      callbacks.onBuy(itemId);
    }
  });

  resumeButton.addEventListener('click', () => callbacks.onResume());
  leaveButton.addEventListener('click', () => callbacks.onLeave());
  leaveResults.addEventListener('click', () => callbacks.onLeave());
  rematchButton.addEventListener('click', () => {
    rematchButton.disabled = true;
    setText(rematchButton, 'ГОЛОС УЧТЁН');
    callbacks.onRematch();
  });
  settingsButton.addEventListener('click', () => showSettings(true));
  pauseSettingsButton.addEventListener('click', () => showSettings(true));
  settingsClose.addEventListener('click', () => showSettings(false));
  settingsReset.addEventListener('click', () => {
    settings = { ...DEFAULT_SETTINGS };
    saveSettings(settings);
    renderSettings();
    callbacks.onSettingsChange(settings);

    currentCrosshair = { ...DEFAULT_CROSSHAIR };
    saveCrosshairPreset(currentCrosshair);
    renderCrosshairSettings();
  });
  for (const input of [
    settingSensitivity,
    settingAwpSensitivity,
    settingFov,
    settingMasterVolume,
    settingEffectsVolume,
    settingToggleWalk,
    settingToggleScope,
    settingRadarRotate,
    settingRadarScale,
    settingRadarZoom,
  ]) {
    input.addEventListener('input', readSettings);
    input.addEventListener('change', readSettings);
  }
  for (const input of [
    settingCrosshairStyle,
    settingCrosshairColor,
    settingCrosshairLength,
    settingCrosshairThickness,
    settingCrosshairGap,
    settingCrosshairDotSize,
    settingCrosshairOpacity,
  ]) {
    input.addEventListener('input', readCrosshairSettings);
    input.addEventListener('change', readCrosshairSettings);
  }
  renderSettings();
  renderCrosshairSettings();

  copyLinkButton.addEventListener('click', () => {
    const clipboard = navigator.clipboard;
    if (clipboard === undefined) {
      setText(copyLinkButton, 'НЕДОСТУПНО');
      schedule(() => setText(copyLinkButton, 'СКОПИРОВАТЬ ССЫЛКУ'), 2000);
      return;
    }
    void clipboard
      .writeText(window.location.href)
      .then(() => {
        setText(copyLinkButton, 'ССЫЛКА СКОПИРОВАНА');
        schedule(() => setText(copyLinkButton, 'СКОПИРОВАТЬ ССЫЛКУ'), 2000);
      })
      .catch(() => {
        setText(copyLinkButton, 'НЕ УДАЛОСЬ');
        schedule(() => setText(copyLinkButton, 'СКОПИРОВАТЬ ССЫЛКУ'), 2000);
      });
  });

  const hideBombAlert = (): void => {
    bombAlert.classList.remove('is-visible');
    if (bombAlertTimer !== undefined) {
      window.clearTimeout(bombAlertTimer);
      bombAlertTimer = undefined;
    }
  };

  const hideRoundBanner = (): void => {
    roundBanner.classList.remove('is-visible', 'round-banner--win', 'round-banner--loss');
  };

  const setBuyOpen = (show: boolean): void => {
    buyOpen = show;
    setOverlayVisible(buyOverlay, show);
    buyOverlay.setAttribute('aria-hidden', String(!show));
    if (show) {
      if (latestSnapshot !== null) {
        updateBuyState(latestSnapshot, localPlayerId, lastBuyInZone);
      }
    }
  };

  const updateBuyState = (
    snapshot: Snapshot,
    playerId: string | null,
    inBuyZone: boolean,
  ): void => {
    const local = snapshot.players.find((player) => player.id === playerId);
    if (local === undefined) {
      return;
    }
    lastBuyInZone = inBuyZone;
    if (buySide !== local.side) {
      buySide = local.side;
      renderBuyGrid(local.side);
    }
    setText(buySideLabel, SIDE_LABEL[local.side]);
    renderMoney(local.money);

    const buyRemaining =
      snapshot.match.buyEndsAt === null
        ? 0
        : Math.max(0, snapshot.match.buyEndsAt - snapshot.serverTime);
    const canBuy =
      (snapshot.match.phase === 'live' || snapshot.match.phase === 'countdown') &&
      local.alive &&
      inBuyZone &&
      snapshot.match.buyEndsAt !== null &&
      buyRemaining > 0;

    for (const item of BUY_ITEMS) {
      const controls = buyButtons.get(item.id);
      if (controls === undefined) {
        continue;
      }
      const price = getBuyPrice(item, local.armor, local.helmet);
      setText(controls.price, formatMoney(price));
      const availability = itemAvailability(item, local, canBuy);
      controls.buy.disabled = availability.disabled;
      controls.buy.title = availability.reason;
      controls.card.classList.toggle('is-disabled', availability.disabled);
      controls.card.classList.toggle('is-available', !availability.disabled);
      const canRefund = canBuy && local.lastPurchaseId === item.id;
      controls.refund.disabled = !canRefund;
      controls.refund.classList.toggle('is-visible', canRefund);
      controls.card.classList.toggle('is-last-purchase', local.lastPurchaseId === item.id);
    }

    if (!local.alive) {
      setText(buyStatus, 'Мёртвые не могут закупаться. Ждите следующий раунд.');
    } else if (snapshot.match.phase !== 'live' && snapshot.match.phase !== 'countdown') {
      setText(buyStatus, 'Закупка доступна только во время подготовки и начала раунда.');
    } else if (!inBuyZone) {
      setText(buyStatus, 'Вернитесь на базу, чтобы открыть закупку.');
    } else if (snapshot.match.buyEndsAt === null || buyRemaining <= 0) {
      setText(buyStatus, 'Время закупки истекло.');
    } else {
      setText(buyStatus, 'Кликните по предмету, чтобы купить. Возврат — только последней покупки.');
    }
  };

  return {
    showStart: (prefillName, error) => {
      if (disposed) {
        return;
      }
      crosshairEditor.close();
      setBuyOpen(false);
      setOverlayVisible(startOverlay, true);
      setOverlayVisible(lobbyOverlay, false);
      setOverlayVisible(pauseOverlay, false);
      setOverlayVisible(deathOverlay, false);
      setOverlayVisible(resultsOverlay, false);
      setOverlayVisible(scoreboardOverlay, false);
      setOverlayVisible(settingsOverlay, false);
      setOverlayVisible(roomsOverlay, false);
      setOverlayVisible(createRoomOverlay, false);
      settingsOverlay.setAttribute('aria-hidden', 'true');
      hideRoundBanner();
      latestRoundSummary = null;
      setText(joinError, error ?? '');
      nameInput.value = prefillName;
      nameInput.disabled = joinBusy;
      if (document.activeElement !== nameInput) {
        nameInput.focus();
        nameInput.select();
      }
      updateHudStatus();
    },
    hideStart: () => {
      setOverlayVisible(startOverlay, false);
      setOverlayVisible(roomsOverlay, false);
      setOverlayVisible(createRoomOverlay, false);
    },
    setJoinBusy: (busy) => {
      joinBusy = busy;
      setText(joinButton, busy ? 'ВХОД...' : 'В БОЙ');
      joinButton.disabled = !connected || busy;
      openRoomsButton.disabled = !connected || busy;
      openCreateRoomButton.disabled = !connected || busy;
      nameInput.disabled = busy;
    },
    setRooms: (rooms) => {
      renderRooms(rooms);
    },
    showRooms: (show) => {
      setOverlayVisible(roomsOverlay, show);
      if (show) {
        setOverlayVisible(createRoomOverlay, false);
      }
    },
    showCreateRoom: (show) => {
      setOverlayVisible(createRoomOverlay, show);
      if (show) {
        setOverlayVisible(roomsOverlay, false);
      }
    },
    setConnection: (isConnected, pingMs) => {
      connected = isConnected;
      networkPing = pingMs;
      renderNetwork();
      updateHudStatus();
    },
    setNetwork: (pingMs, jitterMs, lossPercent) => {
      networkPing = pingMs;
      networkJitter = jitterMs;
      networkLoss = lossPercent;
      renderNetwork();
    },
    setReconnecting: (show, text) => {
      setOverlayVisible(connectionBanner, show);
      if (text !== undefined) {
        setText(connectionText, text);
      }
    },
    setProtocolInfo: (text) => {
      setText(startProtocol, text.toUpperCase());
    },
    setMapInfo: (map) => {
      currentMap = map;
      const label = map.name.toUpperCase();
      setText(startMapName, label);
      setText(mapCardName, label);
      setText(lobbyMapName, label);
      setText(resultsMapName, label);
      setText(scoreboardMapName, label);
      setText(mapCardSize, `${map.size} × ${map.sizeZ}`);
      setText(mapBaseAlpha, map.mode === 'buy' ? 'T' : 'ALPHA');
      setText(mapBaseBravo, map.mode === 'buy' ? 'CT' : 'BRAVO');
      setText(
        mapCardWeapons,
        map.mode === 'buy' ? String(BUY_ITEMS.length) : String(map.weaponSpawns.length),
      );
      setText(mapCardWeaponsLabel, map.mode === 'buy' ? 'ЗАКУПКА' : 'ОРУЖИЕ');
      setText(mapCardArmor, map.mode === 'buy' ? 'MR12' : String(map.armorSpawns.length));
      setText(mapCardArmorLabel, map.mode === 'buy' ? 'РЕЖИМ' : 'БРОНЯ');
      setText(
        mapCardNote,
        map.id === 'fy_sand'
          ? 'Песчаная арена из BSP: две двухэтажные башни с входами со стороны спавна, два гаража с крышами и гранатами, узкие проходы.'
          : map.id === 'de_dust2'
            ? 'Классическая тактическая карта CS2: Long A с ямой (Pit), Mid с дверями и Xbox на Catwalk/Short, двухуровневые B-тоннели, пленты A и B.'
            : 'Режим закупки: $800 на старте, MR12, смена сторон после 12 раундов, закупка на базе в freeze и первые 20 секунд live.',
      );
      if (map.mode === 'buy') {
        setText(startTitle, 'Закупка и экономика');
        setText(
          startLead,
          'MR12 до 13 побед. На старте $800: купите оружие, броню и гранаты на базе, затем удержите экономику и заберите раунд. Смена сторон после 12 раундов.',
        );
      } else {
        setText(startTitle, 'Дуэль на арене');
        setText(
          startLead,
          'Первый до 16 раундов. Каждое убийство завершает раунд и возвращает игроков на спавн. Победитель сохраняет оружие и броню, проигравший получает стартовый набор.',
        );
      }
    },
    setLocalPlayer: (playerId) => {
      localPlayerId = playerId;
      if (playerId === null) {
        teamAlpha.classList.remove('is-you');
        teamBravo.classList.remove('is-you');
      }
      if (latestLobby !== null) {
        renderLobbyPlayers(latestLobby);
      }
      if (isOverlayVisible(scoreboardOverlay)) {
        renderScoreboard();
      }
    },
    updateLobby: (state, playerId) => {
      latestLobby = state;
      if (playerId !== null) {
        localPlayerId = playerId;
      }
      if (state.phase === 'lobby') {
        latestRoundSummary = null;
        pendingRoundSummary = null;
        lastSummaryAppliedRound = 0;
      }
      renderLobbyPlayers(state);
      const pause = state.phase === 'paused';
      setOverlayVisible(lobbyOverlay, state.phase === 'lobby' || pause);
      if (pause) {
        setText(lobbyTitle, 'Матч на паузе');
        setText(
          lobbyStatus,
          'Соединение с одним из игроков потеряно. Ожидание 60 сек до продолжения.',
        );
      } else if (state.roomMode === '2v2') {
        const readyCount = state.players.filter((p) => p.ready).length;
        if (state.players.length < 4) {
          setText(lobbyTitle, `Ожидание игроков (${state.players.length}/4)`);
          setText(
            lobbyStatus,
            'Займите сторону (T или CT) и нажмите «ГОТОВ К ИГРЕ».',
          );
        } else {
          setText(lobbyTitle, `Готовность участников (${readyCount}/4)`);
          setText(
            lobbyStatus,
            readyCount === 4
              ? 'Все игроки готовы! Старт...'
              : 'Для начала матча все 4 игрока должны нажать «ГОТОВ».',
          );
        }
      } else {
        setText(
          lobbyTitle,
          state.players.length < 2 ? 'Ожидание соперника' : 'Готовность',
        );
        setText(
          lobbyStatus,
          state.players.length < 2
            ? 'Откройте вторую вкладку или пригласите друга. Матч начнётся автоматически.'
            : 'Оба игрока на месте. Приготовьтесь.',
        );
      }
      if (!pause) {
        if (state.roomMode === '2v2') {
          const readyCount = state.players.filter((p) => p.ready).length;
          setText(
            lobbyTimer,
            state.players.length < 4
              ? `Нужно 4 игрока (сейчас ${state.players.length}/4)`
              : readyCount === 4
                ? 'Запуск матча...'
                : `Готовы: ${readyCount} из 4`,
          );
        } else {
          setText(
            lobbyTimer,
            state.players.length < 2
              ? 'Матч начнётся автоматически'
              : 'Старт через несколько секунд',
          );
        }
      }
      if (state.phase === 'ended') {
        setOverlayVisible(lobbyOverlay, false);
      }
      updateVotes();
    },
    updateSnapshot: (snapshot, playerId) => {
      latestSnapshot = snapshot;
      if (playerId !== null) {
        localPlayerId = playerId;
      }
      if (
        snapshot.match.phase === 'countdown' &&
        snapshot.match.round === 1 &&
        snapshot.match.scores.alpha === 0 &&
        snapshot.match.scores.bravo === 0
      ) {
        latestRoundSummary = null;
        pendingRoundSummary = null;
        lastSummaryAppliedRound = 1;
      } else if (snapshot.match.phase === 'ended' && pendingRoundSummary !== null) {
        latestRoundSummary = pendingRoundSummary;
      } else if (
        snapshot.match.round !== lastSummaryAppliedRound &&
        (snapshot.match.phase === 'countdown' || snapshot.match.phase === 'live') &&
        pendingRoundSummary !== null
      ) {
        latestRoundSummary = pendingRoundSummary;
        lastSummaryAppliedRound = snapshot.match.round;
      }
      updateScores(snapshot);
      updatePhase(snapshot.match.phase);
      if (snapshot.match.phase === 'live') {
        hideRoundBanner();
      }
      updateLocal(snapshot);
      updateVotes();
      if (
        snapshot.match.phase === 'live' ||
        snapshot.match.phase === 'countdown' ||
        snapshot.match.phase === 'round_over'
      ) {
        setOverlayVisible(lobbyOverlay, false);
        setOverlayVisible(pauseOverlay, false);
      }
      if (isOverlayVisible(scoreboardOverlay)) {
        renderScoreboard();
      }
    },
    tick: (serverNow) => {
      updateTimer(serverNow);
      updateDeathTimer(serverNow);
      updateReloadBar(serverNow);
      updatePauseTimer(serverNow);
      if (buyOpen && latestSnapshot !== null) {
        updateBuyState(latestSnapshot, localPlayerId, lastBuyInZone);
      }
    },
    showCountdown: (state) => {
      hideRoundBanner();
      hideBombAlert();
      const text = state.seconds <= 1 ? 'БОЙ' : String(state.seconds);
      const subtitle = state.resumed
        ? 'ПРОДОЛЖЕНИЕ'
        : state.round > 1
          ? `РАУНД ${state.round}`
          : 'ПРИГОТОВЬТЕСЬ';
      showAnnouncement(text, subtitle, 'countdown', 950);
    },
    showLive: () => {
      hideRoundBanner();
      hideBombAlert();
      showAnnouncement('БОЙ', 'УДАЧИ', 'live', 720);
    },
    addKill: (event, playerId) => {
      const entry = createElement('div', 'killfeed__item');
      if (event.killerId === playerId && event.killerId !== event.victimId) {
        entry.classList.add('is-local-kill');
      }
      if (event.victimId === playerId) {
        entry.classList.add('is-local-death');
      }

      const killerPlayer = latestSnapshot?.players.find((p) => p.id === event.killerId);
      const victimPlayer = latestSnapshot?.players.find((p) => p.id === event.victimId);
      const killerSide = killerPlayer?.side ?? (event.killerId === event.victimId ? victimPlayer?.side : null);
      const victimSide = victimPlayer?.side ?? null;

      const killerClasses = [
        'killfeed__name',
        killerSide ? `killfeed__name--${killerSide}` : '',
        event.killerId === playerId && event.killerId !== event.victimId ? 'killfeed__name--you' : '',
      ]
        .filter(Boolean)
        .join(' ');

      const killer = createElement('span', killerClasses, event.killerName);
      const weapon = createElement(
        'span',
        'killfeed__weapon',
        event.weapon === 'fall'
          ? 'ПАДЕНИЕ'
          : event.weapon === 'c4'
            ? 'C4'
            : getWeapon(event.weapon).name,
      );
      if (event.headshot) {
        weapon.append(createElement('b', 'killfeed__hs', 'HS'));
      }

      const victimClasses = [
        'killfeed__name',
        victimSide ? `killfeed__name--${victimSide}` : '',
        event.victimId === playerId ? 'killfeed__name--you' : '',
      ]
        .filter(Boolean)
        .join(' ');

      const victim = createElement('span', victimClasses, event.victimName);
      entry.append(killer, weapon, victim);
      killfeed.prepend(entry);
      while (killfeed.children.length > 5) {
        killfeed.lastElementChild?.remove();
      }
      schedule(() => entry.remove(), 6500);
    },
    showDamage: (direction = null) => {
      damageFlash.classList.remove('is-active');
      void damageFlash.offsetWidth;
      damageFlash.classList.add('is-active');
      if (direction !== null && Number.isFinite(direction)) {
        damageDirection.style.setProperty('--damage-angle', `${direction}rad`);
        damageDirection.classList.remove('is-active');
        void damageDirection.offsetWidth;
        damageDirection.classList.add('is-active');
      } else {
        damageDirection.classList.remove('is-active');
      }
      if (damageTimer !== undefined) {
        window.clearTimeout(damageTimer);
      }
      damageTimer = schedule(() => {
        damageFlash.classList.remove('is-active');
        damageDirection.classList.remove('is-active');
      }, 850);
    },
    updateRoundStats: (event, playerId) => {
      pendingRoundSummary = event;
      if (playerId !== null) {
        localPlayerId = playerId;
      }
      if (latestSnapshot?.match.phase === 'ended') {
        latestRoundSummary = event;
        if (isOverlayVisible(scoreboardOverlay)) {
          renderScoreboard();
        }
      }
    },
    showSettings,
    showPickup: (weapon) => {
      setText(toast, `ПОДОБРАНО: ${weapon.toUpperCase()}`);
      toast.classList.add('is-visible', 'toast--success');
      if (toastTimer !== undefined) {
        window.clearTimeout(toastTimer);
      }
      toastTimer = schedule(() => {
        toast.classList.remove('is-visible', 'toast--success', 'toast--error');
      }, 2200);
    },
    showBombPlanted: (siteId) => {
      if (disposed) {
        return;
      }
      const localSide =
        latestSnapshot?.players.find((candidate) => candidate.id === localPlayerId)?.side ?? null;
      setText(
        bombAlertSite,
        localSide === 't' ? `ТОЧКА ${siteId} · ЗАЩИЩАЙТЕ БОМБУ` : 'ОБЕЗВРЕДЬТЕ БОМБУ',
      );
      bombAlert.classList.add('is-visible');
      if (bombAlertTimer !== undefined) {
        window.clearTimeout(bombAlertTimer);
      }
      bombAlertTimer = schedule(() => {
        bombAlert.classList.remove('is-visible');
      }, 5000);
    },
    hideBombAlert,
    showRoundWin: (winnerName, localWon, reason) => {
      if (disposed) {
        return;
      }
      hideBombAlert();
      setText(
        roundBannerLabel,
        reason === 'bomb'
          ? 'БОМБА ВЗОРВАНА'
          : reason === 'defuse'
            ? 'БОМБА ОБЕЗВРЕЖЕНА'
            : 'РАУНД ЗАВЕРШЁН',
      );
      setText(roundBannerName, localWon ? 'ПОБЕДА' : 'ПОРАЖЕНИЕ');
      setText(
        roundBannerSub,
        reason === 'bomb'
          ? 'ТЕРРОРИСТЫ ВЗОРВАЛИ ЦЕЛЬ'
          : reason === 'defuse'
            ? 'СПЕЦНАЗ ОБЕЗВРЕДИЛ C4'
            : localWon
              ? 'ВАША КОМАНДА ВЫИГРАЛА РАУНД'
              : `${winnerName.length > 0 ? winnerName.toUpperCase() : 'СОПЕРНИК'} ЗАБИРАЕТ РАУНД`,
      );
      roundBanner.classList.toggle('round-banner--win', localWon);
      roundBanner.classList.toggle('round-banner--loss', !localWon);
      roundBanner.classList.add('is-visible');
    },
    hideRoundWin: hideRoundBanner,
    showResults: (event, playerId) => {
      hideRoundBanner();
      hideBombAlert();
      setBuyOpen(false);
      showSettings(false);
      resultsEvent = event;
      setOverlayVisible(startOverlay, false);
      setOverlayVisible(scoreboardOverlay, false);
      const localTeam =
        latestSnapshot?.players.find((candidate) => candidate.id === playerId)?.team ??
        latestLobby?.players.find((candidate) => candidate.id === playerId)?.team ??
        null;
      const winnerTeam =
        event.winnerId !== null
          ? (latestSnapshot?.players.find((candidate) => candidate.id === event.winnerId)?.team ??
             latestLobby?.players.find((candidate) => candidate.id === event.winnerId)?.team ??
             null)
          : null;

      let won = false;
      let draw = false;

      if (localTeam !== null && winnerTeam !== null) {
        won = localTeam === winnerTeam;
        draw = false;
      } else if (localTeam !== null) {
        const enemyTeam = localTeam === 'alpha' ? 'bravo' : 'alpha';
        won = event.scores[localTeam] > event.scores[enemyTeam];
        draw = event.scores[localTeam] === event.scores[enemyTeam];
      } else {
        won = event.winnerId !== null && event.winnerId === playerId;
        draw = event.winnerId === null && event.scores.alpha === event.scores.bravo;
      }
      resultsTitle.classList.remove('is-win', 'is-lose', 'is-draw');
      resultsTitle.classList.add(won ? 'is-win' : draw ? 'is-draw' : 'is-lose');
      setText(resultsTitle, won ? 'ПОБЕДА' : draw ? 'НИЧЬЯ' : 'ПОРАЖЕНИЕ');
      setText(
        resultsSub,
        won
          ? 'Ваша команда контролировала арену.'
          : draw
            ? 'Силы оказались равны.'
            : event.winnerName === null
              ? 'В следующий раз получится.'
              : `Победитель: ${event.winnerName}`,
      );
      setText(resultsAlpha, String(event.scores.alpha));
      setText(resultsBravo, String(event.scores.bravo));
      setText(resultsAlphaLabel, SIDE_LABEL[sideForTeam('alpha')]);
      setText(resultsBravoLabel, SIDE_LABEL[sideForTeam('bravo')]);
      setText(resultsReason, END_REASON[event.reason]);
      setOverlayVisible(resultsOverlay, true);
      setOverlayVisible(lobbyOverlay, false);
      setOverlayVisible(pauseOverlay, false);
      setOverlayVisible(deathOverlay, false);
      rematchButton.disabled = false;
      setText(rematchButton, 'РЕВАНШ');
      updateVotes();
    },
    hideResults: () => {
      resultsEvent = null;
      setOverlayVisible(resultsOverlay, false);
    },
    showPause: (show) => {
      if (show && (isOverlayVisible(startOverlay) || isOverlayVisible(resultsOverlay))) {
        return;
      }
      setOverlayVisible(pauseOverlay, show);
    },
    showScoreboard: (show) => {
      setOverlayVisible(scoreboardOverlay, show);
      cs2Topbar.classList.toggle('is-tab-active', show);
      if (show) {
        renderScoreboard();
      }
    },
    showToast: (text, tone = 'info') => {
      setText(toast, text);
      toast.classList.remove('toast--success', 'toast--error');
      toast.classList.add('is-visible', `toast--${tone}`);
      if (toastTimer !== undefined) {
        window.clearTimeout(toastTimer);
      }
      toastTimer = schedule(() => {
        toast.classList.remove('is-visible', 'toast--success', 'toast--error', 'toast--info');
      }, 2400);
    },
    showBuy: (show) => {
      setBuyOpen(show);
    },
    setBuyZoneNotice: (show) => {
      buyZoneNotice.classList.toggle('is-visible', show);
    },
    updateBuy: (snapshot, playerId, inBuyZone) => {
      updateBuyState(snapshot, playerId, inBuyZone);
    },
    showBuyResult: (event, playerId) => {
      if (event.playerId !== playerId) {
        return;
      }
      const item = getBuyItem(event.itemId);
      const name = item?.name ?? event.itemId;
      const text = event.ok
        ? `${event.action === 'buy' ? 'КУПЛЕНО' : 'ВОЗВРАТ'}: ${name}`
        : (event.error ?? 'Покупка отклонена');
      setText(toast, text);
      toast.classList.remove('toast--success', 'toast--error', 'toast--info');
      toast.classList.add('is-visible', event.ok ? 'toast--success' : 'toast--error');
      if (toastTimer !== undefined) {
        window.clearTimeout(toastTimer);
      }
      toastTimer = schedule(() => {
        toast.classList.remove('is-visible', 'toast--success', 'toast--error', 'toast--info');
      }, 2400);
    },
    setBlind: (remainingMs) => {
      const remaining = Math.max(0, remainingMs);
      if (remaining <= 0) {
        blindPeakMs = 0;
        lastBlindRemainingMs = 0;
        flashOverlay.style.opacity = '0';
        flashOverlay.classList.remove('is-active');
        return;
      }
      if (remaining > lastBlindRemainingMs + 50) {
        blindPeakMs = remaining;
      }
      lastBlindRemainingMs = remaining;
      const peakAlpha = clamp(blindPeakMs / 1_400, 0.55, 1);
      const fadeWindow = Math.max(1, blindPeakMs * 0.58);
      const opacity =
        remaining > fadeWindow ? peakAlpha : (remaining / fadeWindow) * peakAlpha * 0.96;
      flashOverlay.style.opacity = opacity.toFixed(3);
      flashOverlay.classList.add('is-active');
    },
    showError: (message) => {
      if (isOverlayVisible(startOverlay)) {
        setText(joinError, message);
      } else {
        setText(toast, message);
        toast.classList.remove('toast--success');
        toast.classList.add('is-visible', 'toast--error');
        if (toastTimer !== undefined) {
          window.clearTimeout(toastTimer);
        }
        toastTimer = schedule(() => toast.classList.remove('is-visible', 'toast--error'), 3000);
      }
    },
    setScope: (visible) => {
      setOverlayVisible(scopeOverlay, visible);
      scopeOverlay.setAttribute('aria-hidden', String(!visible));
    },
    setSpectator: (state) => {
      const previousTarget = spectatorState?.targetId ?? null;
      spectatorState = state;
      spectatorBar.classList.toggle('is-visible', state !== null);
      document.body.classList.toggle('is-spectating', state !== null);
      if (state === null) {
        delete document.body.dataset.spectate;
      } else {
        document.body.dataset.spectate = state.mode;
      }
      if (state !== null) {
        spectatorBar.dataset.mode = state.mode;
        setText(spectatorLabel, state.mode === 'bomb' ? 'НАБЛЮДЕНИЕ · C4' : 'НАБЛЮДЕНИЕ');
        setText(
          spectatorName,
          state.mode === 'bomb'
            ? 'БОМБА'
            : state.mode === 'player'
              ? (state.targetName ?? '').toUpperCase()
              : 'ВЫ ВЫБЫЛИ',
        );
        spectatorHint.classList.toggle('is-hidden', !state.canCycle);
        setText(spectatorKiller, state.killerName === null ? '' : `Вас убил: ${state.killerName}`);
        spectatorKiller.classList.toggle('is-hidden', state.killerName === null);
      }
      if ((state?.targetId ?? null) !== previousTarget && latestSnapshot !== null) {
        updateLocal(latestSnapshot);
      }
    },
    setSpectatorFade: (alpha) => {
      const value = clamp(alpha, 0, 1);
      spectatorFade.style.opacity = value <= 0.001 ? '0' : value.toFixed(3);
    },
    updateRadar: (observer, snapshot, map, activeSettings) => {
      radar.update(observer, snapshot, map, activeSettings);
    },
    registerRadarShot: (pos) => {
      radar.registerShot(pos);
    },
    setRadarSpotted: (enemyId, pos) => {
      radar.setSpotted(enemyId, pos);
    },
    markRadarLostSight: (enemyId) => {
      radar.markLostSight(enemyId);
    },
    setRadarVisible: (visible) => {
      radar.setVisible(visible);
    },
    dispose: () => {
      if (disposed) {
        return;
      }
      disposed = true;
      for (const id of timeouts) {
        window.clearTimeout(id);
      }
      timeouts.clear();
      if (announcementTimer !== undefined) {
        window.clearTimeout(announcementTimer);
      }
      if (toastTimer !== undefined) {
        window.clearTimeout(toastTimer);
      }
      if (damageTimer !== undefined) {
        window.clearTimeout(damageTimer);
      }
      crosshairEditor.dispose();
      root.replaceChildren();
    },
  };
}
