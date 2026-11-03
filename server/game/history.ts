import { lerp, type Vec3 } from '../../shared/math';
import { playerHeight } from './player';
import type { PlayerState } from './types';

export interface SampledPlayer {
  time: number;
  position: Vec3;
  height: number;
  alive: boolean;
}

export function recordHistory(player: PlayerState, now: number): void {
  player.history.push({
    time: now,
    position: { ...player.position },
    height: playerHeight(player),
    alive: player.alive,
  });
}

export function trimHistory(player: PlayerState, now: number, retentionMs: number): void {
  const cutoff = now - retentionMs;
  while (player.history.length > 0) {
    const first = player.history[0];
    if (first === undefined || first.time >= cutoff) {
      break;
    }
    player.history.shift();
  }
}

export function sampleHistory(player: PlayerState, time: number): SampledPlayer {
  const samples = player.history;
  if (samples.length === 0) {
    return {
      time,
      position: { ...player.position },
      height: playerHeight(player),
      alive: player.alive,
    };
  }

  const first = samples[0];
  const last = samples[samples.length - 1];
  if (first === undefined || last === undefined) {
    return {
      time,
      position: { ...player.position },
      height: playerHeight(player),
      alive: player.alive,
    };
  }

  if (time <= first.time) {
    return { ...first, position: { ...first.position } };
  }
  if (time >= last.time) {
    return { ...last, position: { ...last.position } };
  }

  for (let index = 0; index < samples.length - 1; index += 1) {
    const current = samples[index];
    const next = samples[index + 1];
    if (current === undefined || next === undefined) {
      continue;
    }
    if (time < current.time || time > next.time) {
      continue;
    }

    if (!current.alive || !next.alive) {
      const chosen = next.alive ? next : current;
      return { ...chosen, position: { ...chosen.position } };
    }

    const span = next.time - current.time;
    const factor = span <= 0 ? 0 : (time - current.time) / span;
    return {
      time,
      position: {
        x: lerp(current.position.x, next.position.x, factor),
        y: lerp(current.position.y, next.position.y, factor),
        z: lerp(current.position.z, next.position.z, factor),
      },
      height: lerp(current.height, next.height, factor),
      alive: true,
    };
  }

  return { ...last, position: { ...last.position } };
}
