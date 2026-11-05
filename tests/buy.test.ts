import { describe, expect, it } from 'vitest';
import { ECONOMY, BUY, BUY_ITEMS, getBuyItem } from '../shared/economy';
import { vec3 } from '../shared/math';
import type { ArenaMap } from '../shared/map';
import { Match } from '../server/game/match';
import { addWeapon, getGrenadeCount, removeGrenade } from '../server/game/inventory';
import type { MatchConfig } from '../shared/config';
import { makeFlatMap, makeInput } from './helpers';

function buyMap(): ArenaMap {
  return {
    ...makeFlatMap(
      [{ id: 'test-rifle', weapon: 'ak47', position: vec3(0, 0.5, 0) }],
      [{ id: 'test-armor', amount: 100, position: vec3(0, 0.5, 1) }],
    ),
    mode: 'buy',
  };
}

function makeMatch(config: Partial<MatchConfig> = {}): Match {
  return new Match({
    map: buyMap(),
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

function createLiveMatch(config: Partial<MatchConfig> = {}) {
  const match = makeMatch(config);
  const first = match.join('socket-alpha', { name: 'Alpha' }, 1_000);
  const second = match.join('socket-bravo', { name: 'Bravo' }, 1_000);
  if (first.player === null || second.player === null) {
    throw new Error('Failed to create players');
  }
  match.drainEvents();
  match.tick(1_051, 1 / 30);
  match.tick(1_060, 1 / 30);
  match.drainEvents();
  const alpha = match.getPlayer(first.player.id);
  const bravo = match.getPlayer(second.player.id);
  if (alpha === undefined || bravo === undefined) {
    throw new Error('Missing players');
  }
  return { match, alpha, bravo, alphaId: alpha.id, bravoId: bravo.id };
}

function finishLiveRound(match: Match, now: number): number {
  const live = match.getSnapshot(now);
  const roundEnd = live.match.roundEndsAt;
  if (roundEnd === null) {
    throw new Error('Round is not live');
  }
  match.tick(roundEnd + 1, 1 / 30);
  const over = match.getSnapshot(roundEnd + 1);
  const roundOverEnd = over.match.roundOverEndsAt;
  if (roundOverEnd === null) {
    throw new Error('Round did not enter round_over');
  }
  match.tick(roundOverEnd + 1, 1 / 30);
  const countdown = match.getSnapshot(roundOverEnd + 1);
  const countdownEnd = countdown.match.countdownEndsAt;
  if (countdownEnd === null) {
    throw new Error('Round did not enter countdown');
  }
  match.tick(countdownEnd + 1, 1 / 30);
  return countdownEnd + 1;
}

describe('buy mode', () => {
  it('derives the mode from fy_wow and starts with the CS economy', () => {
    const { match, alpha, bravo } = createLiveMatch();
    const snapshot = match.getSnapshot(1_060);
    expect(snapshot.match.mode).toBe('buy');
    expect(snapshot.match.roundsToWin).toBe(BUY.roundsToWin);
    expect(snapshot.match.sideSwapAfterRound).toBe(BUY.sideSwapAfterRound);
    expect(match.getPickups()).toEqual([]);
    expect(match.getArmorPickups()).toEqual([]);
    expect(snapshot.match.buyEndsAt).toBe(1_000 + 50 + BUY.buyTimeMs);
    expect(snapshot.match.roundEndsAt).toBe(1_051 + BUY.roundTimeMs);
    expect(alpha.money).toBe(ECONOMY.startMoney);
    expect(alpha.side).toBe('t');
    expect(bravo.side).toBe('ct');
  });

  it('keeps the live buy window when a countdown pause resumes', () => {
    const match = makeMatch({ countdownMs: 3_000 });
    const first = match.join('socket-alpha', { name: 'Alpha' }, 1_000);
    match.join('socket-bravo', { name: 'Bravo' }, 1_000);
    if (first.player === null) {
      throw new Error('Failed to create player');
    }
    const alpha = match.getPlayer(first.player.id);
    if (alpha === undefined) {
      throw new Error('Missing player');
    }

    match.disconnect(alpha.id, 2_000);
    expect(match.currentPhase).toBe('paused');
    const resumed = match.join(
      'socket-alpha-new',
      { name: 'Alpha', playerId: alpha.id, sessionToken: alpha.sessionToken },
      2_500,
    );
    expect(resumed.result.resumed).toBe(true);
    expect(match.currentPhase).toBe('countdown');
    expect(match.getSnapshot(2_500).match.buyEndsAt).toBe(2_500 + 3_000 + BUY.buyTimeMs);

    match.tick(5_501, 1 / 30);
    expect(match.currentPhase).toBe('live');
    expect(match.getSnapshot(5_501).match.buyEndsAt).toBe(2_500 + 3_000 + BUY.buyTimeMs);
  });

  it('allows buying, switching, and reloading during the freeze countdown', () => {
    const match = makeMatch({ countdownMs: 3_000 });
    const first = match.join('socket-alpha', { name: 'Alpha' }, 1_000);
    match.join('socket-bravo', { name: 'Bravo' }, 1_000);
    if (first.player === null) {
      throw new Error('Failed to create player');
    }
    const alpha = match.getPlayer(first.player.id);
    if (alpha === undefined) {
      throw new Error('Missing player');
    }
    expect(match.currentPhase).toBe('countdown');

    expect(match.buy(first.player.id, 'p250', 1_100)?.ok).toBe(true);
    const secondary = alpha.inventory.secondary;
    if (secondary === null) {
      throw new Error('Missing secondary weapon');
    }
    secondary.ammo = 1;
    secondary.reserve = 12;

    match.setInput(
      first.player.id,
      makeInput({ seq: 1, clientTime: 1_150, switchTo: 'knife' }),
      1_150,
    );
    match.tick(1_160, 1 / 30);
    expect(alpha.activeSlot).toBe('knife');

    match.setInput(
      first.player.id,
      makeInput({ seq: 2, clientTime: 1_200, switchTo: 'secondary', reload: true }),
      1_200,
    );
    match.tick(1_220, 1 / 30);
    expect(alpha.activeSlot).toBe('secondary');
    expect(alpha.reloadingUntil).not.toBeNull();

    match.tick(3_500, 1 / 30);
    expect(alpha.inventory.secondary?.ammo).toBe(13);
    expect(match.currentPhase).toBe('countdown');
  });

  it('lets a round-over survivor pick up a dropped weapon and reload', () => {
    const { match, alpha, alphaId, bravo } = createLiveMatch({ roundResetMs: 5_000 });
    addWeapon(bravo, 'ak47');
    alpha.position = vec3(0, 0, -4);
    alpha.velocity = vec3();
    bravo.position = vec3(0, 0, 4);
    bravo.velocity = vec3();
    bravo.health = 1;
    bravo.armor = 0;
    bravo.history = [];

    match.setInput(
      alphaId,
      makeInput({ seq: 1, clientTime: 1_200, yaw: Math.PI, pitch: -0.08, fire: true }),
      1_200,
    );
    match.tick(1_200, 1 / 30);
    expect(match.currentPhase).toBe('round_over');
    expect(bravo.alive).toBe(false);

    alpha.position = vec3(0, 0, 4);
    match.setInput(alphaId, makeInput({ seq: 2, clientTime: 1_300, use: true }), 1_300);
    match.tick(1_300, 1 / 30);
    expect(alpha.inventory.primary?.id).toBe('ak47');

    const primary = alpha.inventory.primary;
    if (primary === null) {
      throw new Error('Missing picked-up primary');
    }
    primary.ammo = 1;
    primary.reserve = 30;
    match.setInput(alphaId, makeInput({ seq: 3, clientTime: 1_400, reload: true }), 1_400);
    match.tick(1_420, 1 / 30);
    expect(alpha.reloadingUntil).not.toBeNull();

    match.tick(4_000, 1 / 30);
    expect(alpha.inventory.primary?.ammo).toBe(30);
    expect(match.currentPhase).toBe('round_over');
  });

  it('buys into the occupied slot and refunds only the latest purchase', () => {
    const { match, alphaId, alpha } = createLiveMatch();
    alpha.money = 16_000;
    const result = match.buy(alphaId, 'p250', 1_100);
    expect(result?.ok).toBe(true);
    expect(match.getPlayer(alphaId)?.money).toBe(16_000 - 300);
    expect(match.getPlayer(alphaId)?.inventory.secondary?.id).toBe('p250');
    expect(match.getSnapshot(1_100).players.find((p) => p.id === alphaId)?.lastPurchaseId).toBe(
      'p250',
    );

    expect(match.buy(alphaId, 'deagle', 1_110)?.ok).toBe(true);
    expect(match.refund(alphaId, 'p250', 1_120)?.ok).toBe(false);
    expect(match.refund(alphaId, 'deagle', 1_130)?.ok).toBe(true);
    expect(match.getPlayer(alphaId)?.inventory.secondary?.id).toBe('p250');
    expect(match.getPlayer(alphaId)?.money).toBe(16_000 - 300);
  });

  it('charges only the helmet upgrade when kevlar is already equipped', () => {
    const { match, alphaId, alpha } = createLiveMatch();
    alpha.money = 800;
    alpha.armor = 100;
    alpha.helmet = false;
    expect(match.buy(alphaId, 'kevlar_helmet', 1_100)?.ok).toBe(true);
    expect(alpha.money).toBe(800 - ECONOMY.helmetUpgrade);
    expect(alpha.armor).toBe(100);
    expect(alpha.helmet).toBe(true);
    expect(match.refund(alphaId, 'kevlar_helmet', 1_110)?.ok).toBe(true);
    expect(alpha.money).toBe(800);
    expect(alpha.armor).toBe(100);
    expect(alpha.helmet).toBe(false);
  });

  it('enforces side-specific items, buy zone, and the buy timer', () => {
    const { match, alphaId, alpha } = createLiveMatch();
    alpha.money = 16_000;
    expect(match.buy(alphaId, 'usp', 1_100)?.ok).toBe(false);
    expect(match.buy(alphaId, 'ak47', 1_100)?.ok).toBe(true);

    alpha.position = vec3(10, 0, 10);
    expect(match.buy(alphaId, 'deagle', 1_200)?.ok).toBe(false);

    alpha.position = vec3(-4, 0, -4);
    expect(match.buy(alphaId, 'deagle', 1_300)?.ok).toBe(true);
    expect(match.buy(alphaId, 'p250', 1_060 + BUY.buyTimeMs)?.ok).toBe(false);
  });

  it('enforces grenade type limits and the total grenade cap', () => {
    const { match, alphaId, alpha } = createLiveMatch();
    alpha.money = 16_000;
    expect(match.buy(alphaId, 'flashbang', 1_100)?.ok).toBe(true);
    expect(match.buy(alphaId, 'flashbang', 1_105)?.ok).toBe(true);
    expect(match.buy(alphaId, 'flashbang', 1_110)?.ok).toBe(false);
    expect(match.buy(alphaId, 'hegrenade', 1_115)?.ok).toBe(true);
    expect(match.buy(alphaId, 'smokegrenade', 1_120)?.ok).toBe(true);
    expect(match.buy(alphaId, 'molotov', 1_125)?.ok).toBe(false);
    expect(match.refund(alphaId, 'smokegrenade', 1_130)?.ok).toBe(true);
    expect(match.buy(alphaId, 'molotov', 1_135)?.ok).toBe(true);
  });

  it('refunds an unused grenade without resurrecting a different thrown grenade', () => {
    const { match, alphaId, alpha } = createLiveMatch();
    alpha.money = 16_000;
    expect(match.buy(alphaId, 'hegrenade', 1_100)?.ok).toBe(true);
    expect(match.buy(alphaId, 'flashbang', 1_105)?.ok).toBe(true);
    expect(removeGrenade(alpha, 'hegrenade')).toBe(true);
    alpha.roundGrenadesThrown = 1;

    expect(match.refund(alphaId, 'flashbang', 1_110)?.ok).toBe(true);
    expect(getGrenadeCount(alpha, 'flashbang')).toBe(0);
    expect(getGrenadeCount(alpha, 'hegrenade')).toBe(0);
    expect(alpha.money).toBe(16_000 - 300);

    expect(match.buy(alphaId, 'flashbang', 1_115)?.ok).toBe(true);
    expect(removeGrenade(alpha, 'flashbang')).toBe(true);
    alpha.roundGrenadesThrown += 1;
    expect(match.refund(alphaId, 'flashbang', 1_120)?.ok).toBe(false);
  });

  it('awards the loss bonus, resets it on a win, and pays the kill reward', () => {
    const { match, alphaId, bravoId } = createLiveMatch();
    const live = match.getSnapshot(1_060);
    const roundEnd = live.match.roundEndsAt;
    if (roundEnd === null) {
      throw new Error('Missing round timer');
    }
    match.tick(roundEnd + 1, 1 / 30);
    expect(match.getPlayer(alphaId)?.money).toBe(ECONOMY.startMoney + ECONOMY.lossBonus[0]);
    expect(match.getPlayer(bravoId)?.money).toBe(ECONOMY.startMoney + ECONOMY.winReward);
    expect(match.getPlayer(alphaId)?.lossStreak).toBe(1);

    // A kill pays its weapon reward immediately; the round win pays the
    // remaining economy reward at round end.
    const {
      match: fresh,
      alpha: shooter,
      alphaId: shooterId,
      bravoId: targetId,
    } = createLiveMatch();
    shooter.money = ECONOMY.startMoney;
    shooter.position = vec3(0, 0, -4);
    const target = fresh.getPlayer(targetId);
    if (target === undefined) {
      throw new Error('Missing target');
    }
    target.position = vec3(0, 0, 4);
    target.health = 1;
    target.armor = 0;
    target.history = [];
    addWeapon(shooter, 'ak47');
    fresh.setInput(
      shooterId,
      makeInput({ seq: 1, clientTime: 1_200, yaw: Math.PI, pitch: -0.08, fire: true }),
      1_200,
    );
    fresh.tick(1_200, 1 / 30);
    expect(fresh.currentPhase).toBe('round_over');
    expect(fresh.getPlayer(shooterId)?.money).toBe(
      ECONOMY.startMoney + ECONOMY.killReward.ak47 + ECONOMY.winReward,
    );
    expect(fresh.getPlayer(shooterId)?.lossStreak).toBe(0);
  });

  it('clears dropped grenades and inventory when a player dies and in the next round', () => {
    const {
      match: fresh,
      alpha: shooter,
      alphaId: shooterId,
      bravoId: targetId,
    } = createLiveMatch({ countdownMs: 50, roundResetMs: 100 });
    const target = fresh.getPlayer(targetId);
    if (target === undefined) {
      throw new Error('Missing target');
    }
    target.money = 16_000;
    expect(fresh.buy(targetId, 'hegrenade', 1_100)?.ok).toBe(true);
    expect(fresh.buy(targetId, 'smokegrenade', 1_105)?.ok).toBe(true);
    expect(getGrenadeCount(target, 'hegrenade')).toBe(1);
    expect(getGrenadeCount(target, 'smokegrenade')).toBe(1);

    shooter.position = vec3(0, 0, -4);
    target.position = vec3(0, 0, 4);
    target.health = 1;
    target.armor = 0;
    target.history = [];
    addWeapon(shooter, 'ak47');
    fresh.setInput(
      shooterId,
      makeInput({ seq: 1, clientTime: 1_200, yaw: Math.PI, pitch: -0.08, fire: true }),
      1_200,
    );
    fresh.tick(1_200, 1 / 30);
    expect(fresh.currentPhase).toBe('round_over');
    expect(target.alive).toBe(false);
    expect(getGrenadeCount(target, 'hegrenade')).toBe(0);
    expect(getGrenadeCount(target, 'smokegrenade')).toBe(0);
    expect(target.inventory.grenade).toBeNull();

    // Advance into next round
    fresh.tick(1_200 + 101, 1 / 30); // round_over ends -> countdown
    fresh.tick(1_200 + 101 + 51, 1 / 30); // countdown ends -> live
    expect(fresh.currentPhase).toBe('live');
    expect(target.alive).toBe(true);
    expect(target.inventory.primary).toBeNull();
    expect(getGrenadeCount(target, 'hegrenade')).toBe(0);
    expect(getGrenadeCount(target, 'smokegrenade')).toBe(0);
    expect(target.inventory.grenade).toBeNull();
  });

  it('swaps sides and resets money/loadout after twelve rounds', () => {
    const { match, alphaId, bravoId } = createLiveMatch();
    let now = 1_060;
    for (let round = 0; round < BUY.sideSwapAfterRound; round += 1) {
      now = finishLiveRound(match, now);
    }
    const snapshot = match.getSnapshot(now);
    expect(snapshot.match.round).toBe(BUY.sideSwapAfterRound + 1);
    expect(snapshot.match.scores).toEqual({ alpha: 0, bravo: BUY.sideSwapAfterRound });
    expect(match.getPlayer(alphaId)?.side).toBe('ct');
    expect(match.getPlayer(bravoId)?.side).toBe('t');
    expect(match.getPlayer(alphaId)?.money).toBe(ECONOMY.startMoney);
    expect(match.getPlayer(bravoId)?.money).toBe(ECONOMY.startMoney);
    expect(match.getPlayer(alphaId)?.lossStreak).toBe(0);
    expect(match.getPlayer(bravoId)?.inventory.primary).toBeNull();

    const liveAt = now;
    expect(match.currentPhase).toBe('live');
    const shooter = match.getPlayer(bravoId);
    const target = match.getPlayer(alphaId);
    if (shooter === undefined || target === undefined) {
      throw new Error('Missing players after halftime');
    }
    addWeapon(shooter, 'ak47');
    shooter.position = vec3(0, 0, 4);
    target.position = vec3(0, 0, -4);
    target.health = 1;
    target.armor = 0;
    target.history = [];
    match.setInput(
      bravoId,
      makeInput({ seq: 1, clientTime: liveAt + 200, yaw: 0, pitch: -0.08, fire: true }),
      liveAt + 200,
    );
    match.tick(liveAt + 200, 1 / 30);
    expect(match.currentPhase).toBe('round_over');
    const over = match.getSnapshot(liveAt + 200);
    const roundOverEnd = over.match.roundOverEndsAt;
    if (roundOverEnd === null) {
      throw new Error('Missing round_over timer');
    }
    match.tick(roundOverEnd + 1, 1 / 30);
    const ended = match.getSnapshot(roundOverEnd + 1);
    expect(ended.match.phase).toBe('ended');
    expect(ended.match.scores).toEqual({ alpha: 0, bravo: 13 });
    expect(ended.match.winnerId).toBe(bravoId);
  });

  it('exposes every catalog item and keeps prices consistent', () => {
    expect(BUY_ITEMS.length).toBeGreaterThan(20);
    for (const item of BUY_ITEMS) {
      expect(getBuyItem(item.id)).toEqual(item);
      expect(item.price).toBeGreaterThan(0);
    }
    expect(getBuyItem('ak47')?.price).toBe(2_700);
    expect(getBuyItem('awp')?.price).toBe(4_750);
    expect(getBuyItem('kevlar_helmet')?.gear).toBe('kevlar_helmet');
  });

  it('uses 1:55 round time, 8s freeze time, 5s post-round, and allows combat/drop during round_over', () => {
    expect(BUY.roundTimeMs).toBe(115_000);
    expect(BUY.freezeTimeMs).toBe(8_000);

    const { match, alpha, alphaId, bravo, bravoId } = createLiveMatch();
    const live = match.getSnapshot(1_060);
    const roundEnd = live.match.roundEndsAt;
    if (roundEnd === null) {
      throw new Error('Missing round timer');
    }

    // Expire round time so both players stay alive in round_over
    match.tick(roundEnd + 1, 1 / 30);
    expect(match.currentPhase).toBe('round_over');
    expect(alpha.alive).toBe(true);
    expect(bravo.alive).toBe(true);

    // Alpha buys/Equips an AK47, drops it, and picks it back up during round_over
    addWeapon(alpha, 'ak47');
    alpha.position = vec3(0, 0, -4);
    alpha.velocity = vec3();
    match.setInput(
      alphaId,
      makeInput({ seq: 2, clientTime: roundEnd + 100, drop: true }),
      roundEnd + 100,
    );
    match.tick(roundEnd + 100, 1 / 30);
    expect(alpha.inventory.primary).toBeNull();

    match.setInput(
      alphaId,
      makeInput({ seq: 3, clientTime: roundEnd + 350, use: true }),
      roundEnd + 350,
    );
    match.tick(roundEnd + 350, 1 / 30);
    expect(alpha.inventory.primary?.id).toBe('ak47');

    // Alpha shoots and kills Bravo during round_over
    bravo.position = vec3(0, 0, 4);
    bravo.velocity = vec3();
    bravo.health = 1;
    bravo.armor = 0;
    bravo.history = [];
    match.setInput(
      alphaId,
      makeInput({ seq: 4, clientTime: roundEnd + 500, yaw: Math.PI, pitch: -0.08, fire: true }),
      roundEnd + 500,
    );
    match.tick(roundEnd + 500, 1 / 30);
    expect(match.getPlayer(bravoId)?.alive).toBe(false);
    expect(match.currentPhase).toBe('round_over');
  });
});
