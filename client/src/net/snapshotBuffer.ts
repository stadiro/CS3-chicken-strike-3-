import {
  SNAPSHOT_BUFFER_MS,
  type ArmorPickupSnapshot,
  type BombSnapshot,
  type GrenadeSnapshot,
  type MatchSnapshot,
  type PickupSnapshot,
  type PlayerSnapshot,
  type Snapshot,
} from '../../../shared/protocol';
import { clamp, lerp, lerpAngle, type Vec3 } from '../../../shared/math';

const MAX_SNAPSHOTS = 90;
const LOCAL_INTERPOLATION_MS = 30;
const MIN_BUFFER_MS = 70;
const MAX_BUFFER_MS = 180;
const BASE_BUFFER_MS = 90;

export interface SampledFrame {
  serverTime: number;
  match: MatchSnapshot;
  players: PlayerSnapshot[];
  pickups: PickupSnapshot[];
  armorPickups: ArmorPickupSnapshot[];
  grenades: GrenadeSnapshot[];
  bomb: BombSnapshot | null;
  local: PlayerSnapshot | null;
  latest: Snapshot;
}

interface SnapshotPair {
  before: Snapshot;
  after: Snapshot;
  t: number;
}

function lerpVec3(a: Vec3, b: Vec3, t: number): Vec3 {
  return {
    x: lerp(a.x, b.x, t),
    y: lerp(a.y, b.y, t),
    z: lerp(a.z, b.z, t),
  };
}

export class SnapshotBuffer {
  private snapshots: Snapshot[] = [];
  private bufferMs = SNAPSHOT_BUFFER_MS;
  private arrivalJitterMs = 0;
  private lastArrivalAt: number | null = null;
  private lastArrivalServerTime: number | null = null;

  /**
   * @param arrivalAt local timestamp used to estimate jitter. Tests may omit it
   * to keep the buffer deterministic.
   */
  push(snapshot: Snapshot, arrivalAt?: number): void {
    const latest = this.snapshots[this.snapshots.length - 1];
    if (latest !== undefined && snapshot.serverTime < latest.serverTime - 1000) {
      this.snapshots = [];
    }

    if (latest !== undefined && snapshot.serverTime <= latest.serverTime) {
      return;
    }

    if (arrivalAt !== undefined) {
      this.updateAdaptiveBuffer(snapshot, arrivalAt);
    }

    this.snapshots.push(snapshot);
    if (this.snapshots.length > MAX_SNAPSHOTS) {
      this.snapshots.splice(0, this.snapshots.length - MAX_SNAPSHOTS);
    }
  }

  private updateAdaptiveBuffer(snapshot: Snapshot, arrivalAt: number): void {
    if (this.lastArrivalAt !== null && this.lastArrivalServerTime !== null) {
      const arrivalInterval = Math.max(0, arrivalAt - this.lastArrivalAt);
      const serverInterval = Math.max(0, snapshot.serverTime - this.lastArrivalServerTime);
      const expectedInterval = serverInterval > 0 ? serverInterval : arrivalInterval;
      const jitter = Math.abs(arrivalInterval - expectedInterval);
      this.arrivalJitterMs = this.arrivalJitterMs * 0.85 + jitter * 0.15;
      const target = clamp(
        BASE_BUFFER_MS + this.arrivalJitterMs * 2.5,
        MIN_BUFFER_MS,
        MAX_BUFFER_MS,
      );
      // Open the buffer quickly when the connection becomes noisy, and close it
      // slowly so the camera does not visibly snap when jitter improves.
      const alpha = target > this.bufferMs ? 0.3 : 0.02;
      this.bufferMs += (target - this.bufferMs) * alpha;
    }
    this.lastArrivalAt = arrivalAt;
    this.lastArrivalServerTime = snapshot.serverTime;
  }

  getBufferMs(): number {
    return this.bufferMs;
  }

  /** Server timestamp used to render remote players, and therefore to aim. */
  getAimTime(serverNow: number): number {
    return serverNow - this.bufferMs;
  }

