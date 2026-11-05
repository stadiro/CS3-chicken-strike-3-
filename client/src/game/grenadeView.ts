import {
  Group,
  Mesh,
  MeshStandardMaterial,
  PointLight,
  SphereGeometry,
} from 'three';
import type { GrenadeType } from '../../../shared/economy';
import type { GrenadeSnapshot } from '../../../shared/protocol';
import { disposeObject3D } from './dispose';
import { createWeaponModel, type WeaponModel } from './weaponModel';

const GRENADE_STYLE: Record<GrenadeType, { emissive: number; light: number }> = {
  hegrenade: { emissive: 0xff3b1f, light: 0xff6b3d },
  flashbang: { emissive: 0xfef3c7, light: 0xfef9c3 },
  smokegrenade: { emissive: 0xd1d5db, light: 0xd1d5db },
  molotov: { emissive: 0xff7a1f, light: 0xff6b3d },
  incendiary: { emissive: 0xff4d2e, light: 0xff4d2e },
};

/** Model-space centre of the grenade body in `createWeaponModel` (see weaponModel.ts). */
const BODY_OFFSET_Y = 0.02;
const BODY_OFFSET_Z = -0.08;
const WORLD_SCALE = 1.05;

export class GrenadeView {
  readonly root = new Group();

  private readonly light: PointLight;
  private readonly model: WeaponModel;
  /** Small per-instance fuze indicator; the model itself uses shared materials. */
  private readonly indicator: Mesh<SphereGeometry, MeshStandardMaterial>;

  constructor(snapshot: GrenadeSnapshot) {
    const type: GrenadeType = snapshot.type in GRENADE_STYLE ? snapshot.type : 'hegrenade';
    const style = GRENADE_STYLE[type];

    this.model = createWeaponModel(type, WORLD_SCALE);
    this.model.group.position.set(
      0,
      -BODY_OFFSET_Y * WORLD_SCALE,
      -BODY_OFFSET_Z * WORLD_SCALE,
    );
    this.root.add(this.model.group);

    this.indicator = new Mesh(
      new SphereGeometry(0.014, 6, 4),
      new MeshStandardMaterial({
        color: 0x111111,
        emissive: style.emissive,
        emissiveIntensity: 0.5,
        roughness: 0.4,
        metalness: 0,
      }),
    );
    this.indicator.position.set(0.03, type === 'molotov' ? 0.3 : 0.2, 0);
    this.root.add(this.indicator);

    this.light = new PointLight(style.light, 0.8, 2.5, 2);
    this.root.add(this.light);
    this.update(snapshot, 0);
  }

  update(snapshot: GrenadeSnapshot, serverNow: number): void {
    this.root.position.set(snapshot.position.x, snapshot.position.y, snapshot.position.z);
    const remaining = Math.max(0, snapshot.fuseAt - serverNow);
    const blink = remaining < 900 ? 0.4 + Math.abs(Math.sin(remaining * 0.02)) * 1.8 : 0.4;
    this.light.intensity = blink;
    this.indicator.material.emissiveIntensity = 0.35 + blink * 0.9;
  }

  dispose(): void {
    this.model.dispose();
    disposeObject3D(this.root);
  }
}
