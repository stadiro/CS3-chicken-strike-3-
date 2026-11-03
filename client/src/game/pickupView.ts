import { AdditiveBlending, DoubleSide, Group, Mesh, MeshBasicMaterial, RingGeometry } from 'three';
import type { PickupSnapshot } from '../../../shared/protocol';
import { getWeapon } from '../../../shared/weapons';
import { disposeObject3D } from './dispose';
import { createWeaponModel, type WeaponModel } from './weaponModel';

export class PickupView {
  readonly root = new Group();

  private readonly inner = new Group();
  private readonly weapon: WeaponModel;
  private disposed = false;

  constructor(pickup: PickupSnapshot) {
    this.root.name = `pickup-${pickup.id}`;
    this.root.position.set(pickup.position.x, pickup.position.y, pickup.position.z);

    const definition = getWeapon(pickup.weapon);
    const ring = new Mesh(
      new RingGeometry(0.34, 0.5, 32),
      new MeshBasicMaterial({
        color: definition.color,
        transparent: true,
        opacity: 0.55,
        side: DoubleSide,
        blending: AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = -0.84;
    this.root.add(ring);

    this.weapon = createWeaponModel(pickup.weapon, pickup.kind === 'dropped' ? 0.76 : 0.9);
    this.weapon.group.rotation.z = -0.12;
    this.inner.add(this.weapon.group);
    this.root.add(this.inner);
  }

  update(now: number): void {
    if (this.disposed) {
      return;
    }
    this.inner.position.y = 0.08 + Math.sin(now * 0.0022) * 0.06;
    this.inner.rotation.y = now * 0.0014;
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.weapon.dispose();
    disposeObject3D(this.root);
  }
}
