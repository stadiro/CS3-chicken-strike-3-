import { getCalloutName } from '../../../shared/callouts';
import { DUST2_ANGLED_DOORS, type ArenaMap } from '../../../shared/map';
import type { Vec3 } from '../../../shared/math';
import type { PlayerSnapshot, Snapshot } from '../../../shared/protocol';
import type { GameSettings } from '../settings';

export interface RadarOptions {
  container: HTMLElement;
}

export interface SpottedState {
  pos: Vec3;
  time: number;
  fading: boolean;
}

export interface SoundPing {
  pos: Vec3;
  time: number;
}

const SPOTTED_DURATION_MS = 2500;
const SOUND_PING_DURATION_MS = 1800;

export class Radar {
  private readonly container: HTMLElement;
  private readonly calloutText: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;

  private offscreenMap: HTMLCanvasElement | null = null;
  private cachedMapId: string | null = null;

  private readonly spottedEnemies = new Map<string, SpottedState>();
  private readonly soundPings: SoundPing[] = [];

  constructor(container: HTMLElement) {
    this.container = container;
    this.container.innerHTML = `
      <div class="radar-callout" id="radar-callout">
        <span class="radar-callout__dot">●</span>
        <span class="radar-callout__text" id="radar-callout-text">DUST II</span>
      </div>
      <div class="radar-frame" id="radar-frame">
        <canvas class="radar-canvas" id="radar-canvas" width="420" height="420"></canvas>
      </div>
    `;

    this.calloutText = this.container.querySelector('#radar-callout-text') as HTMLElement;
    this.canvas = this.container.querySelector('#radar-canvas') as HTMLCanvasElement;
    const context = this.canvas.getContext('2d');
    if (!context) {
      throw new Error('Canvas 2D context not available for radar');
    }
    this.ctx = context;
  }

  public registerShot(pos: Vec3): void {
    const now = performance.now();
    this.soundPings.push({ pos: { ...pos }, time: now });
    if (this.soundPings.length > 8) {
      this.soundPings.shift();
    }
  }

  public setSpotted(enemyId: string, pos: Vec3): void {
    this.spottedEnemies.set(enemyId, {
      pos: { ...pos },
      time: performance.now(),
      fading: false,
    });
  }

  public markLostSight(enemyId: string): void {
    const entry = this.spottedEnemies.get(enemyId);
    if (entry && !entry.fading) {
      entry.fading = true;
      entry.time = performance.now();
    }
  }

  public setVisible(visible: boolean): void {
    this.container.style.display = visible ? 'flex' : 'none';
  }

