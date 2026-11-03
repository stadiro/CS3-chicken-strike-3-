import {
  AdditiveBlending,
  CircleGeometry,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  PointLight,
  type Scene,
  SphereGeometry,
  Vector3,
} from 'three';
import type { Vec3 } from '../../../shared/math';

interface Spark {
  mesh: Mesh<SphereGeometry, MeshBasicMaterial>;
  velocity: Vector3;
  life: number;
  maxLife: number;
}

interface Flash {
  light: PointLight;
  mesh: Mesh<SphereGeometry, MeshBasicMaterial>;
  life: number;
  maxLife: number;
  intensity: number;
}

interface BulletMark {
  mesh: Mesh<CircleGeometry, MeshBasicMaterial>;
  life: number;
  maxLife: number;
}

interface AreaCloud {
  meshes: Mesh<SphereGeometry, MeshBasicMaterial>[];
  position: Vec3;
  radius: number;
  life: number;
  maxLife: number;
}

interface FireZone {
  meshes: Mesh<SphereGeometry, MeshBasicMaterial>[];
  light: PointLight;
  position: Vec3;
  radius: number;
  life: number;
  maxLife: number;
}

const MAX_BULLET_MARKS = 80;

export class EffectSystem {
  private readonly sparks: Spark[] = [];
  private readonly flashes: Flash[] = [];
  private readonly bulletMarks: BulletMark[] = [];
  private readonly smokeClouds: AreaCloud[] = [];
  private readonly fireZones: FireZone[] = [];
  private disposed = false;

  constructor(private readonly scene: Scene) {}

  /** Leaves a small red impact dot on the surface hit by a bullet. */
  spawnBulletMark(position: Vec3, direction: Vec3): void {
    if (this.disposed) {
      return;
    }
    const material = new MeshBasicMaterial({
      color: 0xef4444,
      transparent: true,
      opacity: 0.92,
      side: DoubleSide,
      depthWrite: false,
      toneMapped: false,
    });
    const mesh = new Mesh(new CircleGeometry(0.032, 10), material);
    const directionVector = new Vector3(direction.x, direction.y, direction.z).normalize();
    mesh.position.set(
      position.x - directionVector.x * 0.012,
      position.y - directionVector.y * 0.012,
      position.z - directionVector.z * 0.012,
    );
    mesh.lookAt(
      position.x + directionVector.x,
      position.y + directionVector.y,
      position.z + directionVector.z,
    );
    mesh.renderOrder = 3;
    this.scene.add(mesh);
    this.bulletMarks.push({ mesh, life: 10, maxLife: 10 });

    while (this.bulletMarks.length > MAX_BULLET_MARKS) {
      const oldest = this.bulletMarks.shift();
      if (oldest === undefined) {
        break;
      }
      this.removeMark(oldest);
    }
  }

