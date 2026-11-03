import { MAP_IDS, MAPS } from '../shared/map';
import type { MatchPhase, Team } from '../shared/protocol';
import type { PlayerState } from './game/types';
import type { GameServer } from './server';

export interface AdminCommand {
  command: string;
  args: string[];
}

export interface AdminPlayerView {
  id: string;
  name: string;
  team: Team;
  connected: boolean;
  kills: number;
  deaths: number;
  joinedAt: number;
}

export interface AdminMapView {
  id: string;
  name: string;
  size: number;
  sizeZ: number;
  weapons: number;
  armor: number;
  bombSites: string[];
}

export interface AdminStateView {
  serverTime: number;
  mapId: string;
  mapName: string;
  phase: MatchPhase;
  round: number;
  scores: Record<Team, number>;
  players: AdminPlayerView[];
  maps: AdminMapView[];
  fragLimit: number;
}

export interface AdminCommandResult {
  ok: boolean;
  lines: string[];
  /** The admin panel should stop the game server after replying. */
  shutdown?: boolean;
}

export function parseAdminCommand(line: string): AdminCommand {
  const tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;

  for (const character of line.trim()) {
    if (quote !== null) {
      if (character === quote) {
        quote = null;
      } else {
        current += character;
      }
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (/\s/.test(character)) {
      if (current.length > 0) {
        tokens.push(current);
        current = '';
      }
      continue;
    }
    current += character;
  }

  if (current.length > 0) {
    tokens.push(current);
  }

  const command = tokens.shift()?.toLowerCase() ?? '';
  return { command, args: tokens };
}

function formatPlayer(player: PlayerState): string {
  const state = player.connected ? 'online' : 'offline';
  return `${player.name} [${player.team}] ${player.kills}:${player.deaths} ${state} id=${player.id}`;
}

function helpLines(): string[] {
  return [
    'Команды:',
    '  help                     — показать список команд',
    '  status / players         — состояние матча и игроки',
    '  maps                     — доступные карты',
    '  map <id>                 — сменить карту и перезапустить лобби',
    '  kick <ник|id>            — кикнуть игрока и освободить слот',
    '  restart                  — перезапустить матч',
    '  end                      — завершить текущий матч',
    '  say <текст>              — объявление всем игрокам',
    '  quit                     — остановить сервер',
  ];
}

function findPlayer(
  server: GameServer,
  query: string,
): { player: PlayerState | null; lines: string[] } {
  const players = server.match.findPlayers(query);
  if (players.length === 0) {
    return { player: null, lines: [`Игрок не найден: ${query}`] };
  }
  if (players.length > 1) {
    return {
      player: null,
      lines: [
        `Найдено несколько игроков по запросу «${query}»:`,
        ...players.map((player) => `  ${formatPlayer(player)}`),
        'Уточните ник или id.',
      ],
    };
  }
  return { player: players[0] ?? null, lines: [] };
}

export function getAdminState(server: GameServer): AdminStateView {
  const state = server.match.getLobbyState();

  return {
    serverTime: Date.now(),
    mapId: state.mapId,
    mapName: state.mapName,
    phase: state.phase,
    round: state.round,
    scores: state.scores,
    players: server.match.getPlayers().map((player) => ({
      id: player.id,
      name: player.name,
      team: player.team,
      connected: player.connected,
      kills: player.kills,
      deaths: player.deaths,
      joinedAt: player.joinedAt,
    })),
    maps: MAP_IDS.map((id) => {
      const map = MAPS[id];
      return {
        id,
        name: map.name,
        size: map.size,
        sizeZ: map.sizeZ,
        weapons: map.weaponSpawns.length,
        armor: map.armorSpawns.length,
        bombSites: map.bombSites.map((site) => site.id),
      };
    }),
    fragLimit: state.fragLimit,
  };
}

export function executeAdminCommand(server: GameServer, parsed: AdminCommand): AdminCommandResult {
  const lines: string[] = [];
  const command = parsed.command.trim().toLowerCase();

  switch (command) {
    case '':
      return { ok: true, lines };
    case 'help':
      return { ok: true, lines: helpLines() };
    case 'status':
    case 'players': {
      const state = server.match.getLobbyState();
      lines.push(
        `Карта: ${state.mapName} (${state.mapId}) | фаза: ${state.phase} | раунд: ${state.round} | счёт: ${state.scores.alpha}:${state.scores.bravo}`,
      );
      if (state.players.length === 0) {
        lines.push('Игроков нет.');
      } else {
        for (const player of server.match.getPlayers()) {
          lines.push(`  ${formatPlayer(player)}`);
        }
      }
      return { ok: true, lines };
    }
    case 'maps':
      for (const id of MAP_IDS) {
        const map = MAPS[id];
        const sitesSuffix =
          map.bombSites.length > 0
            ? `, сайты: ${map.bombSites.map((site) => site.id).join('/')}`
            : '';
        lines.push(
          `  ${id} — ${map.size}×${map.sizeZ}, оружие: ${map.weaponSpawns.length}, броня: ${map.armorSpawns.length}${sitesSuffix}`,
        );
      }
      return { ok: true, lines };
    case 'map': {
      const mapId = parsed.args[0];
      if (mapId === undefined) {
        return { ok: false, lines: ['Использование: map <id>. Доступные карты: maps'] };
      }
      const nextMap = server.match.switchMap(mapId, Date.now());
      if (nextMap === null) {
        return {
          ok: false,
          lines: [`Неизвестная карта: ${mapId}. Доступные: ${MAP_IDS.join(', ')}`],
        };
      }
      lines.push(`Карта переключена на ${nextMap.name}. Клиенты будут перезагружены.`);
      const staleSocketIds = [...server.io.sockets.sockets.keys()];
      server.io.emit('map_changed', {
        mapId: nextMap.id,
        mapName: nextMap.name,
        mode: nextMap.mode ?? 'arena',
      });
      const timer = setTimeout(() => {
        for (const socketId of staleSocketIds) {
          server.io.sockets.sockets.get(socketId)?.disconnect(true);
        }
      }, 400);
      timer.unref();
      return { ok: true, lines };
    }
    case 'kick': {
      const query = parsed.args.join(' ').trim();
      if (query.length === 0) {
        return { ok: false, lines: ['Использование: kick <ник|id>'] };
      }
      const found = findPlayer(server, query);
      if (found.player === null) {
        return { ok: false, lines: found.lines };
      }
      const socketId = found.player.socketId;
      if (!server.match.kickPlayer(found.player.id, Date.now())) {
        return { ok: false, lines: ['Не удалось кикнуть игрока.'] };
      }
      if (socketId !== null) {
        server.io.sockets.sockets.get(socketId)?.disconnect(true);
      }
      return { ok: true, lines: [`Игрок ${found.player.name} кикнут, слот освобождён.`] };
    }
    case 'restart':
      server.match.restart(Date.now());
      return { ok: true, lines: ['Матч перезапущен.'] };
    case 'end':
      server.match.forceEnd(Date.now());
      return { ok: true, lines: ['Матч завершён.'] };
    case 'say': {
      const text = parsed.args.join(' ').trim();
      if (text.length === 0) {
        return { ok: false, lines: ['Использование: say <текст>'] };
      }
      server.io.emit('announce', { text, tone: 'info' });
      return { ok: true, lines: [`Объявление: ${text}`] };
    }
    case 'quit':
      return { ok: true, lines: ['Остановка сервера...'], shutdown: true };
    default:
      return {
        ok: false,
        lines: [`Неизвестная команда: ${command}. Введите help.`],
      };
  }
}
