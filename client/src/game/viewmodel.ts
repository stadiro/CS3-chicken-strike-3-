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
import type { WeaponId } from '../../../shared/weapons';
import { disposeObject3D } from './dispose';
import { createWeaponModel, type WeaponModel } from './weaponModel';

const VIEWMODEL_BASE_X = 0.28;
const VIEWMODEL_BASE_Y = -0.24;
const VIEWMODEL_BASE_Z = -0.78;

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
  private weapon: WeaponModel | null = null;
  private weaponId: WeaponId | null = null;
  private recoil = 0;
  private flashTime = 0;
  private switchOffset = 0;
  private magazineBase: Vector3 | null = null;
  private slideBase: Vector3 | null = null;
  private boltBase: Vector3 | null = null;
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

    const leftHand = new Mesh(new BoxGeometry(0.12, 0.14, 0.22), glove);
    leftHand.position.set(-0.08, -0.12, -0.14);
    leftHand.rotation.set(-0.2, 0.1, -0.2);
    this.root.add(leftHand);

    const rightHand = new Mesh(new BoxGeometry(0.13, 0.15, 0.23), glove);
    rightHand.position.set(0.1, -0.17, 0.03);
    rightHand.rotation.set(0.16, -0.12, 0.14);
    this.root.add(rightHand);

    const leftSleeve = new Mesh(new BoxGeometry(0.16, 0.2, 0.3), sleeve);
    leftSleeve.position.set(-0.15, -0.22, 0.06);
    leftSleeve.rotation.set(-0.2, 0.1, -0.2);
    this.root.add(leftSleeve);

    const rightSleeve = new Mesh(new BoxGeometry(0.17, 0.2, 0.3), sleeve);
    rightSleeve.position.set(0.2, -0.28, 0.2);
    rightSleeve.rotation.set(0.16, -0.12, 0.14);
    this.root.add(rightSleeve);

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

    this.weapon?.dispose();
    this.weapon = createWeaponModel(weaponId, 1);
    this.weapon.group.position.set(0, 0, 0);
    this.root.add(this.weapon.group);
    this.flashGroup.position.copy(this.weapon.muzzle.position);
    this.flashLight.position.copy(this.weapon.muzzle.position);
    this.magazineBase = this.weapon.magazine?.position.clone() ?? null;
    this.slideBase = this.weapon.slide?.position.clone() ?? null;
    this.boltBase = this.weapon.bolt?.position.clone() ?? null;
    this.weaponId = weaponId;
    this.switchOffset = 0.3;
  }

  triggerFire(): void {
    this.recoil = Math.min(0.18, this.recoil + 0.055);
    this.flashTime = 0.05;
    this.flashMesh.rotation.z = Math.random() * Math.PI;
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

    this.recoil = Math.max(0, this.recoil - dt * 0.9);
    this.switchOffset = Math.max(0, this.switchOffset - dt * 1.3);

    const bobStrength = state.moving ? 0.012 : 0.0035;
    const bobSpeed = state.moving ? 0.012 : 0.0028;
    const bobX = Math.sin(state.now * bobSpeed) * bobStrength;
    const bobY = Math.cos(state.now * bobSpeed * 2) * bobStrength * 0.65;
    const crouchOffset = state.crouching ? 0.035 : 0;
    const reloadArc = state.reloading ? Math.sin(state.reloadProgress * Math.PI) : 0;
    this.animateReloadParts(state.reloading ? state.reloadProgress : 0);

    this.root.position.set(
      VIEWMODEL_BASE_X + bobX + reloadArc * 0.035,
      VIEWMODEL_BASE_Y + bobY - crouchOffset - reloadArc * 0.2 - this.switchOffset,
      VIEWMODEL_BASE_Z + this.recoil * 0.55,
    );
    this.root.rotation.set(
      this.recoil * 1.8 - reloadArc * 0.38,
      Math.sin(state.now * 0.0016) * 0.012,
      reloadArc * 0.55 + this.recoil * 0.35,
    );

    this.flashTime = Math.max(0, this.flashTime - dt);
    const flashVisible = this.flashTime > 0;
    this.flashMesh.visible = flashVisible;
    this.flashLight.intensity = flashVisible ? 18 : 0;
    if (flashVisible) {
      const scale = 0.7 + Math.random() * 0.9;
      this.flashMesh.scale.setScalar(scale);
    }
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
    this.weapon?.dispose();
    disposeObject3D(this.scene);
  }
}

export function configureViewmodelRenderer(renderer: WebGLRenderer): void {
  renderer.autoClear = false;
  renderer.outputColorSpace = SRGBColorSpace;
}
