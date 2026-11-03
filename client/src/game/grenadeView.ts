import {
  Group,
  Mesh,
  MeshStandardMaterial,
  PointLight,
  SphereGeometry,
  TorusGeometry,
} from 'three';
import type { GrenadeType } from '../../../shared/economy';
import type { GrenadeSnapshot } from '../../../shared/protocol';
import { disposeObject3D } from './dispose';

const GRENADE_STYLE: Record<GrenadeType, { body: number; emissive: number; light: number }> = {
  hegrenade: { body: 0x4f6b3f, emissive: 0x17250f, light: 0xff6b3d },
  flashbang: { body: 0x8a8f98, emissive: 0x3a3d44, light: 0xfef9c3 },
  smokegrenade: { body: 0x5f6b73, emissive: 0x1f2933, light: 0xd1d5db },
  molotov: { body: 0x8a4a2a, emissive: 0x3b1408, light: 0xff6b3d },
  incendiary: { body: 0x8a3b2a, emissive: 0x3b0d08, light: 0xff4d2e },
};

export class GrenadeView {
  readonly root = new Group();

  private readonly light: PointLight;
  private readonly body: Mesh<SphereGeometry, MeshStandardMaterial>;

  constructor(snapshot: GrenadeSnapshot) {
    const style = GRENADE_STYLE[snapshot.type] ?? GRENADE_STYLE.hegrenade;
    const bodyMaterial = new MeshStandardMaterial({
      color: style.body,
      roughness: 0.52,
      metalness: 0.28,
      emissive: style.emissive,
      emissiveIntensity: 0.5,
    });
    this.body = new Mesh(new SphereGeometry(0.14, 12, 8), bodyMaterial);
    this.root.add(this.body);

    const bandMaterial = new MeshStandardMaterial({
      color: 0x1a2117,
      roughness: 0.4,
      metalness: 0.5,
    });
    const band = new Mesh(new TorusGeometry(0.13, 0.022, 6, 14), bandMaterial);
    band.rotation.x = Math.PI / 2;
    this.root.add(band);

    const cap = new Mesh(new TorusGeometry(0.055, 0.018, 6, 12), bandMaterial);
    cap.position.y = 0.13;
    cap.rotation.x = Math.PI / 2;
    this.root.add(cap);

    this.light = new PointLight(style.light, 0.8, 2.5, 2);
    this.root.add(this.light);
    this.update(snapshot, 0);
  }

  update(snapshot: GrenadeSnapshot, serverNow: number): void {
    this.root.position.set(snapshot.position.x, snapshot.position.y, snapshot.position.z);
    const remaining = Math.max(0, snapshot.fuseAt - serverNow);
    const blink = remaining < 900 ? 0.4 + Math.abs(Math.sin(remaining * 0.02)) * 1.8 : 0.4;
    this.light.intensity = blink;
    this.body.material.emissiveIntensity = 0.35 + blink * 0.25;
  }

  dispose(): void {
    disposeObject3D(this.root);
  }
}
