import {
  AdditiveBlending,
  AmbientLight,
  BoxGeometry,
  DirectionalLight,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  PointLight,
  Scene,
  SphereGeometry,
  SRGBColorSpace,
  type Vector3,
  type WebGLRenderer,
} from 'three';
import { getWeapon, type WeaponId } from '../../../shared/weapons';
import { disposeObject3D } from './dispose';
import { createWeaponModel, type WeaponModel } from './weaponModel';

const VIEWMODEL_BASE_X = 0.28;
const VIEWMODEL_BASE_Y = -0.24;
const VIEWMODEL_BASE_Z = -0.78;

const GUN_LEFT_HAND_POS: [number, number, number] = [-0.08, -0.12, -0.14];
const GUN_LEFT_HAND_ROT: [number, number, number] = [-0.2, 0.1, -0.2];
const GUN_LEFT_SLEEVE_POS: [number, number, number] = [-0.15, -0.22, 0.06];
const GUN_LEFT_SLEEVE_ROT: [number, number, number] = [-0.2, 0.1, -0.2];

const GUN_RIGHT_HAND_POS: [number, number, number] = [0.1, -0.17, 0.03];
const GUN_RIGHT_HAND_ROT: [number, number, number] = [0.16, -0.12, 0.14];
const GUN_RIGHT_SLEEVE_POS: [number, number, number] = [0.2, -0.28, 0.2];
const GUN_RIGHT_SLEEVE_ROT: [number, number, number] = [0.16, -0.12, 0.14];

// CS2 knife rest pose (held diagonally across screen pointing toward center, elevated as in knifeiwant.png):
const KNIFE_BASE_POS: [number, number, number] = [-0.03, 0.0, -0.03];
const KNIFE_BASE_ROT: [number, number, number] = [-0.48, 1.22, -0.46];

const KNIFE_RIGHT_HAND_POS: [number, number, number] = [0.09, -0.06, 0.08];
const KNIFE_RIGHT_HAND_ROT: [number, number, number] = [-0.35, 0.48, -0.22];
const KNIFE_RIGHT_SLEEVE_POS: [number, number, number] = [0.19, -0.16, 0.23];
const KNIFE_RIGHT_SLEEVE_ROT: [number, number, number] = [-0.35, 0.48, -0.22];

const KNIFE_SLASH_DURATION = 0.3;

type InspectCategory = 'knife' | 'pistol' | 'rifle' | 'grenade';

function getInspectCategory(weaponId: WeaponId): InspectCategory {
  if (weaponId === 'knife') {
    return 'knife';
  }
  const definition = getWeapon(weaponId);
  if (definition.slot === 'secondary') {
    return 'pistol';
  }
  if (definition.slot === 'grenade') {
    return 'grenade';
  }
  return 'rifle';
}

function getInspectDuration(category: InspectCategory): number {
  switch (category) {
    case 'knife':
      return 2.2;
    case 'pistol':
      return 2.4;
    case 'rifle':
      return 2.6;
    case 'grenade':
      return 2.0;
  }
}

export interface ViewmodelState {
  now: number;
  moving: boolean;
  crouching: boolean;
  reloading: boolean;
  reloadProgress: number;
  alive: boolean;
}

export class Viewmodel {
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;

  private readonly root = new Group();
  private readonly flashGroup = new Group();
  private readonly flashLight: PointLight;
  private readonly flashMesh: Mesh<SphereGeometry, MeshBasicMaterial>;
  private readonly leftHand: Mesh;
  private readonly rightHand: Mesh;
  private readonly leftSleeve: Mesh;
  private readonly rightSleeve: Mesh;

  private weapon: WeaponModel | null = null;
  private weaponId: WeaponId | null = null;
  private recoil = 0;
  private flashTime = 0;
  private switchOffset = 0;
  private magazineBase: Vector3 | null = null;
  private slideBase: Vector3 | null = null;
  private boltBase: Vector3 | null = null;
  private knifeSlashTime = 0;
  private knifeSlashSide = 0;
  private inspecting = false;
  private inspectTimer = 0;
  private inspectDuration = 2.2;
  private visible = true;
  private disposed = false;

