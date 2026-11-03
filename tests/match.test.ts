import { describe, expect, it } from 'vitest';
import { Match, sanitizeName } from '../server/game/match';
import { addWeapon, switchWeapon } from '../server/game/inventory';
import type { MatchConfig } from '../shared/config';
import { vec3 } from '../shared/math';
import { makeFlatMap, makeInput } from './helpers';

function makeMatch(config: Partial<MatchConfig> = {}, map = makeFlatMap()): Match {
  return new Match({
    map,
    seed: 42,
    config: {
      countdownMs: 50,
      matchDurationMs: 60_000,
      respawnMs: 1_000,
      roundResetMs: 1_000,
      reconnectWindowMs: 5_000,
      fragLimit: 16,
      ...config,
    },
  });
}

interface LiveMatch {
  match: Match;
  alpha: ReturnType<Match['getPlayer']>;
  bravo: ReturnType<Match['getPlayer']>;
  alphaId: string;
  bravoId: string;
}

function createLiveMatch(config: Partial<MatchConfig> = {}, map = makeFlatMap()): LiveMatch {
  const match = makeMatch(config, map);
  const first = match.join('socket-alpha', { name: 'Alpha' }, 1_000);
  const second = match.join('socket-bravo', { name: 'Bravo' }, 1_000);
  if (first.player === null || second.player === null) {
    throw new Error('Failed to create players');
  }
  match.drainEvents();
  match.tick(1_051, 1 / 30);
  match.tick(1_060, 1 / 30);
  match.drainEvents();
  return {
    match,
    alpha: match.getPlayer(first.player.id),
    bravo: match.getPlayer(second.player.id),
    alphaId: first.player.id,
    bravoId: second.player.id,
  };
}

function aimAtBravo(
  match: Match,
  alphaId: string,
  bravoId: string,
  now: number,
  pitch = -0.08,
): void {
  const alpha = match.getPlayer(alphaId);
  const bravo = match.getPlayer(bravoId);
  if (alpha === undefined || bravo === undefined) {
    throw new Error('Missing players');
  }
  alpha.position = vec3(0, 0, -4);
  alpha.velocity = vec3();
  bravo.position = vec3(0, 0, 4);
  bravo.velocity = vec3();
  bravo.health = 1;
  bravo.armor = 0;
  bravo.history = [];
  addWeapon(alpha, 'ak47');
  match.setInput(
    alphaId,
    makeInput({
      seq: 1,
      clientTime: now,
      yaw: Math.PI,
      pitch,
      fire: true,
    }),
    now,
  );
}

describe('match lifecycle', () => {
  it('starts a countdown when the second player joins', () => {
    const match = makeMatch();
    const first = match.join('socket-a', { name: 'Alpha' }, 1_000);
    expect(first.result.ok).toBe(true);
    expect(match.currentPhase).toBe('lobby');
    const second = match.join('socket-b', { name: 'Bravo' }, 1_010);
    expect(second.result.ok).toBe(true);
    expect(match.currentPhase).toBe('countdown');
    expect(match.getLobbyState().countdownEndsAt).toBe(1_060);
    expect(match.getLobbyState().players).toHaveLength(2);
  });

  it('enters live after the countdown and produces snapshots', () => {
    const { match } = createLiveMatch();
    expect(match.currentPhase).toBe('live');
    const snapshot = match.getSnapshot(1_100);
    expect(snapshot.players).toHaveLength(2);
    expect(snapshot.match.phase).toBe('live');
    expect(snapshot.match.timeRemainingMs).toBeGreaterThan(0);
    expect(snapshot.match.round).toBe(1);
    expect(snapshot.match.scores).toEqual({ alpha: 0, bravo: 0 });
  });

  it('rejects a third player', () => {
    const { match } = createLiveMatch();
    const third = match.join('socket-c', { name: 'Charlie' }, 1_100);
    expect(third.result.ok).toBe(false);
    expect(third.result.error).toContain('заполнен');
  });

  it('sanitizes names to 16 visible characters', () => {
    expect(sanitizeName('  \u0000Bad   Name  ')).toBe('Bad Name');
    expect(sanitizeName('abcdefghijklmnopq')).toBe('abcdefghijklmnop');
    expect(sanitizeName('   ')).toBe('');
    expect(sanitizeName('😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀')).toHaveLength(32);
  });
});

describe('match reconnect and pause', () => {
  it('takes over an existing session and ignores the old socket disconnect', () => {
    const { match, alphaId, alpha } = createLiveMatch();
    if (alpha === undefined) {
      throw new Error('Missing alpha');
    }
    const takeover = match.join(
      'socket-alpha-new',
      { name: 'Alpha', playerId: alphaId, sessionToken: alpha.sessionToken },
      1_200,
    );
    expect(takeover.result.ok).toBe(true);
    expect(takeover.result.resumed).toBe(true);
    expect(takeover.replacedSocketId).toBe('socket-alpha');
    expect(match.currentPhase).toBe('live');
    expect(match.getPlayer(alphaId)?.socketId).toBe('socket-alpha-new');

    match.disconnect(alphaId, 1_250, 'socket-alpha');
    expect(match.currentPhase).toBe('live');
    expect(match.getPlayer(alphaId)?.connected).toBe(true);

    match.disconnect(alphaId, 1_260, 'socket-alpha-new');
    expect(match.currentPhase).toBe('paused');
  });

  it('pauses when a player disconnects and resumes after reconnect', () => {
    const { match, alphaId, alpha } = createLiveMatch();
    if (alpha === undefined) {
      throw new Error('Missing alpha');
    }
    const before = match.getSnapshot(1_200).match.timeRemainingMs;
    match.disconnect(alphaId, 1_200);
    expect(match.currentPhase).toBe('paused');
    expect(match.getLobbyState().pauseDeadline).toBe(6_200);

    const resumed = match.join(
      'socket-alpha-new',
      { name: 'Alpha', playerId: alphaId, sessionToken: alpha.sessionToken },
      1_250,
    );
    expect(resumed.result.resumed).toBe(true);
    expect(match.currentPhase).toBe('countdown');
    match.tick(1_301, 1 / 30);
    expect(match.currentPhase).toBe('live');
    expect(match.getSnapshot(1_302).match.timeRemainingMs).toBeLessThanOrEqual(before);
  });

  it('awards the match to the connected player after the reconnect window', () => {
    const { match, alphaId, bravoId } = createLiveMatch({ reconnectWindowMs: 100 });
    match.disconnect(alphaId, 1_200);
    match.tick(1_201, 1 / 30);
    expect(match.currentPhase).toBe('paused');
    match.tick(1_301, 1 / 30);
    expect(match.currentPhase).toBe('ended');
    expect(match.getLobbyState().winnerId).toBe(bravoId);
    expect(match.getLobbyState().endReason).toBe('abandon');
    expect(match.getPlayer(alphaId)).toBeUndefined();
    const events = match.drainEvents();
    expect(
      events.some((event) => event.type === 'round_end' && event.event.reason === 'abandon'),
    ).toBe(true);
  });
});

