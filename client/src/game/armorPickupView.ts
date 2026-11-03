import {
  AdditiveBlending,
  BoxGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  RingGeometry,
} from 'three';
import type { ArmorPickupSnapshot } from '../../../shared/protocol';
import { disposeObject3D } from './dispose';

export class ArmorPickupView {
  readonly root = new Group();

  private readonly inner = new Group();
  private disposed = false;

  constructor(pickup: ArmorPickupSnapshot) {
    this.root.name = `armor-${pickup.id}`;
    this.root.position.set(pickup.position.x, pickup.position.y, pickup.position.z);

    const ring = new Mesh(
      new RingGeometry(0.38, 0.56, 32),
      new MeshBasicMaterial({
        color: 0x60a5fa,
        transparent: true,
        opacity: 0.55,
        side: DoubleSide,
        blending: AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = -0.88;
    this.root.add(ring);

    const vest = new MeshStandardMaterial({
      color: 0x2f5f8f,
      roughness: 0.58,
      metalness: 0.18,
    });
    const plate = new MeshStandardMaterial({
      color: 0x7fb6e8,
      roughness: 0.38,
      metalness: 0.42,
    });
    const strap = new MeshStandardMaterial({
      color: 0x1d344d,
      roughness: 0.76,
      metalness: 0.08,
    });

    const body = new Mesh(new BoxGeometry(0.62, 0.64, 0.22), vest);
    body.position.y = 0.02;
    this.inner.add(body);

    const front = new Mesh(new BoxGeometry(0.42, 0.4, 0.05), plate);
    front.position.set(0, 0.05, 0.135);
    this.inner.add(front);

    const left = new Mesh(new BoxGeometry(0.2, 0.58, 0.18), strap);
    left.position.set(-0.27, 0.04, 0.02);
    this.inner.add(left);
    const right = left.clone();
    right.position.x = 0.27;
    this.inner.add(right);

    const collar = new Mesh(new BoxGeometry(0.5, 0.1, 0.24), plate);
    collar.position.set(0, 0.35, 0);
    this.inner.add(collar);

    this.root.add(this.inner);
  }

  update(now: number): void {
    if (this.disposed) {
      return;
    }
    this.inner.position.y = 0.1 + Math.sin(now * 0.0022 + 0.8) * 0.06;
    this.inner.rotation.y = now * 0.0016;
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    disposeObject3D(this.root);
  }
}