  constructor(aspect: number) {
    this.camera = new PerspectiveCamera(58, aspect, 0.01, 10);
    this.camera.position.set(0, 0, 0);

    this.scene.add(new AmbientLight(0xffe2c0, 1.05));
    const key = new DirectionalLight(0xfff2dd, 2.4);
    key.position.set(1.5, 2.5, 1.2);
    this.scene.add(key);
    const rim = new PointLight(0xffb86b, 2.2, 4, 2);
    rim.position.set(-1.1, 0.2, -0.4);
    this.scene.add(rim);

    this.root.position.set(VIEWMODEL_BASE_X, VIEWMODEL_BASE_Y, VIEWMODEL_BASE_Z);
    this.root.scale.setScalar(0.9);
    this.scene.add(this.root);

    const glove = new MeshStandardMaterial({
      color: 0x111c2a,
      roughness: 0.72,
      metalness: 0.16,
    });
    const sleeve = new MeshStandardMaterial({
      color: 0x1d3448,
      roughness: 0.8,
      metalness: 0.1,
    });

    this.leftHand = new Mesh(new BoxGeometry(0.12, 0.14, 0.22), glove);
    this.leftHand.position.set(...GUN_LEFT_HAND_POS);
    this.leftHand.rotation.set(...GUN_LEFT_HAND_ROT);
    this.root.add(this.leftHand);

    this.rightHand = new Mesh(new BoxGeometry(0.13, 0.15, 0.23), glove);
    this.rightHand.position.set(...GUN_RIGHT_HAND_POS);
    this.rightHand.rotation.set(...GUN_RIGHT_HAND_ROT);
    this.root.add(this.rightHand);

    this.leftSleeve = new Mesh(new BoxGeometry(0.16, 0.2, 0.3), sleeve);
    this.leftSleeve.position.set(...GUN_LEFT_SLEEVE_POS);
    this.leftSleeve.rotation.set(...GUN_LEFT_SLEEVE_ROT);
    this.root.add(this.leftSleeve);

    this.rightSleeve = new Mesh(new BoxGeometry(0.17, 0.2, 0.3), sleeve);
    this.rightSleeve.position.set(...GUN_RIGHT_SLEEVE_POS);
    this.rightSleeve.rotation.set(...GUN_RIGHT_SLEEVE_ROT);
    this.root.add(this.rightSleeve);

    this.flashLight = new PointLight(0xffcf66, 0, 3.5, 2);
    this.flashLight.position.set(0, 0.02, -0.45);
    this.root.add(this.flashLight);

    this.flashMesh = new Mesh(
      new SphereGeometry(0.05, 8, 6),
      new MeshBasicMaterial({
        color: 0xffd166,
        transparent: true,
        opacity: 0.95,
        blending: AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    this.flashMesh.position.set(0, 0, 0);
    this.flashMesh.visible = false;
    this.flashGroup.add(this.flashMesh);
    this.root.add(this.flashGroup);
  }

  setWeapon(weaponId: WeaponId): void {
    if (this.disposed || this.weaponId === weaponId) {
      return;
    }

    this.cancelInspect();
    this.weapon?.dispose();
    this.weapon = createWeaponModel(weaponId, 1);
    this.root.add(this.weapon.group);
    this.flashGroup.position.copy(this.weapon.muzzle.position);
    this.flashLight.position.copy(this.weapon.muzzle.position);
    this.magazineBase = this.weapon.magazine?.position.clone() ?? null;
    this.slideBase = this.weapon.slide?.position.clone() ?? null;
    this.boltBase = this.weapon.bolt?.position.clone() ?? null;
    this.weaponId = weaponId;
    this.switchOffset = 0.3;
    this.knifeSlashTime = 0;

    const isKnife = weaponId === 'knife';
    this.leftHand.visible = !isKnife;
    this.leftSleeve.visible = !isKnife;

    this.resetPose();
  }

  triggerFire(): void {
    if (this.weaponId === 'knife') {
      this.triggerKnifeSlash();
      return;
    }
    this.cancelInspect();
    this.recoil = Math.min(0.18, this.recoil + 0.055);
    this.flashTime = 0.05;
    this.flashMesh.rotation.z = Math.random() * Math.PI;
  }

  triggerKnifeSlash(): void {
    this.cancelInspect();
    this.knifeSlashTime = KNIFE_SLASH_DURATION;
    this.knifeSlashSide = (this.knifeSlashSide + 1) % 2;
    this.flashTime = 0;
    this.flashMesh.visible = false;
    this.flashLight.intensity = 0;
    this.recoil = 0;
  }

  triggerInspect(): void {
    if (this.weapon === null || this.weaponId === null) {
      return;
    }
    const category = getInspectCategory(this.weaponId);
    this.inspectDuration = getInspectDuration(category);
    this.inspectTimer = 0;
    this.inspecting = true;
  }

  cancelInspect(): void {
    if (!this.inspecting) {
      return;
    }
    this.inspecting = false;
    this.inspectTimer = 0;
    this.resetPose();
  }

  private resetPose(): void {
    if (this.weapon === null) {
      return;
    }
    if (this.weaponId === 'knife') {
      this.weapon.group.position.set(...KNIFE_BASE_POS);
      this.weapon.group.rotation.set(...KNIFE_BASE_ROT);
      this.rightHand.position.set(...KNIFE_RIGHT_HAND_POS);
      this.rightHand.rotation.set(...KNIFE_RIGHT_HAND_ROT);
      this.rightSleeve.position.set(...KNIFE_RIGHT_SLEEVE_POS);
      this.rightSleeve.rotation.set(...KNIFE_RIGHT_SLEEVE_ROT);
    } else {
      this.weapon.group.position.set(0, 0, 0);
      this.weapon.group.rotation.set(0, 0, 0);
      this.leftHand.position.set(...GUN_LEFT_HAND_POS);
      this.leftHand.rotation.set(...GUN_LEFT_HAND_ROT);
      this.leftSleeve.position.set(...GUN_LEFT_SLEEVE_POS);
      this.leftSleeve.rotation.set(...GUN_LEFT_SLEEVE_ROT);
      this.rightHand.position.set(...GUN_RIGHT_HAND_POS);
      this.rightHand.rotation.set(...GUN_RIGHT_HAND_ROT);
      this.rightSleeve.position.set(...GUN_RIGHT_SLEEVE_POS);
      this.rightSleeve.rotation.set(...GUN_RIGHT_SLEEVE_ROT);
    }
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.root.visible = visible;
  }

  update(dt: number, state: ViewmodelState): void {
    if (this.disposed) {
      return;
    }

    this.root.visible = this.visible && state.alive;
    if (!this.root.visible) {
      return;
    }

    if (this.inspecting) {
      if (state.reloading) {
        this.cancelInspect();
      } else {
        this.inspectTimer += dt;
        if (this.inspectTimer >= this.inspectDuration) {
          this.cancelInspect();
        }
      }
    }

    const isKnife = this.weaponId === 'knife';
    this.recoil = isKnife ? 0 : Math.max(0, this.recoil - dt * 0.9);
    this.switchOffset = Math.max(0, this.switchOffset - dt * 1.3);

    const bobStrength = state.moving ? 0.012 : 0.0035;
    const bobSpeed = state.moving ? 0.012 : 0.0028;
    const bobX = Math.sin(state.now * bobSpeed) * bobStrength;
    const bobY = Math.cos(state.now * bobSpeed * 2) * bobStrength * 0.65;
    const crouchOffset = state.crouching ? 0.035 : 0;
    const reloadArc = state.reloading ? Math.sin(state.reloadProgress * Math.PI) : 0;

    if (isKnife) {
      if (this.knifeSlashTime > 0) {
        this.animateKnifeSlash(dt);
      } else if (this.inspecting) {
        this.animateKnifeInspect();
      } else {
        this.resetPose();
      }
    } else {
      this.animateReloadParts(state.reloading ? state.reloadProgress : 0);
      if (!state.reloading && this.inspecting) {
        this.animateGunInspect();
      } else if (!state.reloading) {
        this.resetPose();
      }
    }

    const slashThrust =
      isKnife && this.knifeSlashTime > 0
        ? Math.sin((1 - this.knifeSlashTime / KNIFE_SLASH_DURATION) * Math.PI) * 0.035
        : 0;

    this.root.position.set(
      VIEWMODEL_BASE_X + bobX + reloadArc * 0.035,
      VIEWMODEL_BASE_Y + bobY - crouchOffset - reloadArc * 0.2 - this.switchOffset,
      VIEWMODEL_BASE_Z + this.recoil * 0.55 - slashThrust,
    );
    this.root.rotation.set(
      this.recoil * 1.8 - reloadArc * 0.38,
      Math.sin(state.now * 0.0016) * 0.012,
      reloadArc * 0.55 + this.recoil * 0.35,
    );

    this.flashTime = isKnife ? 0 : Math.max(0, this.flashTime - dt);
    const flashVisible = !isKnife && this.flashTime > 0;
    this.flashMesh.visible = flashVisible;
    this.flashLight.intensity = flashVisible ? 18 : 0;
    if (flashVisible) {
      const scale = 0.7 + Math.random() * 0.9;
      this.flashMesh.scale.setScalar(scale);
    }
  }

  private animateKnifeSlash(dt: number): void {
    if (this.weapon === null) {
      return;
    }

    let dx = 0;
    let dy = 0;
    let dz = 0;
    let rx = 0;
    let ry = 0;
    let rz = 0;

    if (this.knifeSlashTime > 0) {
      this.knifeSlashTime = Math.max(0, this.knifeSlashTime - dt);
      const progress = 1 - this.knifeSlashTime / KNIFE_SLASH_DURATION; // 0 to 1

      if (progress < 0.15) {
        // Anticipation (windup): slight pull back & rotation preparation
        const p = progress / 0.15;
        const dir = this.knifeSlashSide === 0 ? 1 : -1;
        dx = 0.02 * p * dir;
        dy = 0.01 * p;
        dz = 0.03 * p;
        rx = -0.08 * p;
        ry = -0.15 * p * dir;
        rz = 0.08 * p * dir;
      } else if (progress < 0.6) {
        // The slash swing arc (fast whip across screen)
        const p = (progress - 0.15) / 0.45; // 0 to 1
        const arc = Math.sin(p * Math.PI);
        if (this.knifeSlashSide === 0) {
          // Slash A: right-to-left downward cutting slash
          dx = -0.14 * arc;
          dy = -0.06 * arc;
          dz = -0.12 * arc;
          rx = 0.3 * arc;
          ry = 0.35 * arc;
          rz = -0.4 * arc;
        } else {
          // Slash B: left-to-right upward cutting slash
          dx = 0.12 * arc;
          dy = 0.08 * arc;
          dz = -0.1 * arc;
          rx = -0.25 * arc;
          ry = -0.3 * arc;
          rz = 0.35 * arc;
        }
      } else {
        // Recovery: smooth ease back to resting CS2 diagonal
        const p = (progress - 0.6) / 0.4;
        const decay = Math.pow(1 - p, 2);
        if (this.knifeSlashSide === 0) {
          dx = -0.03 * decay;
          dy = -0.01 * decay;
          dz = -0.02 * decay;
          rx = 0.06 * decay;
          ry = 0.07 * decay;
          rz = -0.08 * decay;
        } else {
          dx = 0.02 * decay;
          dy = 0.01 * decay;
          dz = -0.02 * decay;
          rx = -0.05 * decay;
          ry = -0.06 * decay;
          rz = 0.07 * decay;
        }
      }
    }

    this.weapon.group.position.set(
      KNIFE_BASE_POS[0] + dx,
      KNIFE_BASE_POS[1] + dy,
      KNIFE_BASE_POS[2] + dz,
    );
    this.weapon.group.rotation.set(
      KNIFE_BASE_ROT[0] + rx,
      KNIFE_BASE_ROT[1] + ry,
      KNIFE_BASE_ROT[2] + rz,
    );

    this.rightHand.position.set(
      KNIFE_RIGHT_HAND_POS[0] + dx * 0.9,
      KNIFE_RIGHT_HAND_POS[1] + dy * 0.9,
      KNIFE_RIGHT_HAND_POS[2] + dz * 0.9,
    );
    this.rightHand.rotation.set(
      KNIFE_RIGHT_HAND_ROT[0] + rx * 0.75,
      KNIFE_RIGHT_HAND_ROT[1] + ry * 0.75,
      KNIFE_RIGHT_HAND_ROT[2] + rz * 0.75,
    );
    this.rightSleeve.position.set(
      KNIFE_RIGHT_SLEEVE_POS[0] + dx * 0.75,
      KNIFE_RIGHT_SLEEVE_POS[1] + dy * 0.75,
      KNIFE_RIGHT_SLEEVE_POS[2] + dz * 0.75,
    );
    this.rightSleeve.rotation.set(
      KNIFE_RIGHT_SLEEVE_ROT[0] + rx * 0.6,
      KNIFE_RIGHT_SLEEVE_ROT[1] + ry * 0.6,
      KNIFE_RIGHT_SLEEVE_ROT[2] + rz * 0.6,
    );
  }

  private animateKnifeInspect(): void {
    if (this.weapon === null) {
      return;
    }
    const p = Math.min(1, Math.max(0, this.inspectTimer / this.inspectDuration));
    let dx = 0;
    let dy = 0;
    let dz = 0;
    let rx = 0;
    let ry = 0;
    let rz = 0;

    if (p < 0.45) {
      const s = Math.sin((p / 0.45) * Math.PI);
      dx = -0.015 * s;
      dy = 0.035 * s;
      dz = 0.02 * s;
      rx = 0.15 * s;
      ry = -0.35 * s;
      rz = -0.55 * s;
    } else if (p < 0.9) {
      const s = Math.sin(((p - 0.45) / 0.45) * Math.PI);
      dx = 0.012 * s;
      dy = 0.025 * s;
      dz = 0.02 * s;
      rx = -0.12 * s;
      ry = 0.28 * s;
      rz = 0.45 * s;
    }

    this.weapon.group.position.set(
      KNIFE_BASE_POS[0] + dx,
      KNIFE_BASE_POS[1] + dy,
      KNIFE_BASE_POS[2] + dz,
    );
    this.weapon.group.rotation.set(
      KNIFE_BASE_ROT[0] + rx,
      KNIFE_BASE_ROT[1] + ry,
      KNIFE_BASE_ROT[2] + rz,
    );

    this.rightHand.position.set(
      KNIFE_RIGHT_HAND_POS[0] + dx * 0.9,
      KNIFE_RIGHT_HAND_POS[1] + dy * 0.9,
      KNIFE_RIGHT_HAND_POS[2] + dz * 0.9,
    );
    this.rightHand.rotation.set(
      KNIFE_RIGHT_HAND_ROT[0] + rx * 0.75,
      KNIFE_RIGHT_HAND_ROT[1] + ry * 0.75,
      KNIFE_RIGHT_HAND_ROT[2] + rz * 0.75,
    );
    this.rightSleeve.position.set(
      KNIFE_RIGHT_SLEEVE_POS[0] + dx * 0.75,
      KNIFE_RIGHT_SLEEVE_POS[1] + dy * 0.75,
      KNIFE_RIGHT_SLEEVE_POS[2] + dz * 0.75,
    );
    this.rightSleeve.rotation.set(
      KNIFE_RIGHT_SLEEVE_ROT[0] + rx * 0.6,
      KNIFE_RIGHT_SLEEVE_ROT[1] + ry * 0.6,
      KNIFE_RIGHT_SLEEVE_ROT[2] + rz * 0.6,
    );
  }

  private animateGunInspect(): void {
    if (this.weapon === null || this.weaponId === null) {
      return;
    }
    const category = getInspectCategory(this.weaponId);
    const p = Math.min(1, Math.max(0, this.inspectTimer / this.inspectDuration));
    let dx = 0;
    let dy = 0;
    let dz = 0;
    let rx = 0;
    let ry = 0;
    let rz = 0;

    if (category === 'pistol') {
      if (p < 0.48) {
        const s = Math.sin((p / 0.48) * Math.PI);
        dx = -0.04 * s;
        dy = 0.055 * s;
        dz = 0.05 * s;
        rx = -0.12 * s;
        ry = -0.32 * s;
        rz = 0.55 * s;
      } else if (p < 0.92) {
        const s = Math.sin(((p - 0.48) / 0.44) * Math.PI);
        dx = 0.03 * s;
        dy = 0.04 * s;
        dz = 0.035 * s;
        rx = -0.08 * s;
        ry = 0.25 * s;
        rz = -0.42 * s;
      }
    } else if (category === 'grenade') {
      const s = Math.sin(p * Math.PI);
      dy = 0.045 * s;
      dz = 0.04 * s;
      ry = -0.25 * s;
      rz = 0.45 * s;
    } else {
      if (p < 0.5) {
        const s = Math.sin((p / 0.5) * Math.PI);
        dx = -0.035 * s;
        dy = 0.05 * s;
        dz = 0.055 * s;
        rx = -0.1 * s;
        ry = -0.22 * s;
        rz = 0.42 * s;
      } else if (p < 0.92) {
        const s = Math.sin(((p - 0.5) / 0.42) * Math.PI);
        dx = 0.025 * s;
        dy = 0.03 * s;
        dz = 0.035 * s;
        rx = -0.05 * s;
        ry = 0.15 * s;
        rz = -0.25 * s;
      }
    }

    this.weapon.group.position.set(dx, dy, dz);
    this.weapon.group.rotation.set(rx, ry, rz);

    this.rightHand.position.set(
      GUN_RIGHT_HAND_POS[0] + dx,
      GUN_RIGHT_HAND_POS[1] + dy,
      GUN_RIGHT_HAND_POS[2] + dz,
    );
    this.rightHand.rotation.set(
      GUN_RIGHT_HAND_ROT[0] + rx * 0.8,
      GUN_RIGHT_HAND_ROT[1] + ry * 0.8,
      GUN_RIGHT_HAND_ROT[2] + rz * 0.8,
    );

    this.leftHand.position.set(
      GUN_LEFT_HAND_POS[0] + dx,
      GUN_LEFT_HAND_POS[1] + dy,
      GUN_LEFT_HAND_POS[2] + dz,
    );
    this.leftHand.rotation.set(
      GUN_LEFT_HAND_ROT[0] + rx * 0.8,
      GUN_LEFT_HAND_ROT[1] + ry * 0.8,
      GUN_LEFT_HAND_ROT[2] + rz * 0.8,
    );

    this.rightSleeve.position.set(
      GUN_RIGHT_SLEEVE_POS[0] + dx * 0.8,
      GUN_RIGHT_SLEEVE_POS[1] + dy * 0.8,
      GUN_RIGHT_SLEEVE_POS[2] + dz * 0.8,
    );
    this.rightSleeve.rotation.set(
      GUN_RIGHT_SLEEVE_ROT[0] + rx * 0.8,
      GUN_RIGHT_SLEEVE_ROT[1] + ry * 0.8,
      GUN_RIGHT_SLEEVE_ROT[2] + rz * 0.8,
    );

    this.leftSleeve.position.set(
      GUN_LEFT_SLEEVE_POS[0] + dx * 0.8,
      GUN_LEFT_SLEEVE_POS[1] + dy * 0.8,
      GUN_LEFT_SLEEVE_POS[2] + dz * 0.8,
    );
    this.leftSleeve.rotation.set(
      GUN_LEFT_SLEEVE_ROT[0] + rx * 0.8,
      GUN_LEFT_SLEEVE_ROT[1] + ry * 0.8,
      GUN_LEFT_SLEEVE_ROT[2] + rz * 0.8,
    );
  }

  private animateReloadParts(progress: number): void {
    const weapon = this.weapon;
    if (weapon === null) {
      return;
    }

    const p = Math.max(0, Math.min(1, progress));
    let magazineOut = 0;
    let boltBack = 0;
    if (p > 0.28 && p < 0.5) {
      magazineOut = (p - 0.28) / 0.22;
    } else if (p >= 0.5 && p < 0.7) {
      magazineOut = 1 - (p - 0.5) / 0.2;
    }
    if (p > 0.72) {
      boltBack = Math.sin(((p - 0.72) / 0.28) * Math.PI);
    }

    if (weapon.magazine !== undefined && this.magazineBase !== null) {
      weapon.magazine.position.set(
        this.magazineBase.x,
        this.magazineBase.y - magazineOut * 0.14,
        this.magazineBase.z + magazineOut * 0.07,
      );
      weapon.magazine.rotation.x = magazineOut * 0.38;
    }
    if (weapon.slide !== undefined && this.slideBase !== null) {
      weapon.slide.position.set(
        this.slideBase.x,
        this.slideBase.y,
        this.slideBase.z + boltBack * 0.1,
      );
    }
    if (weapon.bolt !== undefined && this.boltBase !== null) {
      weapon.bolt.position.set(this.boltBase.x, this.boltBase.y, this.boltBase.z + boltBack * 0.14);
      weapon.bolt.rotation.z = boltBack * 0.45;
    }
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  render(renderer: WebGLRenderer): void {
    if (this.disposed || !this.visible || !this.root.visible) {
      return;
    }
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.cancelInspect();
    this.weapon?.dispose();
    disposeObject3D(this.scene);
  }
}

export function configureViewmodelRenderer(renderer: WebGLRenderer): void {
  renderer.autoClear = false;
  renderer.outputColorSpace = SRGBColorSpace;
}
