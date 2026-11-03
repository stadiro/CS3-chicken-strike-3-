import { describe, expect, it } from 'vitest';
import { SnapshotBuffer } from '../client/src/net/snapshotBuffer';
import type { PlayerSnapshot, Snapshot } from '../shared/protocol';

function player(
  id: string,
  x: number,
  yaw = 0,
  overrides: Partial<PlayerSnapshot> = {},
): PlayerSnapshot {
  return {
    id,
    name: id,
    team: id === 'local' ? 'alpha' : 'bravo',
    side: id === 'local' ? 't' : 'ct',
    position: { x, y: 0, z: 0 },
    yaw,
    pitch: 0,
    health: 100,
    armor: 100,
    helmet: false,
    defuseKit: false,
    money: 800,
    grenades: {},
    lastPurchaseId: null,
    blindUntil: 0,
    alive: true,
    crouching: false,
    walking: false,
    scoped: false,
    activeSlot: 'secondary',
    activeWeapon: 'deagle',
    ammo: 7,
    reserve: 35,
    reloadingUntil: null,
    respawnAt: null,
    kills: 0,
    deaths: 0,
    connected: true,
    ...overrides,
  };
}

function snapshot(time: number, localX: number, remoteX: number, localYaw = 0): Snapshot {
  return {
    tick: time / 10,
    serverTime: time,
    mapId: 'fy_wow',
    match: {
      mode: 'arena',
      phase: 'live',
      round: 1,
      scores: { alpha: 0, bravo: 0 },
      timeRemainingMs: 60_000,
      countdownEndsAt: null,
      roundOverEndsAt: null,
      matchEndsAt: time + 60_000,
      buyEndsAt: null,
      roundEndsAt: null,
      pauseDeadline: null,
      rematchVotes: [],
      winnerId: null,
      endReason: null,
      fragLimit: 16,
      roundsToWin: 13,
      sideSwapAfterRound: 12,
    },
    players: [player('local', localX, localYaw), player('remote', remoteX)],
    pickups: [],
    armorPickups: [],
    grenades: [],
    bomb: null,
  };
}

describe('client snapshot buffer', () => {
  it('returns null until a snapshot arrives', () => {
    const buffer = new SnapshotBuffer();
    expect(buffer.getLatest()).toBeNull();
    expect(buffer.sample(1_000, 'local')).toBeNull();
  });

  it('stores snapshots in time order and ignores duplicates', () => {
    const buffer = new SnapshotBuffer();
    buffer.push(snapshot(1_000, 0, 0));
    buffer.push(snapshot(1_100, 1, 1));
    buffer.push(snapshot(1_100, 2, 2));
    buffer.push(snapshot(900, 3, 3));
    expect(buffer.getLatest()?.serverTime).toBe(1_100);
    expect(buffer.getLatest()?.players[0]?.position.x).toBe(1);
  });

  it('interpolates remote players with the network buffer delay', () => {
    const buffer = new SnapshotBuffer();
    buffer.push(snapshot(1_000, 0, 0));
    buffer.push(snapshot(1_100, 100, 100));

    const atStart = buffer.sample(1_100, 'local');
    expect(atStart?.players.find((entry) => entry.id === 'remote')?.position.x).toBe(0);

    const halfway = buffer.sample(1_150, 'local');
    expect(halfway?.players.find((entry) => entry.id === 'remote')?.position.x).toBeCloseTo(50);

    const atEnd = buffer.sample(1_200, 'local');
    expect(atEnd?.players.find((entry) => entry.id === 'remote')?.position.x).toBe(100);
  });

  it('uses the remote render time as the aim timestamp', () => {
    const buffer = new SnapshotBuffer();
    buffer.push(snapshot(1_000, 0, 0));
    buffer.push(snapshot(1_100, 0, 100));

    const serverNow = 1_150;
    const aimTime = buffer.getAimTime(serverNow);
    expect(aimTime).toBe(serverNow - buffer.getBufferMs());
    expect(
      buffer.sample(serverNow, 'local')?.players.find((entry) => entry.id === 'remote')?.position.x,
    ).toBeCloseTo(50);
  });

  it('interpolates the local player with a shorter delay', () => {
    const buffer = new SnapshotBuffer();
    buffer.push(snapshot(1_000, 0, 0));
    buffer.push(snapshot(1_100, 100, 100));

    const localAt30 = buffer.sample(1_030, 'local');
    expect(localAt30?.local?.position.x).toBe(0);

    const localAt80 = buffer.sample(1_080, 'local');
    expect(localAt80?.local?.position.x).toBeCloseTo(50);
    expect(localAt80?.players.find((entry) => entry.id === 'local')?.position.x).toBeCloseTo(50);
  });

  it('interpolates yaw across the -pi/pi boundary', () => {
    const buffer = new SnapshotBuffer();
    buffer.push(snapshot(1_000, 0, 0, Math.PI - 0.1));
    buffer.push(snapshot(1_100, 0, 0, -Math.PI + 0.1));
    const sampled = buffer.sample(1_080, 'local');
    const yaw = sampled?.local?.yaw ?? 0;
    expect(Math.abs(Math.abs(yaw) - Math.PI)).toBeLessThan(0.11);
  });

  it('returns the latest match state and pickups', () => {
    const buffer = new SnapshotBuffer();
    const first = snapshot(1_000, 0, 0);
    const latest = snapshot(1_100, 0, 0);
    latest.match.scores.alpha = 3;
    latest.pickups = [
      { id: 'drop:1', weapon: 'ak47', position: { x: 1, y: 1, z: 1 }, kind: 'dropped' },
    ];
    buffer.push(first);
    buffer.push(latest);
    const sampled = buffer.sample(1_100, 'local');
    expect(sampled?.match.scores.alpha).toBe(3);
    expect(sampled?.pickups).toHaveLength(1);
    expect(sampled?.latest).toBe(latest);
  });

  it('opens the buffer when snapshot arrival is jittery', () => {
    const buffer = new SnapshotBuffer();
    buffer.push(snapshot(1_000, 0, 0), 0);
    buffer.push(snapshot(1_100, 1, 1), 120);
    buffer.push(snapshot(1_200, 2, 2), 300);
    expect(buffer.getJitterMs()).toBeGreaterThan(0);
    expect(buffer.getBufferMs()).toBeGreaterThan(100);
    expect(buffer.getBufferMs()).toBeLessThanOrEqual(180);
  });

  it('clears all buffered snapshots', () => {
    const buffer = new SnapshotBuffer();
    buffer.push(snapshot(1_000, 0, 0));
    buffer.clear();
    expect(buffer.getLatest()).toBeNull();
  });
});