  public update(
    localPlayer: PlayerSnapshot,
    snapshot: Snapshot,
    map: ArenaMap,
    settings: GameSettings,
  ): void {
    const now = performance.now();

    // 1. Update location callout
    const callout = getCalloutName(snapshot.mapId, localPlayer.position);
    this.calloutText.textContent = callout;

    // 2. Prepare or reuse cached 2D map graphic
    if (this.cachedMapId !== snapshot.mapId || this.offscreenMap === null) {
      this.buildOffscreenMap(map);
      this.cachedMapId = snapshot.mapId;
    }

    // 3. Clear canvas
    const width = this.canvas.width;
    const height = this.canvas.height;
    const cx = width / 2;
    const cy = height / 2;
    const radarRadius = cx - 12;

    this.ctx.clearRect(0, 0, width, height);

    // Save state for circular clipping
    this.ctx.save();
    this.ctx.beginPath();
    this.ctx.arc(cx, cy, radarRadius, 0, Math.PI * 2);
    this.ctx.clip();

    // Dark tactical background
    const bgGrad = this.ctx.createRadialGradient(cx, cy, 10, cx, cy, radarRadius);
    bgGrad.addColorStop(0, '#0c131f');
    bgGrad.addColorStop(0.7, '#080d16');
    bgGrad.addColorStop(1, '#05090f');
    this.ctx.fillStyle = bgGrad;
    this.ctx.fillRect(0, 0, width, height);

    // Dynamic zoom per map scale
    let baseMeters = 40; // Dust 2 tactical radius ~40m
    if (snapshot.mapId === 'fy_sand') {
      baseMeters = 24;
    } else if (snapshot.mapId === 'fy_wow') {
      baseMeters = 22;
    }
    const pixelsPerMeter = (radarRadius / baseMeters) * settings.radarZoom;

    // Transform coordinate system
    this.ctx.save();
    this.ctx.translate(cx, cy);

    const rotate = settings.radarRotate;
    const yaw = localPlayer.yaw;
    if (rotate) {
      // Rotating view: player faces UP
      this.ctx.rotate(yaw);
    }

    // Map offset
    this.ctx.scale(pixelsPerMeter, pixelsPerMeter);
    this.ctx.translate(-localPlayer.position.x, -localPlayer.position.z);

    // Draw pre-rendered map topology
    if (this.offscreenMap) {
      const halfSizeX = map.size / 2;
      const halfSizeZ = map.sizeZ / 2;
      this.ctx.drawImage(
        this.offscreenMap,
        -halfSizeX,
        -halfSizeZ,
        map.size,
        map.sizeZ,
      );
    }

    this.ctx.restore();

    // Subtle concentric tactical range rings
    this.ctx.strokeStyle = 'rgba(78, 120, 160, 0.12)';
    this.ctx.lineWidth = 1.5;
    for (const fraction of [0.33, 0.66, 1.0]) {
      this.ctx.beginPath();
      this.ctx.arc(cx, cy, radarRadius * fraction, 0, Math.PI * 2);
      this.ctx.stroke();
    }

    // Range crosshairs
    this.ctx.strokeStyle = 'rgba(78, 120, 160, 0.08)';
    this.ctx.beginPath();
    this.ctx.moveTo(cx, cy - radarRadius);
    this.ctx.lineTo(cx, cy + radarRadius);
    this.ctx.moveTo(cx - radarRadius, cy);
    this.ctx.lineTo(cx + radarRadius, cy);
    this.ctx.stroke();

    // Helper to project any world pos (x, z) to screen (sx, sy, clamped)
    const project = (
      wx: number,
      wz: number,
    ): { sx: number; sy: number; clamped: boolean; angle: number } => {
      const dx = wx - localPlayer.position.x;
      const dz = wz - localPlayer.position.z;

      let rx = dx;
      let rz = dz;
      if (rotate) {
        // Player forward is (-sin(yaw), -cos(yaw)).
        // Local Right = dx * cos(yaw) - dz * sin(yaw)
        // Local Forward = -dx * sin(yaw) - dz * cos(yaw)
        // Local Screen Y (down is positive) = -(Local Forward) = dx * sin(yaw) + dz * cos(yaw)
        rx = dx * Math.cos(yaw) - dz * Math.sin(yaw);
        rz = dx * Math.sin(yaw) + dz * Math.cos(yaw);
      }

      const screenX = rx * pixelsPerMeter;
      const screenY = rz * pixelsPerMeter;
      const dist = Math.sqrt(screenX * screenX + screenY * screenY);
      const maxR = radarRadius - 14;

      if (dist > maxR && dist > 1e-4) {
        const factor = maxR / dist;
        return {
          sx: cx + screenX * factor,
          sy: cy + screenY * factor,
          clamped: true,
          angle: Math.atan2(screenY, screenX),
        };
      }

      return {
        sx: cx + screenX,
        sy: cy + screenY,
        clamped: false,
        angle: Math.atan2(screenY, screenX),
      };
    };

    // 4. Draw Bomb Sites (A / B) markers clamped to edge if out of view
    if (map.bombSites && map.bombSites.length > 0) {
      for (const site of map.bombSites) {
        const { sx, sy } = project(site.center.x, site.center.z);
        this.ctx.save();
        this.ctx.beginPath();
        this.ctx.arc(sx, sy, 10, 0, Math.PI * 2);
        this.ctx.fillStyle = 'rgba(239, 68, 68, 0.22)';
        this.ctx.fill();
        this.ctx.strokeStyle = '#ef4444';
        this.ctx.lineWidth = 1.5;
        this.ctx.stroke();

        this.ctx.font = 'bold 11px system-ui, sans-serif';
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';
        this.ctx.fillStyle = '#ffffff';
        this.ctx.fillText(site.name, sx, sy + 0.5);
        this.ctx.restore();
      }
    }

    // 5. Draw Bomb (C4) on ground or planted
    if (snapshot.bomb) {
      const bomb = snapshot.bomb;
      if (bomb.state === 'planted' && bomb.position) {
        const { sx, sy } = project(bomb.position.x, bomb.position.z);
        const pulse = 1 + 0.25 * Math.sin(now * 0.015);
        this.ctx.save();
        this.ctx.beginPath();
        this.ctx.arc(sx, sy, 9 * pulse, 0, Math.PI * 2);
        this.ctx.fillStyle = 'rgba(239, 68, 68, 0.5)';
        this.ctx.fill();
        this.ctx.strokeStyle = '#f87171';
        this.ctx.lineWidth = 2;
        this.ctx.stroke();

        this.ctx.font = 'bold 9px sans-serif';
        this.ctx.fillStyle = '#ffffff';
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';
        this.ctx.fillText('C4', sx, sy);
        this.ctx.restore();
      } else if (bomb.state === 'dropped' && bomb.position) {
        const { sx, sy } = project(bomb.position.x, bomb.position.z);
        this.ctx.save();
        this.ctx.fillStyle = '#f59e0b';
        this.ctx.beginPath();
        this.ctx.arc(sx, sy, 7, 0, Math.PI * 2);
        this.ctx.fill();
        this.ctx.strokeStyle = '#ffffff';
        this.ctx.lineWidth = 1.5;
        this.ctx.stroke();
        this.ctx.restore();
      }
    }

    // 6. Draw Sound Pings (Gunfire echoes)
    for (let i = this.soundPings.length - 1; i >= 0; i -= 1) {
      const ping = this.soundPings[i];
      if (!ping) {
        continue;
      }
      const age = now - ping.time;
      if (age > SOUND_PING_DURATION_MS) {
        this.soundPings.splice(i, 1);
        continue;
      }
      const alpha = 1 - age / SOUND_PING_DURATION_MS;
      const { sx, sy } = project(ping.pos.x, ping.pos.z);
      const pingRadius = 6 + (age / SOUND_PING_DURATION_MS) * 16;

      this.ctx.save();
      this.ctx.beginPath();
      this.ctx.arc(sx, sy, pingRadius, 0, Math.PI * 2);
      this.ctx.strokeStyle = `rgba(239, 68, 68, ${alpha * 0.75})`;
      this.ctx.lineWidth = 2;
      this.ctx.stroke();
      this.ctx.restore();
    }

    // 7. Draw Teammates
    for (const player of snapshot.players) {
      if (player.id === localPlayer.id) {
        continue;
      }
      if (player.team !== localPlayer.team) {
        continue;
      }

      const { sx, sy, clamped } = project(player.position.x, player.position.z);

      this.ctx.save();
      if (!player.alive) {
        // Dead teammate cross
        this.ctx.strokeStyle = 'rgba(156, 163, 175, 0.7)';
        this.ctx.lineWidth = 2;
        this.ctx.beginPath();
        this.ctx.moveTo(sx - 5, sy - 5);
        this.ctx.lineTo(sx + 5, sy + 5);
        this.ctx.moveTo(sx + 5, sy - 5);
        this.ctx.lineTo(sx - 5, sy + 5);
        this.ctx.stroke();
      } else {
        // Living teammate (Cyan / Light Blue)
        const teamColor = '#38bdf8';
        this.ctx.beginPath();
        this.ctx.arc(sx, sy, 6.5, 0, Math.PI * 2);
        this.ctx.fillStyle = teamColor;
        this.ctx.fill();
        this.ctx.strokeStyle = '#ffffff';
        this.ctx.lineWidth = 1.5;
        this.ctx.stroke();

        // Direction pointer arrow
        if (!clamped) {
          const arrowAngle = rotate ? player.yaw - yaw : player.yaw;
          const arrowDirX = -Math.sin(arrowAngle);
          const arrowDirY = -Math.cos(arrowAngle);
          this.ctx.beginPath();
          this.ctx.moveTo(sx + arrowDirX * 12, sy + arrowDirY * 12);
          this.ctx.lineTo(sx + arrowDirX * 7 + arrowDirY * 3, sy + arrowDirY * 7 - arrowDirX * 3);
          this.ctx.lineTo(sx + arrowDirX * 7 - arrowDirY * 3, sy + arrowDirY * 7 + arrowDirX * 3);
          this.ctx.closePath();
          this.ctx.fillStyle = teamColor;
          this.ctx.fill();
        }

        // Teammate letter tag
        this.ctx.font = 'bold 8px sans-serif';
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';
        this.ctx.fillStyle = '#0f172a';
        this.ctx.fillText(player.name.charAt(0).toUpperCase(), sx, sy + 0.5);
      }
      this.ctx.restore();
    }

    // 8. Draw Spotted / Visible Enemies
    for (const player of snapshot.players) {
      if (player.team === localPlayer.team || !player.alive) {
        continue;
      }
      const spotted = this.spottedEnemies.get(player.id);
      if (!spotted) {
        continue;
      }

      const age = now - spotted.time;
      if (spotted.fading && age > SPOTTED_DURATION_MS) {
        this.spottedEnemies.delete(player.id);
        continue;
      }

      const alpha = spotted.fading ? Math.max(0.1, 1 - age / SPOTTED_DURATION_MS) : 1.0;
      const { sx, sy, clamped } = project(spotted.pos.x, spotted.pos.z);

      this.ctx.save();
      this.ctx.globalAlpha = alpha;

      // Enemy circle (Bright Red)
      this.ctx.beginPath();
      this.ctx.arc(sx, sy, 6.5, 0, Math.PI * 2);
      this.ctx.fillStyle = '#ef4444';
      this.ctx.fill();
      this.ctx.strokeStyle = '#ffffff';
      this.ctx.lineWidth = 1.5;
      this.ctx.stroke();

      if (spotted.fading) {
        this.ctx.font = 'bold 9px sans-serif';
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';
        this.ctx.fillStyle = '#ffffff';
        this.ctx.fillText('?', sx, sy);
      } else if (!clamped) {
        // Red direction arrow
        const arrowAngle = rotate ? player.yaw - yaw : player.yaw;
        const arrowDirX = -Math.sin(arrowAngle);
        const arrowDirY = -Math.cos(arrowAngle);
        this.ctx.beginPath();
        this.ctx.moveTo(sx + arrowDirX * 12, sy + arrowDirY * 12);
        this.ctx.lineTo(sx + arrowDirX * 7 + arrowDirY * 3, sy + arrowDirY * 7 - arrowDirX * 3);
        this.ctx.lineTo(sx + arrowDirX * 7 - arrowDirY * 3, sy + arrowDirY * 7 + arrowDirX * 3);
        this.ctx.closePath();
        this.ctx.fillStyle = '#ef4444';
        this.ctx.fill();
      }
      this.ctx.restore();
    }

    // 9. Draw Local Player (Center)
    this.ctx.save();
    // Translucent vision cone
    const coneGrad = this.ctx.createRadialGradient(cx, cy, 2, cx, cy, 46);
    coneGrad.addColorStop(0, 'rgba(56, 189, 248, 0.35)');
    coneGrad.addColorStop(1, 'rgba(56, 189, 248, 0.0)');
    this.ctx.fillStyle = coneGrad;

    const angleStart = rotate ? -Math.PI / 2 - 0.55 : -yaw - Math.PI / 2 - 0.55;
    const angleEnd = rotate ? -Math.PI / 2 + 0.55 : -yaw - Math.PI / 2 + 0.55;

    this.ctx.beginPath();
    this.ctx.moveTo(cx, cy);
    this.ctx.arc(cx, cy, 46, angleStart, angleEnd);
    this.ctx.closePath();
    this.ctx.fill();

    // Local player chevron/triangle
    this.ctx.translate(cx, cy);
    if (!rotate) {
      this.ctx.rotate(-yaw);
    }

    this.ctx.beginPath();
    this.ctx.moveTo(0, -9);
    this.ctx.lineTo(6.5, 6);
    this.ctx.lineTo(0, 3);
    this.ctx.lineTo(-6.5, 6);
    this.ctx.closePath();
    this.ctx.fillStyle = '#38bdf8';
    this.ctx.fill();
    this.ctx.strokeStyle = '#ffffff';
    this.ctx.lineWidth = 1.6;
    this.ctx.stroke();

    this.ctx.restore();

    // End circular clipping
    this.ctx.restore();

    // 10. Outer Border Ring & Compass (North Marker)
    this.ctx.save();
    this.ctx.beginPath();
    this.ctx.arc(cx, cy, radarRadius, 0, Math.PI * 2);
    this.ctx.strokeStyle = 'rgba(78, 120, 160, 0.45)';
    this.ctx.lineWidth = 2.5;
    this.ctx.stroke();

    // Subtle dark outer bevel ring
    this.ctx.beginPath();
    this.ctx.arc(cx, cy, radarRadius + 2, 0, Math.PI * 2);
    this.ctx.strokeStyle = 'rgba(15, 23, 42, 0.85)';
    this.ctx.lineWidth = 3;
    this.ctx.stroke();

    // Cardinal North ('N') mark on border
    // North is along -Z in world.
    let northAngle = -Math.PI / 2; // Straight UP if fixed north
    if (rotate) {
      // If rotating, North is rotated by yaw
      northAngle = -Math.PI / 2 + yaw;
    }
    const nx = cx + Math.cos(northAngle) * (radarRadius - 7);
    const ny = cy + Math.sin(northAngle) * (radarRadius - 7);

    this.ctx.beginPath();
    this.ctx.arc(nx, ny, 7.5, 0, Math.PI * 2);
    this.ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
    this.ctx.fill();
    this.ctx.strokeStyle = '#38bdf8';
    this.ctx.lineWidth = 1.2;
    this.ctx.stroke();

    this.ctx.font = 'bold 9px system-ui, sans-serif';
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    this.ctx.fillStyle = '#38bdf8';
    this.ctx.fillText('N', nx, ny);

    this.ctx.restore();
  }