describe('match combat and scoring', () => {
  it('registers a kill, score, and frag-limit round end after the final round-over window', () => {
    const { match, alphaId, bravoId } = createLiveMatch({ fragLimit: 1, roundResetMs: 100 });
    aimAtBravo(match, alphaId, bravoId, 1_200);
    match.tick(1_200, 1 / 30);

    expect(match.currentPhase).toBe('round_over');
    expect(match.getLobbyState().winnerId).toBeNull();
    expect(match.getLobbyState().endReason).toBeNull();

    const roundEvents = match.drainEvents();
    expect(roundEvents.some((event) => event.type === 'kill')).toBe(true);
    expect(roundEvents.some((event) => event.type === 'hit')).toBe(true);
    expect(roundEvents.some((event) => event.type === 'round_summary')).toBe(true);
    expect(roundEvents.some((event) => event.type === 'round_end')).toBe(false);

    match.tick(1_301, 1 / 30);
    expect(match.currentPhase).toBe('ended');
    const state = match.getLobbyState();
    expect(state.winnerId).toBe(alphaId);
    expect(state.endReason).toBe('frags');
    expect(state.scores.alpha).toBe(1);
    const endEvents = match.drainEvents();
    expect(endEvents.some((event) => event.type === 'round_end')).toBe(true);
  });

  it('reports hit origin and a round summary with per-player stats', () => {
    const { match, alphaId, bravoId } = createLiveMatch({ fragLimit: 16, roundResetMs: 100 });
    aimAtBravo(match, alphaId, bravoId, 1_200);
    match.tick(1_200, 1 / 30);
    expect(match.currentPhase).toBe('round_over');

    const events = match.drainEvents();
    const hit = events.find((event) => event.type === 'hit' && event.event.source === 'weapon');
    expect(hit?.type).toBe('hit');
    if (hit?.type === 'hit') {
      expect(hit.event.sourcePosition.z).toBeCloseTo(-4);
    }

    const summary = events.find((event) => event.type === 'round_summary');
    expect(summary?.type).toBe('round_summary');
    if (summary?.type === 'round_summary') {
      expect(summary.event.round).toBe(1);
      expect(summary.event.winnerId).toBe(alphaId);
      expect(summary.event.winnerName).toBe('Alpha');
      const alphaStats = summary.event.players.find((player) => player.playerId === alphaId);
      const bravoStats = summary.event.players.find((player) => player.playerId === bravoId);
      expect(alphaStats?.shots).toBe(1);
      expect(alphaStats?.hits).toBe(1);
      expect(alphaStats?.damage).toBeGreaterThan(0);
      expect(alphaStats?.matchShots).toBe(1);
      expect(alphaStats?.matchHits).toBe(1);
      expect(alphaStats?.matchDamage).toBe(alphaStats?.damage);
      expect(bravoStats?.damage).toBe(0);
      expect(bravoStats?.matchDamage).toBe(0);
    }

    match.tick(1_301, 1 / 30);
    const alpha = match.getPlayer(alphaId);
    expect(alpha?.roundShots).toBe(0);
    expect(alpha?.roundDamage).toBe(0);
    expect(alpha?.matchShots).toBe(1);
    expect(alpha?.matchHits).toBe(1);
    expect(alpha?.matchDamage).toBeGreaterThan(0);
  });

  it('tracks headshot kills separately for the TAB HS% column', () => {
    const { match, alphaId, bravoId } = createLiveMatch({ fragLimit: 16, roundResetMs: 100 });
    aimAtBravo(match, alphaId, bravoId, 1_200, 0);
    match.tick(1_200, 1 / 30);

    const summary = match.drainEvents().find((event) => event.type === 'round_summary');
    expect(summary?.type).toBe('round_summary');
    if (summary?.type === 'round_summary') {
      const stats = summary.event.players.find((player) => player.playerId === alphaId);
      expect(stats?.matchHeadshots).toBe(1);
      expect(stats?.matchHeadshotKills).toBe(1);
    }
  });

  it('enters a round-over window and starts the next round after it', () => {
    const { match, alphaId, bravoId } = createLiveMatch({ fragLimit: 16, roundResetMs: 100 });
    aimAtBravo(match, alphaId, bravoId, 1_200);
    match.tick(1_200, 1 / 30);

    expect(match.currentPhase).toBe('round_over');
    let state = match.getLobbyState();
    expect(state.round).toBe(1);
    expect(state.roundOverEndsAt).toBe(1_300);
    expect(state.countdownEndsAt).toBeNull();
    expect(state.players.find((player) => player.id === alphaId)?.kills).toBe(1);

    const alpha = match.getPlayer(alphaId);
    const bravo = match.getPlayer(bravoId);
    expect(alpha?.alive).toBe(true);
    expect(bravo?.alive).toBe(false);
    expect(alpha?.health).toBe(100);
    expect(bravo?.health).toBe(0);

    if (alpha === undefined) {
      throw new Error('Missing alpha');
    }
    const before = { ...alpha.position };
    match.setInput(alphaId, makeInput({ seq: 2, forward: 1, yaw: 0 }), 1_250);
    match.tick(1_250, 1 / 30);
    expect(alpha.position).not.toEqual(before);

    match.tick(1_301, 1 / 30);
    expect(match.currentPhase).toBe('live');
    state = match.getLobbyState();
    expect(state.round).toBe(2);
    expect(state.roundOverEndsAt).toBeNull();
    expect(alpha.alive).toBe(true);
    expect(bravo?.alive).toBe(true);
    expect(alpha.health).toBe(100);
    expect(bravo?.health).toBe(100);
    expect(alpha.inventory.primary?.id).toBe('ak47');
    expect(bravo?.inventory.primary).toBeNull();
    expect(match.getSnapshot(1_301).match.round).toBe(2);
  });

  it('ends by time and picks the score leader', () => {
    const { match, alphaId, bravoId } = createLiveMatch({
      matchDurationMs: 100,
      fragLimit: 16,
      countdownMs: 10,
    });
    const alpha = match.getPlayer(alphaId);
    const bravo = match.getPlayer(bravoId);
    if (alpha === undefined || bravo === undefined) {
      throw new Error('Missing players');
    }
    alpha.kills = 3;
    bravo.kills = 1;
    match.tick(1_200, 1 / 30);
    expect(match.currentPhase).toBe('ended');
    expect(match.getLobbyState().winnerId).toBe(alphaId);
    expect(match.getLobbyState().endReason).toBe('time');
  });

  it('starts a new countdown when both players vote for a rematch', () => {
    const { match, alphaId, bravoId } = createLiveMatch({ fragLimit: 1, roundResetMs: 100 });
    aimAtBravo(match, alphaId, bravoId, 1_200);
    match.tick(1_200, 1 / 30);
    expect(match.currentPhase).toBe('round_over');
    match.tick(1_301, 1 / 30);
    expect(match.currentPhase).toBe('ended');

    expect(match.voteRematch(alphaId, 1_350)).toBe(true);
    expect(match.getLobbyState().players.find((player) => player.id === alphaId)?.rematchVote).toBe(
      true,
    );
    expect(match.currentPhase).toBe('ended');

    expect(match.voteRematch(bravoId, 1_351)).toBe(true);
    expect(match.currentPhase).toBe('countdown');
    const state = match.getLobbyState();
    expect(state.scores).toEqual({ alpha: 0, bravo: 0 });
    expect(state.players.every((player) => player.rematchVote === false)).toBe(true);
  });

  it('rejects rematch votes outside the ended phase', () => {
    const { match, alphaId } = createLiveMatch();
    expect(match.voteRematch(alphaId, 1_200)).toBe(false);
  });
});

