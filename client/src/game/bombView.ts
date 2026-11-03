import {
  AdditiveBlending,
  BoxGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  RingGeometry,
  SphereGeometry,
} from 'three';
import type { BombSnapshot } from '../../../shared/protocol';
import { disposeObject3D } from './dispose';

export class BombView {
  readonly root = new Group();

  private readonly pack = new Group();
  private readonly ledMaterial: MeshBasicMaterial;
  private readonly ringMaterial: MeshBasicMaterial;
  private readonly ring: Mesh;
  private disposed = false;

  constructor() {
    this.root.name = 'c4-bomb';
    this.root.visible = false;

    this.ringMaterial = new MeshBasicMaterial({
      color: 0xf59e0b,
      transparent: true,
      opacity: 0.55,
      side: DoubleSide,
      blending: AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    this.ring = new Mesh(new RingGeometry(0.28, 0.44, 32), this.ringMaterial);
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.02;
    this.root.add(this.ring);

    const brickMat = new MeshStandardMaterial({
      color: 0x4b5544,
      roughness: 0.72,
      metalness: 0.12,
    });
    const strapMat = new MeshStandardMaterial({
      color: 0x1e242b,
      roughness: 0.55,
      metalness: 0.25,
    });
    const screenMat = new MeshBasicMaterial({
      color: 0x22d3ee,
      toneMapped: false,
    });
    this.ledMaterial = new MeshBasicMaterial({
      color: 0xff2e4c,
      toneMapped: false,
    });

    const leftBrick = new Mesh(new BoxGeometry(0.16, 0.1, 0.28), brickMat);
    leftBrick.position.set(-0.09, 0.05, 0);
    this.pack.add(leftBrick);

    const rightBrick = new Mesh(new BoxGeometry(0.16, 0.1, 0.28), brickMat);
    rightBrick.position.set(0.09, 0.05, 0);
    this.pack.add(rightBrick);

    const strapA = new Mesh(new BoxGeometry(0.38, 0.11, 0.045), strapMat);
    strapA.position.set(0, 0.055, -0.07);
    this.pack.add(strapA);

    const strapB = strapA.clone();
    strapB.position.z = 0.07;
    this.pack.add(strapB);

    const keypad = new Mesh(new BoxGeometry(0.16, 0.045, 0.14), strapMat);
    keypad.position.set(0, 0.11, 0);
    this.pack.add(keypad);

    const screen = new Mesh(new BoxGeometry(0.11, 0.01, 0.05), screenMat);
    screen.position.set(0, 0.135, -0.03);
    this.pack.add(screen);

    const antenna = new Mesh(new CylinderGeometry(0.008, 0.008, 0.14, 8), strapMat);
    antenna.position.set(0.1, 0.16, -0.09);
    this.pack.add(antenna);

    const led = new Mesh(new SphereGeometry(0.028, 12, 12), this.ledMaterial);
    led.position.set(0.1, 0.23, -0.09);
    this.pack.add(led);

    this.root.add(this.pack);
  }

  update(bomb: BombSnapshot | null, serverNow: number): void {
    if (this.disposed) {
      return;
    }
    if (
      bomb === null ||
      bomb.position === null ||
      (bomb.state !== 'dropped' && bomb.state !== 'planted')
    ) {
      this.root.visible = false;
      return;
    }

    this.root.visible = true;
    this.root.position.set(bomb.position.x, bomb.position.y, bomb.position.z);

    if (bomb.state === 'dropped') {
      this.pack.position.y = 0.12 + Math.sin(serverNow * 0.003) * 0.04;
      this.pack.rotation.y = serverNow * 0.0018;
      this.ringMaterial.color.setHex(0xf59e0b);
      this.ringMaterial.opacity = 0.5;
      this.ledMaterial.color.setHex(0xf59e0b);
      return;
    }

    this.pack.position.y = 0.01;
    this.pack.rotation.y = 0;
    const remainingMs = bomb.explodeAt !== null ? Math.max(0, bomb.explodeAt - serverNow) : 30_000;
    const urgency = 1 - Math.min(1, remainingMs / 30_000);
    const freq = 0.006 + urgency * 0.028;
    const blink = Math.sin(serverNow * freq) > 0;
    this.ledMaterial.color.setHex(blink ? 0xff2e4c : 0x450a14);
    this.ringMaterial.color.setHex(0xff2e4c);
    this.ringMaterial.opacity = blink ? 0.68 : 0.22;
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    disposeObject3D(this.root);
  }
}
