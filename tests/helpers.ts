import { createPlayer } from '../server/game/player';
import type { PlayerState } from '../server/game/types';
import { vec3, type Vec3 } from '../shared/math';
import type { ArenaMap, ArmorSpawnPoint, MapTheme, WeaponSpawnPoint } from '../shared/map';
import type { InputFrame, Team } from '../shared/protocol';

const TEST_TOKEN = 'a'.repeat(48);

export function makePlayer(
  overrides: Partial<PlayerState> & { team?: Team; spawn?: Vec3; spawnYaw?: number } = {},
): PlayerState {
  const team = overrides.team ?? 'alpha';
  const player = createPlayer(
    overrides.id ?? 'player-1',
    overrides.sessionToken ?? TEST_TOKEN,
    overrides.name ?? 'Player',
    team,
    overrides.joinedAt ?? 1_000,
    overrides.spawn ?? vec3(0, 0, 0),
    overrides.spawnYaw ?? 0,
  );
  return Object.assign(player, overrides);
}

export function makeInput(overrides: Partial<InputFrame> = {}): InputFrame {
  return {
    seq: 1,
    clientTime: 1_000,
    aimTime: overrides.clientTime ?? 1_000,
    forward: 0,
    strafe: 0,
    yaw: 0,
    pitch: 0,
    jump: false,
    crouch: false,
    walk: false,
    fire: false,
    scoped: false,
    reload: false,
    use: false,
    useHeld: false,
    drop: false,
    switchTo: null,
    ...overrides,
  };
}

const TEST_THEME: MapTheme = {
  sky: '#060a11',
  fog: '#060a11',
  fogNear: 30,
  fogFar: 92,
  sun: '#fff2d8',
  ambient: '#4cc9e8',
  accent: '#38bdf8',
  horizon: '#08111d',
};

export function makeFlatMap(
  weaponSpawns: WeaponSpawnPoint[] = [],
  armorSpawns: ArmorSpawnPoint[] = [],
): ArenaMap {
  return {
    id: 'fy_wow',
    name: 'test_flat',
    mode: 'arena',
    size: 40,
    sizeZ: 40,
    height: 6,
    boxes: [
      {
        id: 'floor',
        min: vec3(-20, -0.5, -20),
        max: vec3(20, 0, 20),
        color: '#111111',
        kind: 'floor',
      },
    ],
    spawns: [
      { id: 'alpha', team: 'alpha', position: vec3(-4, 0, -4), yaw: Math.PI },
      { id: 'bravo', team: 'bravo', position: vec3(4, 0, 4), yaw: 0 },
    ],
    weaponSpawns,
    armorSpawns,
    bombSites: [],
    theme: TEST_THEME,
  };
}