  /**
   * Pre-renders the map topology into an offscreen canvas.
   * Maps X to canvas X, and Z to canvas Y.
   */
  private buildOffscreenMap(map: ArenaMap): void {
    const sizeX = map.size;
    const sizeZ = map.sizeZ;
    const scale = 8; // 8 pixels per meter resolution

    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(sizeX * scale);
    canvas.height = Math.ceil(sizeZ * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }

    const halfX = sizeX / 2;
    const halfZ = sizeZ / 2;

    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw walkable corridors/ground in slightly lighter tone
    ctx.fillStyle = '#172235';
    for (const box of map.boxes) {
      if (box.kind === 'floor' || box.kind === 'platform') {
        const x = (box.min.x + halfX) * scale;
        const z = (box.min.z + halfZ) * scale;
        const w = (box.max.x - box.min.x) * scale;
        const d = (box.max.z - box.min.z) * scale;
        ctx.fillRect(x, z, w, d);
      }
    }

    // Draw crates in tactical brown
    ctx.fillStyle = '#4a3724';
    ctx.strokeStyle = '#6d5236';
    ctx.lineWidth = 1.5;
    for (const box of map.boxes) {
      if (box.kind === 'crate') {
        const x = (box.min.x + halfX) * scale;
        const z = (box.min.z + halfZ) * scale;
        const w = (box.max.x - box.min.x) * scale;
        const d = (box.max.z - box.min.z) * scale;
        ctx.fillRect(x, z, w, d);
        ctx.strokeRect(x, z, w, d);
      }
    }

    // Draw solid walls and obstacles
    ctx.fillStyle = '#334155';
    ctx.strokeStyle = '#64748b';
    ctx.lineWidth = 2;
    for (const box of map.boxes) {
      if (box.kind === 'wall' || box.kind === 'column' || box.kind === 'rock') {
        const x = (box.min.x + halfX) * scale;
        const z = (box.min.z + halfZ) * scale;
        const w = (box.max.x - box.min.x) * scale;
        const d = (box.max.z - box.min.z) * scale;
        ctx.fillRect(x, z, w, d);
        ctx.strokeRect(x, z, w, d);
      }
    }

    // Draw angled CS2 doors if on de_dust2
    if (map.id === 'de_dust2') {
      ctx.lineCap = 'round';
      for (const door of Object.values(DUST2_ANGLED_DOORS)) {
        const hx = (door.x0 + halfX) * scale;
        const hz = (door.z0 + halfZ) * scale;
        const tx = (door.x1 + halfX) * scale;
        const tz = (door.z1 + halfZ) * scale;

        ctx.beginPath();
        ctx.moveTo(hx, hz);
        ctx.lineTo(tx, tz);
        ctx.lineWidth = Math.max(2, door.thickness * scale);
        ctx.strokeStyle = '#b8864e';
        ctx.stroke();
      }
      ctx.lineCap = 'butt';
    }

    this.offscreenMap = canvas;
  }
}