  spawnImpact(position: Vec3, color = 0xffd166, count = 7): void {
    if (this.disposed) {
      return;
    }
    for (let index = 0; index < count; index += 1) {
      const material = new MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 1,
        blending: AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      });
      const mesh = new Mesh(new SphereGeometry(0.022 + Math.random() * 0.025, 6, 4), material);
      mesh.position.set(position.x, position.y, position.z);
      this.scene.add(mesh);
      const velocity = new Vector3(
        (Math.random() - 0.5) * 5.5,
        Math.random() * 4.5,
        (Math.random() - 0.5) * 5.5,
      );
      this.sparks.push({ mesh, velocity, life: 0.42, maxLife: 0.42 });
    }

    const flashLight = new PointLight(color, 12, 4, 2);
    flashLight.position.set(position.x, position.y, position.z);
    this.scene.add(flashLight);
    const flashMesh = new Mesh(
      new SphereGeometry(0.09, 8, 6),
      new MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.85,
        blending: AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    flashMesh.position.set(position.x, position.y, position.z);
    this.scene.add(flashMesh);
    this.flashes.push({
      light: flashLight,
      mesh: flashMesh,
      life: 0.09,
      maxLife: 0.09,
      intensity: 12,
    });
  }

  spawnExplosion(position: Vec3, color = 0xff7a3d): void {
    if (this.disposed) {
      return;
    }
    this.spawnImpact(position, color, 22);
    for (let index = 0; index < 14; index += 1) {
      const material = new MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.8,
        blending: AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      });
      const mesh = new Mesh(new SphereGeometry(0.08 + Math.random() * 0.08, 7, 5), material);
      mesh.position.set(
        position.x + (Math.random() - 0.5) * 0.5,
        position.y + Math.random() * 0.5,
        position.z + (Math.random() - 0.5) * 0.5,
      );
      this.scene.add(mesh);
      const velocity = new Vector3(
        (Math.random() - 0.5) * 10,
        Math.random() * 8,
        (Math.random() - 0.5) * 10,
      );
      this.sparks.push({ mesh, velocity, life: 0.65, maxLife: 0.65 });
    }

    const light = new PointLight(color, 90, 18, 2);
    light.position.set(position.x, position.y + 0.4, position.z);
    this.scene.add(light);
    const mesh = new Mesh(
      new SphereGeometry(0.32, 12, 8),
      new MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.9,
        blending: AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    mesh.position.set(position.x, position.y + 0.25, position.z);
    this.scene.add(mesh);
    this.flashes.push({ light, mesh, life: 0.32, maxLife: 0.32, intensity: 90 });
  }

  spawnSmoke(position: Vec3, durationMs = 18_000, radius = 4): void {
    if (this.disposed) {
      return;
    }
    for (let index = this.fireZones.length - 1; index >= 0; index -= 1) {
      const fire = this.fireZones[index];
      if (fire !== undefined && this.areasOverlap(fire.position, fire.radius, position, radius)) {
        this.removeFire(index);
      }
    }
    const meshes: Mesh<SphereGeometry, MeshBasicMaterial>[] = [];
    for (let index = 0; index < 9; index += 1) {
      const material = new MeshBasicMaterial({
        color: 0xd4d9df,
        transparent: true,
        opacity: 0.2,
        depthWrite: false,
        toneMapped: false,
      });
      const mesh = new Mesh(new SphereGeometry(1, 10, 8), material);
      const angle = (index / 9) * Math.PI * 2;
      const offset = radius * (0.18 + Math.random() * 0.42);
      mesh.position.set(
        position.x + Math.cos(angle) * offset,
        position.y + 0.8 + Math.random() * 1.4,
        position.z + Math.sin(angle) * offset,
      );
      mesh.scale.setScalar(radius * (0.5 + Math.random() * 0.35));
      this.scene.add(mesh);
      meshes.push(mesh);
    }
    this.smokeClouds.push({
      meshes,
      position: { ...position },
      radius,
      life: durationMs / 1000,
      maxLife: durationMs / 1000,
    });
  }

  spawnFire(position: Vec3, durationMs = 7_000, radius = 4): void {
    if (this.disposed) {
      return;
    }
    if (
      this.smokeClouds.some((cloud) =>
        this.areasOverlap(cloud.position, cloud.radius, position, radius),
      )
    ) {
      return;
    }
    const meshes: Mesh<SphereGeometry, MeshBasicMaterial>[] = [];
    for (let index = 0; index < 12; index += 1) {
      const material = new MeshBasicMaterial({
        color: index % 3 === 0 ? 0xffd166 : index % 3 === 1 ? 0xff7a3d : 0xef4444,
        transparent: true,
        opacity: 0.55,
        blending: AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      });
      const mesh = new Mesh(new SphereGeometry(0.35 + Math.random() * 0.4, 8, 6), material);
      const angle = Math.random() * Math.PI * 2;
      const offset = Math.random() * radius * 0.72;
      mesh.position.set(
        position.x + Math.cos(angle) * offset,
        position.y + 0.25 + Math.random() * 0.5,
        position.z + Math.sin(angle) * offset,
      );
      this.scene.add(mesh);
      meshes.push(mesh);
    }
    const light = new PointLight(0xff7a3d, 30, radius * 4, 2);
    light.position.set(position.x, position.y + 1.1, position.z);
    this.scene.add(light);
    this.fireZones.push({
      meshes,
      light,
      position: { ...position },
      radius,
      life: durationMs / 1000,
      maxLife: durationMs / 1000,
    });
  }

  spawnFlash(position: Vec3): void {
    this.spawnExplosion(position, 0xf8fbff);
  }

  spawnMuzzle(position: Vec3, color = 0xffcf66): void {
    if (this.disposed) {
      return;
    }
    const light = new PointLight(color, 10, 5, 2);
    light.position.set(position.x, position.y, position.z);
    this.scene.add(light);
    const mesh = new Mesh(
      new SphereGeometry(0.07, 8, 6),
      new MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.9,
        blending: AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    mesh.position.set(position.x, position.y, position.z);
    this.scene.add(mesh);
    this.flashes.push({ light, mesh, life: 0.055, maxLife: 0.055, intensity: 10 });
  }

  update(dt: number): void {
    if (this.disposed) {
      return;
    }

    for (let index = this.bulletMarks.length - 1; index >= 0; index -= 1) {
      const mark = this.bulletMarks[index];
      if (mark === undefined) {
        continue;
      }
      mark.life -= dt;
      mark.mesh.material.opacity = Math.min(0.92, Math.max(0, mark.life));
      if (mark.life <= 0) {
        this.removeMark(mark);
        this.bulletMarks.splice(index, 1);
      }
    }

    for (let index = this.sparks.length - 1; index >= 0; index -= 1) {
      const spark = this.sparks[index];
      if (spark === undefined) {
        continue;
      }
      spark.life -= dt;
      spark.velocity.y -= 9.5 * dt;
      spark.mesh.position.addScaledVector(spark.velocity, dt);
      const ratio = Math.max(0, spark.life / spark.maxLife);
      spark.mesh.material.opacity = ratio;
      spark.mesh.scale.setScalar(0.5 + ratio * 0.8);
      if (spark.life <= 0) {
        this.scene.remove(spark.mesh);
        spark.mesh.geometry.dispose();
        spark.mesh.material.dispose();
        this.sparks.splice(index, 1);
      }
    }

    for (let index = this.flashes.length - 1; index >= 0; index -= 1) {
      const flash = this.flashes[index];
      if (flash === undefined) {
        continue;
      }
      flash.life -= dt;
      const ratio = Math.max(0, flash.life / flash.maxLife);
      flash.light.intensity = flash.intensity * ratio;
      flash.mesh.material.opacity = ratio;
      flash.mesh.scale.setScalar(0.5 + ratio * 1.2);
      if (flash.life <= 0) {
        this.scene.remove(flash.light);
        this.scene.remove(flash.mesh);
        flash.mesh.geometry.dispose();
        flash.mesh.material.dispose();
        this.flashes.splice(index, 1);
      }
    }

    for (let index = this.smokeClouds.length - 1; index >= 0; index -= 1) {
      const cloud = this.smokeClouds[index];
      if (cloud === undefined) {
        continue;
      }
      cloud.life -= dt;
      const ratio = Math.max(0, cloud.life / cloud.maxLife);
      const fadeIn = Math.min(1, (1 - ratio) * 6);
      const opacity = 0.42 * fadeIn * Math.min(1, ratio * 5);
      for (const mesh of cloud.meshes) {
        mesh.material.opacity = opacity;
        mesh.position.y += dt * 0.12;
        mesh.rotation.y += dt * 0.05;
      }
      if (cloud.life <= 0) {
        for (const mesh of cloud.meshes) {
          this.scene.remove(mesh);
          mesh.geometry.dispose();
          mesh.material.dispose();
        }
        this.smokeClouds.splice(index, 1);
      }
    }

    for (let index = this.fireZones.length - 1; index >= 0; index -= 1) {
      const fire = this.fireZones[index];
      if (fire === undefined) {
        continue;
      }
      fire.life -= dt;
      const ratio = Math.max(0, fire.life / fire.maxLife);
      fire.light.intensity = 30 * Math.min(1, ratio * 6);
      for (let meshIndex = 0; meshIndex < fire.meshes.length; meshIndex += 1) {
        const mesh = fire.meshes[meshIndex];
        if (mesh === undefined) {
          continue;
        }
        const pulse = 0.7 + Math.abs(Math.sin(performance.now() * 0.008 + meshIndex)) * 0.5;
        mesh.scale.setScalar(pulse);
        mesh.material.opacity = 0.38 * Math.min(1, ratio * 5);
      }
      if (fire.life <= 0) {
        this.removeFire(index);
      }
    }
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;

    for (const mark of this.bulletMarks) {
      this.removeMark(mark);
    }
    for (const spark of this.sparks) {
      this.scene.remove(spark.mesh);
      spark.mesh.geometry.dispose();
      spark.mesh.material.dispose();
    }
    for (const flash of this.flashes) {
      this.scene.remove(flash.light);
      this.scene.remove(flash.mesh);
      flash.mesh.geometry.dispose();
      flash.mesh.material.dispose();
    }
    for (const cloud of this.smokeClouds) {
      for (const mesh of cloud.meshes) {
        this.scene.remove(mesh);
        mesh.geometry.dispose();
        mesh.material.dispose();
      }
    }
    for (const fire of this.fireZones) {
      for (const mesh of fire.meshes) {
        this.scene.remove(mesh);
        mesh.geometry.dispose();
        mesh.material.dispose();
      }
      this.scene.remove(fire.light);
    }
    this.bulletMarks.length = 0;
    this.smokeClouds.length = 0;
    this.fireZones.length = 0;
    this.sparks.length = 0;
    this.flashes.length = 0;
  }

  private removeFire(index: number): void {
    const fire = this.fireZones[index];
    if (fire === undefined) {
      return;
    }
    for (const mesh of fire.meshes) {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
    this.scene.remove(fire.light);
    this.fireZones.splice(index, 1);
  }

  private areasOverlap(a: Vec3, aRadius: number, b: Vec3, bRadius: number): boolean {
    return Math.hypot(a.x - b.x, a.z - b.z) <= aRadius + bRadius;
  }

  private removeMark(mark: BulletMark): void {
    this.scene.remove(mark.mesh);
    mark.mesh.geometry.dispose();
    mark.mesh.material.dispose();
  }
}
