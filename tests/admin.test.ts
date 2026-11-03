import { describe, expect, it } from 'vitest';
import {
  executeAdminCommand,
  getAdminState,
  parseAdminCommand,
  type AdminStateView,
} from '../server/admin';
import { Match } from '../server/game/match';
import type { GameServer } from '../server/server';

function createFakeServer(): {
  server: GameServer;
  match: Match;
  events: Array<{ name: string; payload: unknown }>;
} {
  const match = new Match({ seed: 7 });
  const events: Array<{ name: string; payload: unknown }> = [];
  const io = {
    emit: (name: string, payload: unknown) => {
      events.push({ name, payload });
    },
    sockets: { sockets: new Map() },
  } as unknown as GameServer['io'];

  return { server: { match, io } as unknown as GameServer, match, events };
}

describe('admin command parser', () => {
  it('normalizes the command and splits whitespace', () => {
    expect(parseAdminCommand('  MAP   fy_sand  ')).toEqual({
      command: 'map',
      args: ['fy_sand'],
    });
    expect(parseAdminCommand('status')).toEqual({ command: 'status', args: [] });
  });

  it('returns an empty command for blank input', () => {
    expect(parseAdminCommand('')).toEqual({ command: '', args: [] });
    expect(parseAdminCommand('   \t  ')).toEqual({ command: '', args: [] });
  });

  it('keeps quoted arguments together', () => {
    expect(parseAdminCommand('kick "Bad Name"')).toEqual({
      command: 'kick',
      args: ['Bad Name'],
    });
    expect(parseAdminCommand("say 'server restart in 10s'")).toEqual({
      command: 'say',
      args: ['server restart in 10s'],
    });
  });

  it('supports player names with spaces and id arguments', () => {
    expect(parseAdminCommand('kick Alpha One')).toEqual({
      command: 'kick',
      args: ['Alpha', 'One'],
    });
    expect(parseAdminCommand('kick 1a2b3c4d')).toEqual({
      command: 'kick',
      args: ['1a2b3c4d'],
    });
  });
});

describe('admin command service', () => {
  it('returns structured match state and map metadata', () => {
    const { server, match } = createFakeServer();
    const join = match.join('socket-1', { name: 'Alpha One' }, 1_000);
    expect(join.result.ok).toBe(true);

    const state = getAdminState(server) as AdminStateView;
    expect(state.mapId).toBe('fy_sand');
    expect(state.phase).toBe('lobby');
    expect(state.players.map((player) => player.name)).toEqual(['Alpha One']);
    expect(state.maps.map((map) => map.id)).toEqual(['fy_sand', 'fy_wow', 'de_dust2']);
  });

  it('formats status output with players', () => {
    const { server, match } = createFakeServer();
    match.join('socket-1', { name: 'Alpha One' }, 1_000);

    const result = executeAdminCommand(server, { command: 'status', args: [] });

    expect(result.ok).toBe(true);
    expect(result.lines.join('\n')).toContain('Карта: fy_sand');
    expect(result.lines.join('\n')).toContain('Alpha One [alpha]');
  });

  it('switches maps and notifies connected clients', () => {
    const { server, match, events } = createFakeServer();

    const result = executeAdminCommand(server, { command: 'map', args: ['fy_wow'] });

    expect(result.ok).toBe(true);
    expect(match.getMapId()).toBe('fy_wow');
    expect(events).toContainEqual({
      name: 'map_changed',
      payload: { mapId: 'fy_wow', mapName: 'fy_wow', mode: 'buy' },
    });
  });

  it('rejects unknown maps without changing the current map', () => {
    const { server, match } = createFakeServer();

    const result = executeAdminCommand(server, { command: 'map', args: ['unknown'] });

    expect(result.ok).toBe(false);
    expect(result.lines.join('\n')).toContain('Неизвестная карта');
    expect(match.getMapId()).toBe('fy_sand');
  });

  it('rejects inherited map ids without corrupting the match', () => {
    const { server, match } = createFakeServer();

    const result = executeAdminCommand(server, { command: 'map', args: ['__proto__'] });

    expect(result.ok).toBe(false);
    expect(result.lines.join('\n')).toContain('Неизвестная карта');
    expect(match.getMapId()).toBe('fy_sand');
  });

  it('kicks a player by exact id', () => {
    const { server, match } = createFakeServer();
    const join = match.join('socket-1', { name: 'Alpha One' }, 1_000);
    const playerId = join.result.playerId;
    expect(playerId).toBeDefined();

    const result = executeAdminCommand(server, { command: 'kick', args: [playerId ?? ''] });

    expect(result.ok).toBe(true);
    expect(result.lines.join('\n')).toContain('кикнут');
    expect(match.getPlayers()).toHaveLength(0);
  });

  it('reports ambiguous player queries', () => {
    const { server, match } = createFakeServer();
    match.join('socket-1', { name: 'Alpha One' }, 1_000);
    match.join('socket-2', { name: 'Alpha Two' }, 1_001);

    const result = executeAdminCommand(server, { command: 'kick', args: ['Alpha'] });

    expect(result.ok).toBe(false);
    expect(result.lines.join('\n')).toContain('Найдено несколько игроков');
  });

  it('broadcasts announcements and marks quit as a shutdown command', () => {
    const { server, events } = createFakeServer();

    const say = executeAdminCommand(server, { command: 'say', args: ['hello', 'players'] });
    expect(say.ok).toBe(true);
    expect(events).toContainEqual({
      name: 'announce',
      payload: { text: 'hello players', tone: 'info' },
    });

    const quit = executeAdminCommand(server, { command: 'quit', args: [] });
    expect(quit.ok).toBe(true);
    expect(quit.shutdown).toBe(true);
  });

  it('returns an error for unknown commands', () => {
    const { server } = createFakeServer();

    const result = executeAdminCommand(server, { command: 'dance', args: [] });

    expect(result.ok).toBe(false);
    expect(result.lines.join('\n')).toContain('Неизвестная команда');
  });
});