describe('match pickups and input', () => {
  it('picks up only an empty weapon slot by walking over it', () => {
    const map = makeFlatMap([
      { id: 'deagle', weapon: 'deagle', position: vec3(0, 0.9, 0) },
      { id: 'ak', weapon: 'ak47', position: vec3(1.2, 0.9, 0) },
      { id: 'm4', weapon: 'm4a1', position: vec3(-1.2, 0.9, 0) },
    ]);
    const match = new Match({
      map,
      seed: 1,
      config: { countdownMs: 10, fragLimit: 16 },
    });
    const first = match.join('socket-a', { name: 'Alpha' }, 1_000);
    const second = match.join('socket-b', { name: 'Bravo' }, 1_000);
    if (first.player === null || second.player === null) {
      throw new Error('Missing players');
    }
    match.drainEvents();
    match.tick(1_011, 1 / 30);
    match.tick(1_020, 1 / 30);
    match.drainEvents();

    first.player.position = vec3(0, 0, 0);
    match.tick(1_100, 1 / 30);
    expect(first.player.inventory.primary?.id).toBe('ak47');
    const pickups = match.getPickups();
    expect(pickups.find((pickup) => pickup.id === 'spawn:deagle')?.available).toBe(true);
    expect(pickups.find((pickup) => pickup.id === 'spawn:ak')?.available).toBe(false);
    expect(pickups.find((pickup) => pickup.id === 'spawn:m4')?.available).toBe(true);
    expect(match.getSnapshot(1_100).pickups).toHaveLength(2);
    expect(match.drainEvents().some((event) => event.type === 'pickup')).toBe(true);

    first.player.position = vec3(-1.2, 0, 0);
    match.tick(1_400, 1 / 30);
    expect(first.player.inventory.primary?.id).toBe('ak47');
    expect(match.getPickups().find((pickup) => pickup.id === 'spawn:m4')?.available).toBe(true);
  });

  it('stores a picked-up grenade without switching away from the firearm', () => {
    const map = makeFlatMap([{ id: 'grenade', weapon: 'hegrenade', position: vec3(0, 0.9, 0) }]);
    const match = new Match({ map, seed: 1, config: { countdownMs: 10, fragLimit: 16 } });
    const first = match.join('socket-a', { name: 'Alpha' }, 1_000);
    const second = match.join('socket-b', { name: 'Bravo' }, 1_000);
    if (first.player === null || second.player === null) {
      throw new Error('Missing players');
    }
    match.tick(1_011, 1 / 30);
    match.tick(1_020, 1 / 30);
    addWeapon(first.player, 'ak47');
    expect(first.player.activeSlot).toBe('primary');

    first.player.position = vec3(0, 0, 0);
    match.tick(1_100, 1 / 30);

    expect(first.player.inventory.grenade?.id).toBe('hegrenade');
    expect(first.player.activeSlot).toBe('primary');
    expect(first.player.inventory.primary?.id).toBe('ak47');
  });

  it('swaps an equipped weapon with a nearby pickup on E', () => {
    const map = makeFlatMap([{ id: 'm4', weapon: 'm4a1', position: vec3(0, 0.9, 0) }]);
    const match = new Match({ map, seed: 1, config: { countdownMs: 10, fragLimit: 16 } });
    const first = match.join('socket-a', { name: 'Alpha' }, 1_000);
    const second = match.join('socket-b', { name: 'Bravo' }, 1_000);
    if (first.player === null || second.player === null) {
      throw new Error('Missing players');
    }
    match.tick(1_011, 1 / 30);
    match.tick(1_020, 1 / 30);
    addWeapon(first.player, 'ak47');
    first.player.position = vec3(0, 0, 0);

    match.setInput(first.player.id, makeInput({ seq: 1, use: true }), 1_100);
    match.tick(1_100, 1 / 30);

    expect(first.player.inventory.primary?.id).toBe('m4a1');
    expect(first.player.activeSlot).toBe('primary');
    expect(match.getPickups().find((pickup) => pickup.id === 'spawn:m4')?.available).toBe(false);
    const dropped = match.getPickups().filter((pickup) => pickup.kind === 'dropped');
    expect(dropped).toHaveLength(1);
    expect(dropped[0]?.weapon).toBe('ak47');
  });

  it('does not drop the active weapon on E when no pickup is nearby', () => {
    const { match, alphaId } = createLiveMatch();
    const alpha = match.getPlayer(alphaId);
    if (alpha === undefined) {
      throw new Error('Missing alpha');
    }
    addWeapon(alpha, 'ak47');
    alpha.position = vec3(10, 0, 10);
    alpha.velocity = vec3();

    match.setInput(alphaId, makeInput({ seq: 1, use: true }), 1_200);
    match.tick(1_200, 1 / 30);
    expect(alpha.inventory.primary?.id).toBe('ak47');
    expect(match.getPickups().filter((pickup) => pickup.kind === 'dropped')).toHaveLength(0);
  });

  it('drops the active non-knife weapon on G', () => {
    const { match, alphaId } = createLiveMatch();
    const alpha = match.getPlayer(alphaId);
    if (alpha === undefined) {
      throw new Error('Missing alpha');
    }
    addWeapon(alpha, 'ak47');
    alpha.position = vec3(10, 0, 10);
    alpha.velocity = vec3();

    match.setInput(alphaId, makeInput({ seq: 1, drop: true }), 1_200);
    match.tick(1_200, 1 / 30);
    expect(alpha.inventory.primary).toBeNull();
    expect(alpha.activeSlot).toBe('secondary');
    const dropped = match.getPickups().filter((pickup) => pickup.kind === 'dropped');
    expect(dropped).toHaveLength(1);
    expect(dropped[0]?.weapon).toBe('ak47');
    expect(dropped[0]?.ammo).toBe(30);

    alpha.position = vec3(12, 0, 12);
    alpha.velocity = vec3();
    switchWeapon(alpha, 'knife');
    match.setInput(alphaId, makeInput({ seq: 2, drop: true }), 1_500);
    match.tick(1_500, 1 / 30);
    expect(match.getPickups().filter((pickup) => pickup.kind === 'dropped')).toHaveLength(1);
  });

  it('drops on G without auto-picking a nearby spawn', () => {
    const map = makeFlatMap([{ id: 'm4', weapon: 'm4a1', position: vec3(0, 0.9, 0) }]);
    const match = new Match({ map, seed: 1, config: { countdownMs: 10, fragLimit: 16 } });
    const first = match.join('socket-a', { name: 'Alpha' }, 1_000);
    const second = match.join('socket-b', { name: 'Bravo' }, 1_000);
    if (first.player === null || second.player === null) {
      throw new Error('Missing players');
    }
    match.tick(1_011, 1 / 30);
    match.tick(1_020, 1 / 30);
    first.player.position = vec3(0, 0, 0);
    first.player.velocity = vec3();

    match.setInput(first.player.id, makeInput({ seq: 1, drop: true }), 1_100);
    match.tick(1_100, 1 / 30);

    expect(first.player.inventory.primary).toBeNull();
    expect(first.player.inventory.secondary).toBeNull();
    expect(first.player.activeSlot).toBe('knife');
    expect(match.getPickups().find((pickup) => pickup.id === 'spawn:m4')?.available).toBe(true);
    const dropped = match.getPickups().filter((pickup) => pickup.kind === 'dropped');
    expect(dropped).toHaveLength(1);
    expect(dropped[0]?.weapon).toBe('glock');
  });

  it('picks up a dropped weapon on E', () => {
    const { match, alphaId } = createLiveMatch();
    const alpha = match.getPlayer(alphaId);
    if (alpha === undefined) {
      throw new Error('Missing alpha');
    }
    addWeapon(alpha, 'ak47');
    alpha.position = vec3(10, 0, 10);
    alpha.velocity = vec3();

    match.setInput(alphaId, makeInput({ seq: 1, drop: true }), 1_200);
    match.tick(1_200, 1 / 30);
    expect(alpha.inventory.primary).toBeNull();

    match.setInput(alphaId, makeInput({ seq: 2, use: true }), 1_500);
    match.tick(1_500, 1 / 30);
    expect(alpha.inventory.primary?.id).toBe('ak47');
    expect(alpha.activeSlot).toBe('primary');
    expect(match.getPickups().filter((pickup) => pickup.kind === 'dropped')).toHaveLength(0);
  });

  it('keeps the winner loadout and clears the loser for the next round', () => {
    const { match, alphaId, bravoId } = createLiveMatch({ roundResetMs: 100 });
    const bravo = match.getPlayer(bravoId);
    if (bravo === undefined) {
      throw new Error('Missing bravo');
    }
    addWeapon(bravo, 'ak47');
    addWeapon(bravo, 'hegrenade');
    addWeapon(bravo, 'flashbang');
    addWeapon(bravo, 'smokegrenade');
    aimAtBravo(match, alphaId, bravoId, 1_200);
    match.tick(1_200, 1 / 30);
    expect(match.currentPhase).toBe('round_over');
    expect(bravo.alive).toBe(false);
    expect(bravo.inventory.primary?.id).toBe('ak47');
    const dropped = match.getPickups().filter((pickup) => pickup.kind === 'dropped');
    expect(dropped).toHaveLength(5);
    expect(dropped.map((pickup) => pickup.weapon)).toEqual(
      expect.arrayContaining(['ak47', 'usp', 'hegrenade', 'flashbang', 'smokegrenade']),
    );

    match.tick(1_301, 1 / 30);
    expect(match.currentPhase).toBe('live');
    expect(bravo.alive).toBe(true);
    expect(bravo.inventory.primary).toBeNull();
    expect(match.getPlayer(alphaId)?.inventory.primary?.id).toBe('ak47');
  });

  it('processes switch and reload actions even when idle frames arrive first', () => {
    const { match, alphaId } = createLiveMatch();
    const alpha = match.getPlayer(alphaId);
    if (alpha === undefined) {
      throw new Error('Missing alpha');
    }
    addWeapon(alpha, 'ak47');
    switchWeapon(alpha, 'secondary');

    match.setInput(alphaId, makeInput({ seq: 1, switchTo: 'primary' }), 1_200);
    match.setInput(alphaId, makeInput({ seq: 2, switchTo: null }), 1_210);
    match.tick(1_220, 1 / 30);
    expect(alpha.activeSlot).toBe('primary');

    if (alpha.inventory.primary === null) {
      throw new Error('Missing primary weapon');
    }
    alpha.inventory.primary.ammo = 10;
    match.setInput(alphaId, makeInput({ seq: 3, reload: true }), 1_300);
    match.setInput(alphaId, makeInput({ seq: 4, reload: false }), 1_310);
    match.tick(1_320, 1 / 30);
    expect(alpha.reloadingUntil).not.toBeNull();
  });

  it('buffers a jump press across input frames', () => {
    const { match, alphaId } = createLiveMatch();
    const alpha = match.getPlayer(alphaId);
    if (alpha === undefined) {
      throw new Error('Missing alpha');
    }
    match.setInput(alphaId, makeInput({ seq: 1, jump: true }), 1_100);
    match.setInput(alphaId, makeInput({ seq: 2, jump: false }), 1_110);
    match.tick(1_120, 1 / 30);
    expect(alpha.grounded).toBe(false);
    expect(alpha.velocity.y).toBeGreaterThan(0);
  });

  it('ignores duplicate and decreasing input sequences', () => {
    const { match, alphaId } = createLiveMatch();
    expect(match.setInput(alphaId, makeInput({ seq: 2 }), 1_200)).toBe(true);
    expect(match.setInput(alphaId, makeInput({ seq: 2 }), 1_201)).toBe(false);
    expect(match.setInput(alphaId, makeInput({ seq: 1 }), 1_202)).toBe(false);
    expect(match.setInput(alphaId, makeInput({ seq: 3 }), 1_203)).toBe(true);
  });

  it('starts both players with zero armor and their team pistol', () => {
    const { alpha, bravo } = createLiveMatch();
    if (alpha === undefined || bravo === undefined) {
      throw new Error('Missing players');
    }
    expect(alpha.armor).toBe(0);
    expect(bravo.armor).toBe(0);
    expect(alpha.inventory.secondary?.id).toBe('glock');
    expect(bravo.inventory.secondary?.id).toBe('usp');
  });

  it('picks up armor once and restores pickups only for the next round', () => {
    const map = makeFlatMap(
      [{ id: 'm4', weapon: 'm4a1', position: vec3(0, 0.9, 0) }],
      [{ id: 'armor', amount: 100, position: vec3(0, 0.9, 0) }],
    );
    const { match, alphaId, alpha, bravoId } = createLiveMatch(
      { roundResetMs: 100, respawnMs: 50, fragLimit: 16 },
      map,
    );
    if (alpha === undefined) {
      throw new Error('Missing alpha');
    }

    alpha.position = vec3(0, 0, 0);
    alpha.velocity = vec3();
    match.tick(1_100, 1 / 30);

    expect(alpha.armor).toBe(100);
    expect(alpha.inventory.primary?.id).toBe('m4a1');
    expect(match.getArmorPickups().find((pickup) => pickup.id === 'armor')?.available).toBe(false);
    expect(match.getPickups().find((pickup) => pickup.id === 'spawn:m4')?.available).toBe(false);
    expect(match.getSnapshot(1_100).armorPickups).toHaveLength(0);
    expect(match.getSnapshot(1_100).pickups).toHaveLength(0);
    expect(
      match
        .drainEvents()
        .some((event) => event.type === 'armor_pickup' && event.event.playerId === alphaId),
    ).toBe(true);

    match.tick(5_000, 1 / 30);
    expect(match.getArmorPickups().find((pickup) => pickup.id === 'armor')?.available).toBe(false);
    expect(match.getPickups().find((pickup) => pickup.id === 'spawn:m4')?.available).toBe(false);

    aimAtBravo(match, alphaId, bravoId, 5_100);
    match.tick(5_100, 1 / 30);
    expect(match.currentPhase).toBe('round_over');

    match.tick(5_201, 1 / 30);
    expect(match.currentPhase).toBe('live');
    expect(alpha.armor).toBe(100);
    expect(alpha.inventory.primary?.id).toBe('ak47');
    expect(match.getArmorPickups().find((pickup) => pickup.id === 'armor')?.available).toBe(true);
    expect(match.getPickups().find((pickup) => pickup.id === 'spawn:m4')?.available).toBe(true);
    expect(match.getSnapshot(5_201).armorPickups).toHaveLength(1);
    expect(match.getSnapshot(5_201).pickups).toHaveLength(1);
  });
});

