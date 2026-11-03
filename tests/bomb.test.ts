import { describe, expect, it } from 'vitest';
import { BOMB, type MatchConfig } from '../shared/config';
import { BUY, ECONOMY } from '../shared/economy';
import { FY_SAND_MAP, FY_WOW_MAP, findBombSiteAt, type ArenaMap } from '../shared/map';
import { vec3 } from '../shared/math';
import { Match } from '../server/game/match';
import { makeFlatMap, makeInput } from './helpers';

function bombMap(): ArenaMap {
  return {
    ...makeFlatMap(),
    mode: 'buy',
    bombSites: [
      {
        id: 'A',
        name: 'ПЛЕНТ A',
        center: vec3(-6, 0, 0),
        min: vec3(-8, 0, -2),
        max: vec3(-4, 2.6, 2),
      },
      {
        id: 'B',
        name: 'ПЛЕНТ B',
        center: vec3(6, 0, 0),
        min: vec3(4, 0, -2),
        max: vec3(8, 2.6, 2),
      },
    ],
  };
}

function makeMatch(config: Partial<MatchConfig> = {}, map: ArenaMap = bombMap()): Match {
  return new Match({
    map,
    seed: 77,
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

function createLiveMatch(config: Partial<MatchConfig> = {}, map: ArenaMap = bombMap()) {
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

describe('bomb mode (C4)', () => {
  it('defines bomb sites A and B on fy_wow and none on fy_sand', () => {
    expect(FY_SAND_MAP.bombSites).toEqual([]);
    expect(FY_WOW_MAP.bombSites.map((site) => site.id)).toEqual(['A', 'B']);
    for (const site of FY_WOW_MAP.bombSites) {
      expect(site.min.x).toBeLessThan(site.max.x);
      expect(site.min.z).toBeLessThan(site.max.z);
      expect(findBombSiteAt(FY_WOW_MAP, site.center)?.id).toBe(site.id);
    }
    expect(findBombSiteAt(FY_WOW_MAP, vec3(0, 0, 0))).toBeNull();
  });

  it('issues the bomb to T at round start and to the new T after halftime side swap', () => {
    const { match, alpha, bravo } = createLiveMatch();
    expect(alpha.side).toBe('t');
    expect(bravo.side).toBe('ct');
    expect(match.getBomb()?.state).toBe('carried');
    expect(match.getBomb()?.carrierId).toBe(alpha.id);

    let now = 1_060;
    for (let round = 1; round <= BUY.sideSwapAfterRound; round += 1) {
      now = finishLiveRound(match, now);
    }
    expect(alpha.side).toBe('ct');
    expect(bravo.side).toBe('t');
    expect(match.getBomb()?.state).toBe('carried');
    expect(match.getBomb()?.carrierId).toBe(bravo.id);
  });

  it('requires T carrier to be grounded inside a bomb site to plant', () => {
    const { match, alpha, alphaId } = createLiveMatch();

    // Outside site
    alpha.position = vec3(0, 0, 0);
    alpha.grounded = true;
    match.setInput(alphaId, makeInput({ seq: 1, clientTime: 1_100, useHeld: true }), 1_100);
    match.tick(1_100, 1 / 30);
    expect(match.getBomb()?.plantStartedAt).toBeNull();

    // Inside site A, but airborne
    alpha.position = vec3(-6, 0.5, 0);
    alpha.grounded = false;
    match.setInput(alphaId, makeInput({ seq: 2, clientTime: 1_130, useHeld: true }), 1_130);
    match.tick(1_130, 1 / 30);
    expect(match.getBomb()?.plantStartedAt).toBeNull();

    // Inside site A and grounded
    alpha.position = vec3(-6, 0, 0);
    alpha.grounded = true;
    match.setInput(alphaId, makeInput({ seq: 3, clientTime: 1_160, useHeld: true }), 1_160);
    match.tick(1_160, 1 / 30);
    expect(match.getBomb()?.plantStartedAt).toBe(1_160);
    expect(match.getBomb()?.plantEndsAt).toBe(1_160 + BOMB.plantTimeMs);
    expect(match.getBomb()?.siteId).toBe('A');
  });

  it('locks movement and firing while planting, cancels on releasing E, and completes after 3s', () => {
    const { match, alpha, alphaId } = createLiveMatch();
    alpha.position = vec3(-6, 0, 0);
    alpha.grounded = true;
    const initialAmmo = alpha.inventory.secondary?.ammo ?? 0;

    match.setInput(
      alphaId,
      makeInput({
        seq: 1,
        clientTime: 1_100,
        useHeld: true,
        forward: 1,
        strafe: 1,
        jump: true,
        fire: true,
      }),
      1_100,
    );
    match.tick(1_100, 1 / 30);
    expect(match.getBomb()?.plantStartedAt).toBe(1_100);
    expect(alpha.position.x).toBeCloseTo(-6, 5);
    expect(alpha.position.z).toBeCloseTo(0, 5);
    expect(alpha.inventory.secondary?.ammo).toBe(initialAmmo);

    // Release E before 3s -> cancels
    match.setInput(alphaId, makeInput({ seq: 2, clientTime: 2_000, useHeld: false }), 2_000);
    match.tick(2_000, 1 / 30);
    expect(match.getBomb()?.state).toBe('carried');
    expect(match.getBomb()?.plantStartedAt).toBeNull();

    // Start again and hold for full 3s
    match.setInput(alphaId, makeInput({ seq: 3, clientTime: 2_100, useHeld: true }), 2_100);
    match.tick(2_100, 1 / 30);
    const plantEnd = 2_100 + BOMB.plantTimeMs;
    match.setInput(alphaId, makeInput({ seq: 4, clientTime: plantEnd, useHeld: true }), plantEnd);
    match.tick(plantEnd, 1 / 30);

    const bomb = match.getBomb();
    expect(bomb?.state).toBe('planted');
    expect(bomb?.siteId).toBe('A');
    expect(bomb?.plantedAt).toBe(plantEnd);
    expect(bomb?.explodeAt).toBe(plantEnd + BOMB.fuseTimeMs);
    expect(alpha.money).toBe(ECONOMY.startMoney + ECONOMY.plantReward);
  });

  it('detonates after 30s fuse, deals explosion damage, and awards T round win with bombWinReward', () => {
    const { match, alpha, bravo, alphaId } = createLiveMatch();
    alpha.position = vec3(-6, 0, 0);
    alpha.grounded = true;
    bravo.position = vec3(-5.5, 0, 0);

    match.setInput(alphaId, makeInput({ seq: 1, clientTime: 1_100, useHeld: true }), 1_100);
    match.tick(1_100, 1 / 30);
    const plantEnd = 1_100 + BOMB.plantTimeMs;
    match.setInput(alphaId, makeInput({ seq: 2, clientTime: plantEnd, useHeld: true }), plantEnd);
    match.tick(plantEnd, 1 / 30);
    expect(match.getBomb()?.state).toBe('planted');

    // Move alpha far away so alpha survives, keep bravo right on the bomb
    alpha.position = vec3(18, 0, 18);
    const explodeAt = plantEnd + BOMB.fuseTimeMs;
    match.tick(explodeAt, 1 / 30);

    expect(match.getBomb()?.state).toBe('exploded');
    expect(bravo.alive).toBe(false);
    expect(match.currentPhase).toBe('round_over');
    expect(match.getSnapshot(explodeAt).match.scores.alpha).toBe(1);
    // Start (800) + plantReward (500) + bombWinReward (3500) = 4800
    expect(alpha.money).toBe(ECONOMY.startMoney + ECONOMY.plantReward + ECONOMY.bombWinReward);
    expect(bravo.money).toBe(ECONOMY.startMoney + ECONOMY.lossBonus[0]);
  });

  it('defuses in 8s without kit and in 4s with defuseKit, awarding defuseReward and bombWinReward', () => {
    // 1. Without kit (8s)
    {
      const { match, alpha, bravo, alphaId, bravoId } = createLiveMatch();
      alpha.position = vec3(-6, 0, 0);
      alpha.grounded = true;
      match.setInput(alphaId, makeInput({ seq: 1, clientTime: 1_100, useHeld: true }), 1_100);
      match.tick(1_100, 1 / 30);
      const plantEnd = 1_100 + BOMB.plantTimeMs;
      match.setInput(alphaId, makeInput({ seq: 2, clientTime: plantEnd, useHeld: true }), plantEnd);
      match.tick(plantEnd, 1 / 30);

      bravo.position = vec3(-6, 0, 0.5);
      bravo.grounded = true;
      const defuseStart = plantEnd + 1_000;
      match.setInput(
        bravoId,
        makeInput({ seq: 1, clientTime: defuseStart, useHeld: true }),
        defuseStart,
      );
      match.tick(defuseStart, 1 / 30);
      expect(match.getBomb()?.defuseEndsAt).toBe(defuseStart + BOMB.defuseTimeMs);

      const defuseEnd = defuseStart + BOMB.defuseTimeMs;
      match.setInput(
        bravoId,
        makeInput({ seq: 2, clientTime: defuseEnd, useHeld: true }),
        defuseEnd,
      );
      match.tick(defuseEnd, 1 / 30);

      expect(match.getBomb()?.state).toBe('defused');
      expect(match.currentPhase).toBe('round_over');
      expect(match.getSnapshot(defuseEnd).match.scores.bravo).toBe(1);
      expect(bravo.money).toBe(ECONOMY.startMoney + ECONOMY.defuseReward + ECONOMY.bombWinReward);
    }

    // 2. With defuseKit (4s)
    {
      const { match, alpha, bravo, alphaId, bravoId } = createLiveMatch();
      bravo.defuseKit = true;
      alpha.position = vec3(6, 0, 0);
      alpha.grounded = true;
      match.setInput(alphaId, makeInput({ seq: 1, clientTime: 1_100, useHeld: true }), 1_100);
      match.tick(1_100, 1 / 30);
      const plantEnd = 1_100 + BOMB.plantTimeMs;
      match.setInput(alphaId, makeInput({ seq: 2, clientTime: plantEnd, useHeld: true }), plantEnd);
      match.tick(plantEnd, 1 / 30);

      bravo.position = vec3(6, 0, 0.5);
      bravo.grounded = true;
      const defuseStart = plantEnd + 500;
      match.setInput(
        bravoId,
        makeInput({ seq: 1, clientTime: defuseStart, useHeld: true }),
        defuseStart,
      );
      match.tick(defuseStart, 1 / 30);
      expect(match.getBomb()?.defuseEndsAt).toBe(defuseStart + BOMB.defuseKitTimeMs);

      const defuseEnd = defuseStart + BOMB.defuseKitTimeMs;
      match.setInput(
        bravoId,
        makeInput({ seq: 2, clientTime: defuseEnd, useHeld: true }),
        defuseEnd,
      );
      match.tick(defuseEnd, 1 / 30);

      expect(match.getBomb()?.state).toBe('defused');
      expect(match.getSnapshot(defuseEnd).match.scores.bravo).toBe(1);
    }
  });

  it('gives priority to defusal when defuseEndsAt <= explodeAt on the same tick', () => {
    const { match, alpha, bravo, alphaId, bravoId } = createLiveMatch();
    alpha.position = vec3(-6, 0, 0);
    alpha.grounded = true;
    match.setInput(alphaId, makeInput({ seq: 1, clientTime: 1_100, useHeld: true }), 1_100);
    match.tick(1_100, 1 / 30);
    const plantEnd = 1_100 + BOMB.plantTimeMs;
    match.setInput(alphaId, makeInput({ seq: 2, clientTime: plantEnd, useHeld: true }), plantEnd);
    match.tick(plantEnd, 1 / 30);

    const explodeAt = plantEnd + BOMB.fuseTimeMs;
    const defuseStart = explodeAt - BOMB.defuseTimeMs;
    bravo.position = vec3(-6, 0, 0.5);
    bravo.grounded = true;
    match.setInput(
      bravoId,
      makeInput({ seq: 1, clientTime: defuseStart, useHeld: true }),
      defuseStart,
    );
    match.tick(defuseStart, 1 / 30);
    expect(match.getBomb()?.defuseEndsAt).toBe(explodeAt);

    // Advance straight to explodeAt where both defuseEndsAt and explodeAt are reached
    match.setInput(bravoId, makeInput({ seq: 2, clientTime: explodeAt, useHeld: true }), explodeAt);
    match.tick(explodeAt, 1 / 30);

    expect(match.getBomb()?.state).toBe('defused');
    expect(match.getSnapshot(explodeAt).match.scores.bravo).toBe(1);
    expect(match.getSnapshot(explodeAt).match.scores.alpha).toBe(0);
  });

  it('continues the round if T is killed after planting and ignores roundEndsAt timer while planted', () => {
    const { match, alpha, bravo, alphaId, bravoId } = createLiveMatch();
    alpha.position = vec3(-6, 0, 0);
    alpha.grounded = true;
    match.setInput(alphaId, makeInput({ seq: 1, clientTime: 1_100, useHeld: true }), 1_100);
    match.tick(1_100, 1 / 30);
    const plantEnd = 1_100 + BOMB.plantTimeMs;
    match.setInput(alphaId, makeInput({ seq: 2, clientTime: plantEnd, useHeld: true }), plantEnd);
    match.tick(plantEnd, 1 / 30);
    expect(match.getBomb()?.state).toBe('planted');

    // Position Bravo right behind Alpha and shoot Alpha to death
    alpha.health = 1;
    bravo.position = vec3(-6, 0, 2);
    bravo.yaw = 0; // looking towards -Z (where alpha is at z=0)
    bravo.pitch = 0;
    match.setInput(
      bravoId,
      makeInput({ seq: 1, clientTime: plantEnd + 100, fire: true, yaw: 0, pitch: 0 }),
      plantEnd + 100,
    );
    match.tick(plantEnd + 100, 1 / 30);
    expect(alpha.alive).toBe(false);
    // Round MUST continue because bomb is planted!
    expect(match.currentPhase).toBe('live');

    // Even if roundEndsAt is in the past before explodeAt, round still continues
    const snapshot = match.getSnapshot(plantEnd + 200);
    expect(snapshot.match.phase).toBe('live');
  });

  it('keeps a T killed after planting dead (spectating) instead of respawning mid-round', () => {
    const { match, alpha, bravo, alphaId, bravoId } = createLiveMatch({ respawnMs: 200 });
    alpha.position = vec3(-6, 0, 0);
    alpha.grounded = true;
    match.setInput(alphaId, makeInput({ seq: 1, clientTime: 1_100, useHeld: true }), 1_100);
    match.tick(1_100, 1 / 30);
    const plantEnd = 1_100 + BOMB.plantTimeMs;
    match.setInput(alphaId, makeInput({ seq: 2, clientTime: plantEnd, useHeld: true }), plantEnd);
    match.tick(plantEnd, 1 / 30);
    expect(match.getBomb()?.state).toBe('planted');

    alpha.health = 1;
    bravo.position = vec3(-6, 0, 2);
    match.setInput(
      bravoId,
      makeInput({ seq: 1, clientTime: plantEnd + 100, fire: true, yaw: 0, pitch: 0 }),
      plantEnd + 100,
    );
    match.tick(plantEnd + 100, 1 / 30);
    expect(alpha.alive).toBe(false);
    expect(alpha.respawnAt).toBeNull();

    // Well past respawnMs: still dead, round still live, snapshot has no respawn timer.
    for (let now = plantEnd + 150; now <= plantEnd + 3_000; now += 50) {
      match.tick(now, 1 / 30);
    }
    expect(match.currentPhase).toBe('live');
    expect(alpha.alive).toBe(false);
    const local = match.getSnapshot(plantEnd + 3_000).players.find((p) => p.id === alphaId);
    expect(local?.alive).toBe(false);
    expect(local?.respawnAt).toBeNull();
  });

  it('drops the bomb on G or carrier death and allows only living T to pick it up', () => {
    const { match, alpha, bravo, alphaId, bravoId } = createLiveMatch();
    alpha.position = vec3(0, 0, 0);
    bravo.position = vec3(0, 0, 0);

    // Manual drop via G
    match.setInput(alphaId, makeInput({ seq: 1, clientTime: 1_100, drop: true }), 1_100);
    match.tick(1_100, 1 / 30);
    expect(match.getBomb()?.state).toBe('dropped');
    expect(match.getBomb()?.carrierId).toBeNull();

    // CT at the same position cannot pick it up (neither auto nor E)
    alpha.position = vec3(10, 0, 10);
    match.setInput(bravoId, makeInput({ seq: 1, clientTime: 1_150, use: true }), 1_150);
    match.tick(1_150, 1 / 30);
    expect(match.getBomb()?.state).toBe('dropped');

    // T walks over it -> auto pickup
    alpha.position = vec3(0.5, 0, 0);
    match.setInput(alphaId, makeInput({ seq: 2, clientTime: 1_350, drop: false }), 1_350);
    match.tick(1_350, 1 / 30);
    expect(match.getBomb()?.state).toBe('carried');
    expect(match.getBomb()?.carrierId).toBe(alphaId);
  });

  it('cancels active plant/defuse on pause and preserves remaining fuse time across pause/resume', () => {
    const { match, alpha, bravo, alphaId } = createLiveMatch();
    alpha.position = vec3(-6, 0, 0);
    alpha.grounded = true;
    match.setInput(alphaId, makeInput({ seq: 1, clientTime: 1_100, useHeld: true }), 1_100);
    match.tick(1_100, 1 / 30);
    const plantEnd = 1_100 + BOMB.plantTimeMs;
    match.setInput(alphaId, makeInput({ seq: 2, clientTime: plantEnd, useHeld: true }), plantEnd);
    match.tick(plantEnd, 1 / 30);

    const initialExplodeAt = match.getBomb()?.explodeAt;
    expect(initialExplodeAt).toBe(plantEnd + BOMB.fuseTimeMs);

    // Pause 10s into the fuse
    const pauseAt = plantEnd + 10_000;
    match.disconnect(bravo.id, pauseAt);
    expect(match.currentPhase).toBe('paused');

    // Reconnect 2s later + countdown 50ms
    const resumeAt = pauseAt + 2_000;
    match.join(
      'socket-bravo-2',
      { name: 'Bravo', playerId: bravo.id, sessionToken: bravo.sessionToken },
      resumeAt,
    );
    expect(match.currentPhase).toBe('countdown');
    const liveAgainAt = resumeAt + 51;
    match.tick(liveAgainAt, 1 / 30);
    expect(match.currentPhase).toBe('live');

    // Remaining fuse should be 20_000ms from liveAgainAt
    expect(match.getBomb()?.explodeAt).toBe(liveAgainAt + 20_000);
  });
});