  getJitterMs(): number {
    return this.arrivalJitterMs;
  }

  clear(): void {
    this.snapshots = [];
    this.bufferMs = SNAPSHOT_BUFFER_MS;
    this.arrivalJitterMs = 0;
    this.lastArrivalAt = null;
    this.lastArrivalServerTime = null;
  }

  getLatest(): Snapshot | null {
    return this.snapshots[this.snapshots.length - 1] ?? null;
  }

  sample(serverNow: number, localPlayerId: string | null): SampledFrame | null {
    const remoteTarget = this.getAimTime(serverNow);
    const localTarget = localPlayerId === null ? null : serverNow - LOCAL_INTERPOLATION_MS;
    return this.buildFrame(remoteTarget, localTarget, localPlayerId);
  }

  private buildFrame(
    remoteTarget: number,
    localTarget: number | null,
    localPlayerId: string | null,
  ): SampledFrame | null {
    const latest = this.getLatest();
    if (latest === null) {
      return null;
    }

    const remotePair = this.findPair(remoteTarget);
    const localPair = localTarget === null ? null : this.findPair(localTarget);

    const players = remotePair.after.players.map((player) => {
      return this.interpolatePlayer(remotePair, player.id) ?? player;
    });

    const local = localPlayerId === null ? null : this.interpolatePlayer(localPair, localPlayerId);

    if (local !== null) {
      const index = players.findIndex((player) => player.id === localPlayerId);
      if (index >= 0) {
        players[index] = local;
      } else {
        players.push(local);
      }
    }

    return {
      serverTime: latest.serverTime,
      match: latest.match,
      players,
      pickups: latest.pickups,
      armorPickups: latest.armorPickups,
      grenades: latest.grenades,
      bomb: latest.bomb ?? null,
      local,
      latest,
    };
  }

  private findPair(targetServerTime: number): SnapshotPair {
    const first = this.snapshots[0];
    const last = this.snapshots[this.snapshots.length - 1];
    if (first === undefined || last === undefined) {
      throw new Error('SnapshotBuffer.findPair called without snapshots');
    }

    if (targetServerTime <= first.serverTime) {
      return { before: first, after: first, t: 0 };
    }
    if (targetServerTime >= last.serverTime) {
      return { before: last, after: last, t: 0 };
    }

    let low = 0;
    let high = this.snapshots.length - 1;
    while (low + 1 < high) {
      const middle = Math.floor((low + high) / 2);
      const snapshot = this.snapshots[middle];
      if (snapshot === undefined) {
        break;
      }
      if (snapshot.serverTime <= targetServerTime) {
        low = middle;
      } else {
        high = middle;
      }
    }

    const before = this.snapshots[low];
    const after = this.snapshots[high];
    if (before === undefined || after === undefined) {
      return { before: first, after: first, t: 0 };
    }

    const span = after.serverTime - before.serverTime;
    const t =
      span <= 0 ? 0 : Math.max(0, Math.min(1, (targetServerTime - before.serverTime) / span));
    return { before, after, t };
  }

  private interpolatePlayer(pair: SnapshotPair | null, playerId: string): PlayerSnapshot | null {
    if (pair === null) {
      return null;
    }

    const afterPlayer = pair.after.players.find((player) => player.id === playerId);
    if (afterPlayer === undefined) {
      return null;
    }

    if (pair.t <= 0 || pair.before === pair.after) {
      return afterPlayer;
    }

    const beforePlayer = pair.before.players.find((player) => player.id === playerId);
    if (beforePlayer === undefined) {
      return afterPlayer;
    }

    return {
      ...afterPlayer,
      position: lerpVec3(beforePlayer.position, afterPlayer.position, pair.t),
      yaw: lerpAngle(beforePlayer.yaw, afterPlayer.yaw, pair.t),
      pitch: lerp(beforePlayer.pitch, afterPlayer.pitch, pair.t),
    };
  }
}