describe('match CS weapon mechanics', () => {
  it('fires a semi-automatic pistol only on a new press', () => {
    const { match, alphaId, bravoId } = createLiveMatch();
    const alpha = match.getPlayer(alphaId);
    const bravo = match.getPlayer(bravoId);
    if (alpha === undefined || bravo === undefined) {
      throw new Error('Missing players');
    }
    alpha.position = vec3(0, 0, -4);
    bravo.position = vec3(0, 0, 4);
    alpha.velocity = vec3();
    bravo.velocity = vec3();
    bravo.health = 1_000;

    match.setInput(
      alphaId,
      makeInput({ seq: 1, clientTime: 1_500, yaw: Math.PI, pitch: -0.08, fire: true }),
      1_500,
    );
    match.tick(1_500, 1 / 30);
    expect(match.drainEvents().filter((event) => event.type === 'shot')).toHaveLength(1);

    match.setInput(
      alphaId,
      makeInput({ seq: 2, clientTime: 1_800, yaw: Math.PI, pitch: -0.08, fire: true }),
      1_800,
    );
    match.tick(1_800, 1 / 30);
    expect(match.drainEvents().filter((event) => event.type === 'shot')).toHaveLength(0);

    match.setInput(
      alphaId,
      makeInput({ seq: 3, clientTime: 1_850, yaw: Math.PI, pitch: -0.08, fire: false }),
      1_850,
    );
    match.tick(1_850, 1 / 30);
    match.setInput(
      alphaId,
      makeInput({ seq: 4, clientTime: 1_900, yaw: Math.PI, pitch: -0.08, fire: true }),
      1_900,
    );
    match.tick(1_900, 1 / 30);
    expect(match.drainEvents().filter((event) => event.type === 'shot')).toHaveLength(1);
  });

  it('fires a semi-automatic pistol on a quick tap released before the tick', () => {
    const { match, alphaId, bravoId } = createLiveMatch();
    const alpha = match.getPlayer(alphaId);
    const bravo = match.getPlayer(bravoId);
    if (alpha === undefined || bravo === undefined) {
      throw new Error('Missing players');
    }
    alpha.position = vec3(0, 0, -4);
    alpha.velocity = vec3();
    bravo.position = vec3(0, 0, 4);
    bravo.velocity = vec3();
    bravo.health = 1_000;
    bravo.armor = 0;
    bravo.history = [];

    match.setInput(
      alphaId,
      makeInput({ seq: 1, clientTime: 1_200, yaw: Math.PI, pitch: -0.08, fire: true }),
      1_200,
    );
    match.setInput(
      alphaId,
      makeInput({ seq: 2, clientTime: 1_210, yaw: 0, pitch: 0, scoped: true, fire: false }),
      1_210,
    );
    match.tick(1_220, 1 / 30);

    const events = match.drainEvents();
    expect(events.filter((event) => event.type === 'shot')).toHaveLength(1);
    const hit = events.find((event) => event.type === 'hit' && event.event.source === 'weapon');
    expect(hit?.type).toBe('hit');
    if (hit?.type === 'hit') {
      expect(hit.event.victimId).toBe(bravoId);
    }
  });

  it('fires an automatic rifle exactly once on a quick tap', () => {
    const { match, alphaId, bravoId } = createLiveMatch();
    const alpha = match.getPlayer(alphaId);
    const bravo = match.getPlayer(bravoId);
    if (alpha === undefined || bravo === undefined) {
      throw new Error('Missing players');
    }
    alpha.position = vec3(0, 0, -4);
    alpha.velocity = vec3();
    bravo.position = vec3(0, 0, 4);
    bravo.velocity = vec3();
    bravo.health = 1_000;
    bravo.armor = 0;
    bravo.history = [];
    addWeapon(alpha, 'ak47');

    match.setInput(
      alphaId,
      makeInput({ seq: 1, clientTime: 1_200, yaw: Math.PI, pitch: -0.08, fire: true }),
      1_200,
    );
    match.setInput(
      alphaId,
      makeInput({ seq: 2, clientTime: 1_210, yaw: 0, pitch: 0, scoped: true, fire: false }),
      1_210,
    );
    match.tick(1_220, 1 / 30);

    const events = match.drainEvents();
    expect(events.filter((event) => event.type === 'shot')).toHaveLength(1);
    const hit = events.find((event) => event.type === 'hit' && event.event.source === 'weapon');
    expect(hit?.type).toBe('hit');
    if (hit?.type === 'hit') {
      expect(hit.event.victimId).toBe(bravoId);
    }
  });

  it('rewinds targets using aimTime instead of clientTime', () => {
    const { match, alphaId, bravoId } = createLiveMatch({ lagCompensationMs: 200 });
    const alpha = match.getPlayer(alphaId);
    const bravo = match.getPlayer(bravoId);
    if (alpha === undefined || bravo === undefined) {
      throw new Error('Missing players');
    }
    alpha.position = vec3(0, 0, -4);
    alpha.velocity = vec3();
    bravo.position = vec3(12, 0, 4);
    bravo.velocity = vec3();
    bravo.health = 1_000;
    bravo.armor = 0;
    bravo.history = [
      { time: 1_100, position: vec3(0, 0, 4), height: 1.8, alive: true },
      { time: 1_200, position: vec3(12, 0, 4), height: 1.8, alive: true },
    ];

    match.setInput(
      alphaId,
      makeInput({
        seq: 1,
        clientTime: 1_200,
        aimTime: 1_100,
        yaw: Math.PI,
        pitch: -0.08,
        fire: true,
      }),
      1_200,
    );
    match.tick(1_200, 1 / 30);

    const shot = match.drainEvents().find((event) => event.type === 'shot');
    expect(shot?.type).toBe('shot');
    if (shot?.type === 'shot') {
      expect(shot.event.hitPlayerId).toBe(bravoId);
    }
  });

  it('clamps aimTime to the lag-compensation window', () => {
    const { match, alphaId, bravoId } = createLiveMatch({ lagCompensationMs: 200 });
    const alpha = match.getPlayer(alphaId);
    const bravo = match.getPlayer(bravoId);
    if (alpha === undefined || bravo === undefined) {
      throw new Error('Missing players');
    }
    alpha.position = vec3(0, 0, -4);
    alpha.velocity = vec3();
    bravo.position = vec3(12, 0, 4);
    bravo.velocity = vec3();
    bravo.health = 1_000;
    bravo.armor = 0;
    bravo.history = [
      { time: 1_000, position: vec3(0, 0, 4), height: 1.8, alive: true },
      { time: 1_200, position: vec3(12, 0, 4), height: 1.8, alive: true },
    ];

    match.setInput(
      alphaId,
      makeInput({
        seq: 1,
        clientTime: 1_500,
        aimTime: 1_000,
        yaw: Math.PI,
        pitch: -0.08,
        fire: true,
      }),
      1_500,
    );
    match.tick(1_500, 1 / 30);

    // aimTime is clamped to 1_300, so the oldest sample in range is the far
    // position at 1_200 rather than the target's old position at 1_000.
    const shot = match.drainEvents().find((event) => event.type === 'shot');
    expect(shot?.type).toBe('shot');
    if (shot?.type === 'shot') {
      expect(shot.event.hitPlayerId).toBeNull();
    }
  });

  it('drops a queued shot that is older than the pending-fire TTL', () => {
    const { match, alphaId } = createLiveMatch();
    const alpha = match.getPlayer(alphaId);
    if (alpha === undefined) {
      throw new Error('Missing alpha');
    }
    alpha.position = vec3(0, 0, -4);
    alpha.velocity = vec3();

    match.setInput(
      alphaId,
      makeInput({ seq: 1, clientTime: 1_200, yaw: Math.PI, fire: true }),
      1_200,
    );
    match.tick(1_500, 1 / 30);

    expect(match.drainEvents().some((event) => event.type === 'shot')).toBe(false);
  });

  it('throws a grenade on a quick tap released before the tick', () => {
    const { match, alphaId } = createLiveMatch();
    const alpha = match.getPlayer(alphaId);
    if (alpha === undefined) {
      throw new Error('Missing alpha');
    }
    addWeapon(alpha, 'hegrenade');
    expect(switchWeapon(alpha, 'grenade')).toBe(true);

    match.setInput(alphaId, makeInput({ seq: 1, clientTime: 1_400, yaw: 0, fire: true }), 1_400);
    match.setInput(alphaId, makeInput({ seq: 2, clientTime: 1_410, yaw: 0, fire: false }), 1_410);
    match.tick(1_420, 1 / 30);

    expect(alpha.inventory.grenade).toBeNull();
    expect(match.drainEvents().some((event) => event.type === 'grenade_thrown')).toBe(true);
  });

  it('keeps scoped state only while the AWP is active', () => {
    const { match, alphaId } = createLiveMatch();
    const alpha = match.getPlayer(alphaId);
    if (alpha === undefined) {
      throw new Error('Missing alpha');
    }
    addWeapon(alpha, 'awp');

    match.setInput(alphaId, makeInput({ seq: 1, scoped: true }), 1_500);
    match.tick(1_500, 1 / 30);
    expect(alpha.scoped).toBe(true);

    match.setInput(alphaId, makeInput({ seq: 2, scoped: true, switchTo: 'secondary' }), 1_530);
    match.tick(1_530, 1 / 30);
    expect(alpha.activeSlot).toBe('secondary');
    expect(alpha.inventory.secondary?.id).toBe('glock');
    expect(alpha.scoped).toBe(false);
  });

  it('throws and explodes an HE grenade after its fuse', () => {
    const { match, alphaId, bravoId } = createLiveMatch();
    const alpha = match.getPlayer(alphaId);
    const bravo = match.getPlayer(bravoId);
    if (alpha === undefined || bravo === undefined) {
      throw new Error('Missing players');
    }
    alpha.position = vec3(0, 0, 0);
    bravo.position = vec3(1, 0, 0);
    alpha.velocity = vec3();
    bravo.velocity = vec3();
    addWeapon(alpha, 'hegrenade');
    expect(alpha.activeSlot).not.toBe('grenade');
    expect(switchWeapon(alpha, 'grenade')).toBe(true);

    match.setInput(
      alphaId,
      makeInput({
        seq: 1,
        clientTime: 1_600,
        yaw: 0,
        pitch: -Math.PI / 2 + 0.01,
        fire: true,
      }),
      1_600,
    );
    match.tick(1_600, 1 / 30);
    expect(alpha.inventory.grenade).toBeNull();
    expect(match.drainEvents().some((event) => event.type === 'grenade_thrown')).toBe(true);

    match.setInput(alphaId, makeInput({ seq: 2, clientTime: 1_601, fire: false }), 1_601);
    for (const time of [1_700, 1_733, 1_766]) {
      match.tick(time, 1 / 30);
    }
    expect(match.getGrenades()[0]?.position.y).toBeGreaterThan(0.1);

    match.tick(3_101, 1 / 30);
    const events = match.drainEvents();
    expect(events.some((event) => event.type === 'explosion')).toBe(true);
    expect(events.some((event) => event.type === 'hit' && event.event.source === 'grenade')).toBe(
      true,
    );
    expect(alpha.health).toBeLessThan(100);
    expect(bravo.health).toBeLessThan(100);
  });

  it('extinguishes a molotov when a smoke grenade lands on it', () => {
    const { match, alphaId, bravoId } = createLiveMatch();
    const alpha = match.getPlayer(alphaId);
    const bravo = match.getPlayer(bravoId);
    if (alpha === undefined || bravo === undefined) {
      throw new Error('Missing players');
    }
    alpha.position = vec3(0, 0, 0);
    alpha.velocity = vec3();
    alpha.health = 1_000;
    bravo.position = vec3(10, 0, 0);
    bravo.velocity = vec3();

    addWeapon(alpha, 'molotov');
    expect(switchWeapon(alpha, 'grenade')).toBe(true);
    match.setInput(
      alphaId,
      makeInput({
        seq: 1,
        clientTime: 1_600,
        yaw: 0,
        pitch: -Math.PI / 2 + 0.01,
        fire: true,
      }),
      1_600,
    );
    match.tick(1_600, 1 / 30);
    match.setInput(alphaId, makeInput({ seq: 2, clientTime: 1_601, fire: false }), 1_601);
    match.tick(1_601, 1 / 30);
    match.tick(3_101, 1 / 30);
    expect(match.getAreaEffects().some((zone) => zone.type === 'molotov')).toBe(true);

    addWeapon(alpha, 'smokegrenade');
    expect(switchWeapon(alpha, 'grenade')).toBe(true);
    match.setInput(
      alphaId,
      makeInput({
        seq: 3,
        clientTime: 3_200,
        yaw: 0,
        pitch: -Math.PI / 2 + 0.01,
        fire: true,
      }),
      3_200,
    );
    match.tick(3_200, 1 / 30);
    match.setInput(alphaId, makeInput({ seq: 4, clientTime: 3_201, fire: false }), 3_201);
    match.tick(3_201, 1 / 30);
    match.tick(4_701, 1 / 30);

    const zones = match.getAreaEffects();
    expect(zones.some((zone) => zone.type === 'smokegrenade')).toBe(true);
    expect(zones.some((zone) => zone.type === 'molotov' || zone.type === 'incendiary')).toBe(false);
  });

  it('does not create fire inside an active smoke cloud', () => {
    const { match, alphaId, bravoId } = createLiveMatch();
    const alpha = match.getPlayer(alphaId);
    const bravo = match.getPlayer(bravoId);
    if (alpha === undefined || bravo === undefined) {
      throw new Error('Missing players');
    }
    alpha.position = vec3(0, 0, 0);
    alpha.velocity = vec3();
    alpha.health = 1_000;
    bravo.position = vec3(10, 0, 0);
    bravo.velocity = vec3();

    addWeapon(alpha, 'smokegrenade');
    expect(switchWeapon(alpha, 'grenade')).toBe(true);
    match.setInput(
      alphaId,
      makeInput({
        seq: 1,
        clientTime: 1_600,
        yaw: 0,
        pitch: -Math.PI / 2 + 0.01,
        fire: true,
      }),
      1_600,
    );
    match.tick(1_600, 1 / 30);
    match.setInput(alphaId, makeInput({ seq: 2, clientTime: 1_601, fire: false }), 1_601);
    match.tick(1_601, 1 / 30);
    match.tick(3_101, 1 / 30);
    expect(match.getAreaEffects().some((zone) => zone.type === 'smokegrenade')).toBe(true);

    addWeapon(alpha, 'molotov');
    expect(switchWeapon(alpha, 'grenade')).toBe(true);
    match.setInput(
      alphaId,
      makeInput({
        seq: 3,
        clientTime: 3_200,
        yaw: 0,
        pitch: -Math.PI / 2 + 0.01,
        fire: true,
      }),
      3_200,
    );
    match.tick(3_200, 1 / 30);
    match.setInput(alphaId, makeInput({ seq: 4, clientTime: 3_201, fire: false }), 3_201);
    match.tick(3_201, 1 / 30);
    match.tick(4_701, 1 / 30);

    const zones = match.getAreaEffects();
    expect(zones.some((zone) => zone.type === 'smokegrenade')).toBe(true);
    expect(zones.some((zone) => zone.type === 'molotov')).toBe(false);
  });

  it('applies fall damage and reports it as a fall source', () => {
    const { match, alphaId } = createLiveMatch();
    const alpha = match.getPlayer(alphaId);
    if (alpha === undefined) {
      throw new Error('Missing alpha');
    }
    alpha.position = vec3(0, 8, 0);
    alpha.velocity = vec3();
    alpha.grounded = false;
    match.setInput(alphaId, makeInput({ seq: 1 }), 1_500);

    for (let index = 0; index < 90; index += 1) {
      match.tick(1_500 + index * 33, 1 / 30);
    }
    expect(alpha.health).toBeLessThan(100);
    expect(
      match.drainEvents().some((event) => event.type === 'hit' && event.event.source === 'fall'),
    ).toBe(true);
  });
});

