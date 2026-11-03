import {
  BoxGeometry,
  CapsuleGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  RingGeometry,
  SphereGeometry,
} from 'three';
import { MOVEMENT, PLAYER } from '../../../shared/config';
import type { Side } from '../../../shared/economy';
import type { PlayerSnapshot } from '../../../shared/protocol';
import type { WeaponId } from '../../../shared/weapons';
import { disposeObject3D } from './dispose';
import { createWeaponModel, type WeaponModel } from './weaponModel';

const SIDE_COLORS = {
  t: 0xfb923c,
  ct: 0x38bdf8,
} as const;
// The visual model must use the same crouch height and head alignment as the
// server hitboxes so the top of the rendered head is hittable.
const CROUCH_SCALE = MOVEMENT.crouchHeight / MOVEMENT.standHeight;
const UPPER_Y = 1.24;
const HEAD_CENTER_Y = MOVEMENT.standHeight - PLAYER.headRadius;
const HEAD_OFFSET_Y = HEAD_CENTER_Y - UPPER_Y;

export class PlayerView {
  readonly root = new Group();

  private readonly upper = new Group();
  private readonly weaponMount = new Group();
  private readonly legLeft = new Group();
  private readonly legRight = new Group();
  private weapon: WeaponModel | null = null;
  private weaponId: WeaponId | null = null;
  private walkPhase = 0;
  private lastPosition = { x: 0, y: 0, z: 0 };
  private lastColorKey: string | null = null;
  private lastCrouching = false;
  private disposed = false;

  constructor(playerId: string) {
    this.root.name = `player-${playerId}`;

    const teamRing = new Mesh(
      new RingGeometry(0.46, 0.58, 32),
      new MeshBasicMaterial({
        color: 0x38bdf8,
        transparent: true,
        opacity: 0.6,
        side: DoubleSide,
        depthWrite: false,
      }),
    );
    teamRing.rotation.x = -Math.PI / 2;
    teamRing.position.y = 0.018;
    teamRing.name = 'team-ring';
    this.root.add(teamRing);

    const bodyMaterial = new MeshStandardMaterial({
      color: 0x1a2c40,
      roughness: 0.56,
      metalness: 0.28,
    });
    const limbMaterial = new MeshStandardMaterial({
      color: 0x0d1724,
      roughness: 0.7,
      metalness: 0.16,
    });
    const visorMaterial = new MeshBasicMaterial({ color: 0x38bdf8, toneMapped: false });

    const torso = new Mesh(new CapsuleGeometry(0.32, 0.6, 5, 12), bodyMaterial);
    torso.position.y = 0.98;
    torso.castShadow = true;
    this.root.add(torso);

    const belt = new Mesh(new BoxGeometry(0.58, 0.09, 0.34), limbMaterial);
    belt.position.y = 0.72;
    this.root.add(belt);

    this.legLeft.position.set(-0.17, 0.68, 0);
    this.legRight.position.set(0.17, 0.68, 0);
    const legGeometry = new BoxGeometry(0.2, 0.62, 0.24);
    const leftLegMesh = new Mesh(legGeometry, limbMaterial);
    leftLegMesh.position.y = -0.31;
    leftLegMesh.castShadow = true;
    const rightLegMesh = new Mesh(legGeometry, limbMaterial);
    rightLegMesh.position.y = -0.31;
    rightLegMesh.castShadow = true;
    this.legLeft.add(leftLegMesh);
    this.legRight.add(rightLegMesh);
    this.root.add(this.legLeft, this.legRight);

    this.upper.position.y = UPPER_Y;
    this.root.add(this.upper);

    const head = new Mesh(new SphereGeometry(PLAYER.headRadius, 18, 14), bodyMaterial);
    head.position.y = HEAD_OFFSET_Y;
    head.castShadow = true;
    this.upper.add(head);

    const visor = new Mesh(new BoxGeometry(0.26, 0.075, 0.06), visorMaterial);
    visor.position.set(0, HEAD_OFFSET_Y + 0.01, -0.19);
    this.upper.add(visor);

    const shoulderGeometry = new BoxGeometry(0.14, 0.42, 0.14);
    const leftArm = new Mesh(shoulderGeometry, limbMaterial);
    leftArm.position.set(-0.38, 0.2, -0.02);
    leftArm.rotation.x = -0.3;
    leftArm.castShadow = true;
    const rightArm = new Mesh(shoulderGeometry, limbMaterial);
    rightArm.position.set(0.38, 0.2, -0.02);
    rightArm.rotation.x = -0.3;
    rightArm.castShadow = true;
    this.upper.add(leftArm, rightArm);

    this.weaponMount.position.set(0.3, 0.16, -0.36);
    this.upper.add(this.weaponMount);

    this.root.userData.playerId = playerId;
    this.setSideColor('t');
  }

  update(player: PlayerSnapshot, dt: number): void {
    if (this.disposed) {
      return;
    }

    this.root.visible = player.alive;
    if (!player.alive) {
      return;
    }

    this.root.position.set(player.position.x, player.position.y, player.position.z);
    this.root.rotation.y = player.yaw;
    this.upper.rotation.x = player.pitch;

    if (player.crouching !== this.lastCrouching) {
      this.lastCrouching = player.crouching;
      this.root.scale.y = player.crouching ? CROUCH_SCALE : 1;
    }

    const dx = player.position.x - this.lastPosition.x;
    const dz = player.position.z - this.lastPosition.z;
    const speed = Math.hypot(dx, dz) / Math.max(dt, 0.001);
    this.lastPosition = { ...player.position };

    if (speed > 0.15) {
      this.walkPhase += dt * Math.min(speed, 8) * 3.6;
      const swing = Math.sin(this.walkPhase) * 0.5;
      this.legLeft.rotation.x = swing;
      this.legRight.rotation.x = -swing;
    } else {
      this.legLeft.rotation.x *= Math.max(0, 1 - dt * 10);
      this.legRight.rotation.x *= Math.max(0, 1 - dt * 10);
    }

    if (player.activeWeapon !== this.weaponId) {
      this.setWeapon(player.activeWeapon);
    }

    const side: Side = player.side ?? (player.team === 'alpha' ? 't' : 'ct');
    if (side !== this.lastColorKey) {
      this.lastColorKey = side;
      this.setSideColor(side);
    }
  }

  private setSideColor(side: Side): void {
    const hex = SIDE_COLORS[side];
    const ring = this.root.getObjectByName('team-ring');
    if (ring instanceof Mesh && ring.material instanceof MeshBasicMaterial) {
      ring.material.color.setHex(hex);
    }
    const visor = this.upper.children.find(
      (child) => child instanceof Mesh && child.material instanceof MeshBasicMaterial,
    );
    if (visor instanceof Mesh && visor.material instanceof MeshBasicMaterial) {
      visor.material.color.setHex(hex);
    }
  }

  private setWeapon(weaponId: WeaponId): void {
    this.weapon?.dispose();
    this.weapon = createWeaponModel(weaponId, 0.78);
    this.weapon.group.position.set(0, 0, 0);
    this.weaponMount.add(this.weapon.group);
    this.weaponId = weaponId;
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.weapon?.dispose();
    disposeObject3D(this.root);
  }
}