describe('match admin controls', () => {
  it('switches to a known map and resets the lobby', () => {
    const { match, alphaId } = createLiveMatch();
    const alpha = match.getPlayer(alphaId);
    if (alpha === undefined) {
      throw new Error('Missing alpha');
    }

    const nextMap = match.switchMap(' FY_SAND ', 2_000);
    expect(nextMap?.id).toBe('fy_sand');
    expect(match.currentPhase).toBe('lobby');
    expect(match.getMapId()).toBe('fy_sand');
    expect(match.getLobbyState().mapName).toBe('fy_sand');
    expect(match.getPlayers()).toHaveLength(2);
    expect(alpha.armor).toBe(0);
    expect(alpha.inventory.secondary?.id).toBe('glock');
    expect(alpha.position.x).toBeLessThan(0);
    expect(match.getPickups()).toHaveLength(16);
    expect(match.getArmorPickups()).toHaveLength(2);

    expect(match.switchMap('de_unknown', 2_100)).toBeNull();
    expect(match.getMapId()).toBe('fy_sand');
  });

  it('kicks a player, frees the slot, and lets a replacement join', () => {
    const { match, alphaId } = createLiveMatch();

    expect(match.kickPlayer(alphaId, 2_000)).toBe(true);
    expect(match.getPlayer(alphaId)).toBeUndefined();
    expect(match.getPlayers()).toHaveLength(1);
    expect(match.currentPhase).toBe('lobby');
    expect(match.kickPlayer('missing-player', 2_100)).toBe(false);

    const replacement = match.join('socket-charlie', { name: 'Charlie' }, 2_200);
    expect(replacement.result.ok).toBe(true);
    expect(replacement.player?.team).toBe('alpha');
    expect(match.getPlayers()).toHaveLength(2);
  });

  it('finds players by partial name, exact name, and id prefix', () => {
    const { match, alphaId, bravoId } = createLiveMatch();

    expect(match.findPlayers('alp').map((player) => player.id)).toContain(alphaId);
    expect(match.findPlayers('BRAVO').map((player) => player.id)).toContain(bravoId);
    expect(match.findPlayers(alphaId.slice(0, 8)).map((player) => player.id)).toContain(alphaId);
    expect(match.findPlayers('   ')).toEqual([]);
    expect(match.findPlayers('nobody')).toEqual([]);
  });

  it('restarts an ended match and force-ends a live one', () => {
    const { match, alphaId } = createLiveMatch({ fragLimit: 1 });
    const alpha = match.getPlayer(alphaId);
    if (alpha === undefined) {
      throw new Error('Missing alpha');
    }

    alpha.kills = 1;
    match.tick(1_200, 1 / 30);
    expect(match.currentPhase).toBe('ended');

    match.restart(1_300);
    expect(match.currentPhase).toBe('countdown');
    expect(match.getLobbyState().round).toBe(1);
    expect(match.getLobbyState().scores).toEqual({ alpha: 0, bravo: 0 });
    expect(alpha.kills).toBe(0);
    expect(alpha.deaths).toBe(0);

    match.forceEnd(1_400);
    expect(match.currentPhase).toBe('ended');
  });
});
