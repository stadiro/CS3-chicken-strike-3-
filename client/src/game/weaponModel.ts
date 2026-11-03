import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  type Material,
  Object3D,
  SphereGeometry,
} from 'three';
import { getWeapon, type WeaponId } from '../../../shared/weapons';
import { disposeObject3D } from './dispose';

export interface WeaponModel {
  group: Group;
  muzzle: Object3D;
  /** Moving magazine group for the reload animation. */
  magazine?: Group;
  /** Pistol slide / moving bolt carrier. */
  slide?: Group;
  /** Bolt handle for bolt-action rifles. */
  bolt?: Group;
  dispose(): void;
}

function addBox(
  parent: Object3D,
  size: [number, number, number],
  position: [number, number, number],
  material: Material,
  rotation: [number, number, number] = [0, 0, 0],
): Mesh {
  const mesh = new Mesh(new BoxGeometry(size[0], size[1], size[2]), material);
  mesh.position.set(position[0], position[1], position[2]);
  mesh.rotation.set(rotation[0], rotation[1], rotation[2]);
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  parent.add(mesh);
  return mesh;
}

function addCylinder(
  parent: Object3D,
  radius: number,
  length: number,
  position: [number, number, number],
  material: Material,
  radialSegments = 12,
): Mesh {
  const mesh = new Mesh(new CylinderGeometry(radius, radius, length, radialSegments), material);
  mesh.rotation.x = Math.PI / 2;
  mesh.position.set(position[0], position[1], position[2]);
  parent.add(mesh);
  return mesh;
}

function addSphere(
  parent: Object3D,
  radius: number,
  position: [number, number, number],
  material: Material,
): Mesh {
  const mesh = new Mesh(new SphereGeometry(radius, 12, 8), material);
  mesh.position.set(position[0], position[1], position[2]);
  parent.add(mesh);
  return mesh;
}

function addSights(parent: Object3D, z: number, material: Material, front = true): void {
  addBox(parent, [0.012, 0.035, 0.012], [0, 0.09, z], material);
  if (front) {
    addBox(parent, [0.035, 0.018, 0.012], [0, 0.078, z + 0.02], material);
  }
}

function addScope(parent: Object3D, material: Material, glass: Material, z = -0.2): void {
  addCylinder(parent, 0.055, 0.34, [0, 0.14, z], material, 16);
  addCylinder(parent, 0.065, 0.08, [0, 0.14, z - 0.15], material, 16);
  addCylinder(parent, 0.07, 0.06, [0, 0.14, z + 0.17], material, 16);
  addSphere(parent, 0.045, [0, 0.14, z - 0.19], glass);
  addSphere(parent, 0.04, [0, 0.14, z + 0.2], glass);
}

export function createWeaponModel(weaponId: WeaponId, scale = 1): WeaponModel {
  const definition = getWeapon(weaponId);
  const group = new Group();
  group.scale.setScalar(scale);

  const metal = new MeshStandardMaterial({
    color: 0x202b3a,
    metalness: 0.72,
    roughness: 0.34,
  });
  const dark = new MeshStandardMaterial({
    color: 0x0d131d,
    metalness: 0.4,
    roughness: 0.58,
  });
  const accent = new MeshStandardMaterial({
    color: definition.color,
    metalness: 0.55,
    roughness: 0.38,
  });
  const wood = new MeshStandardMaterial({
    color: 0x8a5a34,
    metalness: 0.05,
    roughness: 0.82,
  });
  const glass = new MeshBasicMaterial({ color: 0x67e8f9 });
  const muzzle = new Object3D();

  let magazine: Group | undefined;
  let slide: Group | undefined;
  let bolt: Group | undefined;

  if (weaponId === 'knife') {
    addBox(group, [0.065, 0.085, 0.24], [0, -0.01, 0.08], dark);
    addBox(group, [0.022, 0.1, 0.34], [0, 0.015, -0.21], metal);
    addBox(group, [0.03, 0.12, 0.06], [0, 0.015, -0.37], accent);
    addBox(group, [0.055, 0.025, 0.12], [0, -0.055, 0.0], metal);
    muzzle.position.set(0, 0.015, -0.4);
  } else if (weaponId === 'glock' || weaponId === 'usp') {
    const compact = weaponId === 'glock';
    addBox(group, [0.085, 0.09, compact ? 0.33 : 0.39], [0, -0.015, -0.08], accent);
    addBox(group, [0.072, 0.19, 0.095], [0, -0.13, 0.09], dark, [0.1, 0, 0]);
    addBox(group, [0.026, 0.035, 0.15], [0, -0.018, 0.01], dark);

    slide = new Group();
    slide.position.set(0, 0.045, -0.08);
    group.add(slide);
    addBox(slide, [0.09, 0.055, compact ? 0.36 : 0.42], [0, 0, 0], metal);
    addBox(
      slide,
      [0.062, 0.028, compact ? 0.18 : 0.22],
      [0, 0.005, compact ? -0.24 : -0.28],
      accent,
    );
    addBox(slide, [0.03, 0.018, 0.06], [0, 0.04, compact ? -0.1 : -0.14], dark);
    addSights(slide, compact ? -0.16 : -0.2, dark);

    magazine = new Group();
    magazine.position.set(0, -0.15, 0.09);
    group.add(magazine);
    addBox(magazine, [0.055, 0.11, 0.075], [0, 0, 0], dark);
    muzzle.position.set(0, 0.045, compact ? -0.43 : -0.5);
  } else if (
    weaponId === 'p250' ||
    weaponId === 'fiveseven' ||
    weaponId === 'tec9' ||
    weaponId === 'dualberettas'
  ) {
    const long = weaponId === 'fiveseven' || weaponId === 'tec9';
    addBox(group, [0.088, 0.1, long ? 0.4 : 0.34], [0, -0.015, -0.08], accent);
    addBox(group, [0.075, 0.19, 0.1], [0, -0.13, 0.09], dark, [0.1, 0, 0]);
    addBox(group, [0.03, 0.04, 0.16], [0, -0.018, 0.01], metal);
    slide = new Group();
    slide.position.set(0, 0.05, -0.08);
    group.add(slide);
    addBox(slide, [0.095, 0.055, long ? 0.44 : 0.36], [0, 0, 0], metal);
    addBox(slide, [0.065, 0.022, 0.16], [0, 0.035, long ? -0.18 : -0.14], dark);
    addSights(slide, long ? -0.18 : -0.14, dark);
    magazine = new Group();
    magazine.position.set(0, -0.16, 0.09);
    group.add(magazine);
    addBox(magazine, [0.06, 0.12, 0.08], [0, 0, 0], dark);
    muzzle.position.set(0, 0.05, long ? -0.52 : -0.44);
  } else if (weaponId === 'deagle') {
    addBox(group, [0.1, 0.12, 0.42], [0, -0.01, -0.1], accent);
    addBox(group, [0.085, 0.21, 0.11], [0, -0.14, 0.1], dark, [0.1, 0, 0]);
    addBox(group, [0.03, 0.04, 0.18], [0, -0.02, 0.02], dark);

    slide = new Group();
    slide.position.set(0, 0.055, -0.1);
    group.add(slide);
    addBox(slide, [0.11, 0.06, 0.44], [0, 0, 0], metal);
    addBox(slide, [0.075, 0.06, 0.22], [0, 0.01, -0.28], accent);
    addBox(slide, [0.04, 0.022, 0.09], [0, 0.045, -0.12], dark);
    addSights(slide, -0.18, dark);

    magazine = new Group();
    magazine.position.set(0, -0.16, 0.1);
    group.add(magazine);
    addBox(magazine, [0.06, 0.12, 0.08], [0, 0, 0], dark);
    muzzle.position.set(0, 0.055, -0.5);
  } else if (weaponId === 'ak47') {
    addBox(group, [0.09, 0.11, 0.5], [0, 0, -0.12], accent);
    addBox(group, [0.08, 0.085, 0.28], [0, 0.005, -0.45], wood);
    addCylinder(group, 0.024, 0.5, [0, 0.015, -0.72], metal);
    addBox(group, [0.07, 0.11, 0.3], [0, -0.015, 0.3], wood);
    addBox(group, [0.06, 0.18, 0.09], [0, -0.13, 0.16], dark);
    addBox(group, [0.04, 0.045, 0.26], [0, 0.075, -0.16], metal);
    addBox(group, [0.04, 0.045, 0.3], [0, 0.02, -0.42], metal);
    addSights(group, -0.45, metal);
    addBox(group, [0.012, 0.055, 0.012], [0, 0.13, -0.45], dark);

    magazine = new Group();
    magazine.position.set(0, -0.18, -0.02);
    group.add(magazine);
    addBox(magazine, [0.065, 0.22, 0.13], [0, 0, 0], dark, [0.18, 0, 0]);
    addBox(magazine, [0.05, 0.06, 0.13], [0, -0.12, -0.02], dark, [0.18, 0, 0]);
    muzzle.position.set(0, 0.015, -0.98);
  } else if (weaponId === 'm4a1') {
    addBox(group, [0.085, 0.105, 0.48], [0, 0, -0.1], accent);
    addBox(group, [0.075, 0.08, 0.32], [0, 0.005, -0.46], dark);
    addCylinder(group, 0.022, 0.46, [0, 0.015, -0.7], metal);
    addBox(group, [0.07, 0.1, 0.28], [0, -0.01, 0.28], dark);
    addBox(group, [0.055, 0.16, 0.085], [0, -0.12, 0.14], dark);
    addBox(group, [0.045, 0.05, 0.28], [0, 0.09, -0.1], metal);
    addBox(group, [0.035, 0.04, 0.2], [0, 0.035, -0.48], dark);
    addSights(group, -0.48, dark);

    magazine = new Group();
    magazine.position.set(0, -0.16, -0.02);
    group.add(magazine);
    addBox(magazine, [0.06, 0.2, 0.12], [0, 0, 0], dark, [0.12, 0, 0]);
    muzzle.position.set(0, 0.015, -0.94);
  } else if (weaponId === 'mp9' || weaponId === 'mac10') {
    addBox(group, [0.08, 0.09, 0.34], [0, 0, -0.06], accent);
    addBox(group, [0.07, 0.07, 0.2], [0, 0.005, -0.31], dark);
    addCylinder(group, 0.016, 0.22, [0, 0.015, -0.49], metal);
    addBox(group, [0.06, 0.09, 0.18], [0, -0.01, 0.2], dark);
    addBox(group, [0.035, 0.045, 0.22], [0, 0.07, -0.06], metal);
    addBox(group, [0.03, 0.04, 0.13], [0, 0.02, -0.4], dark);
    magazine = new Group();
    magazine.position.set(0, -0.16, -0.02);
    group.add(magazine);
    addBox(magazine, [0.052, 0.22, 0.09], [0, 0, 0], dark, [0.12, 0, 0]);
    muzzle.position.set(0, 0.015, -0.62);
  } else if (weaponId === 'mp5') {
    addBox(group, [0.08, 0.1, 0.4], [0, 0, -0.08], accent);
    addBox(group, [0.07, 0.07, 0.24], [0, 0.005, -0.38], dark);
    addCylinder(group, 0.018, 0.3, [0, 0.015, -0.6], metal);
    addBox(group, [0.06, 0.1, 0.2], [0, -0.01, 0.22], dark);
    addBox(group, [0.04, 0.04, 0.2], [0, 0.07, -0.1], metal);
    addBox(group, [0.04, 0.04, 0.16], [0, 0.02, -0.46], dark);
    addSights(group, -0.35, dark);

    magazine = new Group();
    magazine.position.set(0, -0.16, -0.02);
    group.add(magazine);
    addBox(magazine, [0.055, 0.2, 0.1], [0, 0, 0], dark, [0.16, 0, 0]);
    muzzle.position.set(0, 0.015, -0.76);
  } else if (weaponId === 'p90') {
    addBox(group, [0.085, 0.11, 0.44], [0, 0, -0.08], accent);
    addBox(group, [0.06, 0.055, 0.2], [0, 0.065, -0.24], dark);
    addCylinder(group, 0.015, 0.24, [0, 0.015, -0.4], metal);
    addBox(group, [0.05, 0.17, 0.12], [0, -0.1, 0.03], dark, [0.2, 0, 0]);
    addSights(group, -0.24, dark);
    muzzle.position.set(0, 0.015, -0.56);
  } else if (
    weaponId === 'galil' ||
    weaponId === 'famas' ||
    weaponId === 'sg553' ||
    weaponId === 'aug'
  ) {
    const scoped = weaponId === 'sg553' || weaponId === 'aug';
    addBox(group, [0.088, 0.11, 0.52], [0, 0, -0.1], accent);
    addCylinder(group, 0.022, 0.5, [0, 0.015, -0.62], metal);
    addBox(group, [0.07, 0.1, 0.3], [0, -0.01, 0.28], dark);
    addBox(group, [0.055, 0.17, 0.085], [0, -0.13, 0.14], dark);
    addBox(group, [0.045, 0.05, 0.26], [0, 0.085, -0.14], metal);
    if (scoped) {
      addScope(group, dark, glass, -0.14);
    } else {
      addSights(group, -0.4, dark);
    }
    magazine = new Group();
    magazine.position.set(0, -0.17, -0.02);
    group.add(magazine);
    addBox(magazine, [0.06, 0.2, 0.11], [0, 0, 0], dark, [0.14, 0, 0]);
    muzzle.position.set(0, 0.015, -0.88);
  } else if (weaponId === 'm249') {
    addBox(group, [0.12, 0.14, 0.62], [0, 0, -0.1], accent);
    addCylinder(group, 0.028, 0.75, [0, 0.015, -0.75], metal);
    addBox(group, [0.11, 0.16, 0.3], [0, -0.02, 0.3], dark);
    addBox(group, [0.1, 0.1, 0.2], [0, 0.1, -0.1], metal);
    addBox(group, [0.06, 0.2, 0.12], [0, -0.16, 0.14], dark);
    addBox(group, [0.04, 0.04, 0.34], [0, 0.08, -0.52], dark);
    addBox(group, [0.05, 0.16, 0.05], [0, -0.1, -0.55], metal, [0.45, 0, 0]);
    addBox(group, [0.05, 0.16, 0.05], [0, -0.1, -0.72], metal, [-0.45, 0, 0]);
    addSights(group, -0.45, dark);

    magazine = new Group();
    magazine.position.set(0.09, -0.19, 0.02);
    group.add(magazine);
    addBox(magazine, [0.1, 0.18, 0.2], [0, 0, 0], dark);
    addBox(magazine, [0.06, 0.04, 0.14], [0, 0.1, -0.02], metal);
    muzzle.position.set(0, 0.015, -1.15);
  } else if (weaponId === 'hegrenade') {
    addSphere(group, 0.16, [0, 0.02, -0.08], accent);
    addCylinder(group, 0.045, 0.08, [0, 0.17, -0.08], metal);
    addBox(group, [0.08, 0.03, 0.1], [0, 0.12, 0.04], dark);
    addBox(group, [0.14, 0.025, 0.16], [0, -0.14, -0.08], dark);
    addBox(group, [0.018, 0.06, 0.03], [0, 0.22, 0.02], metal);
    muzzle.position.set(0, 0.08, -0.28);
  } else if (weaponId === 'flashbang' || weaponId === 'smokegrenade') {
    addCylinder(group, 0.1, 0.28, [0, 0.02, -0.08], accent, 12);
    addCylinder(group, 0.045, 0.08, [0, 0.2, -0.08], metal);
    addBox(group, [0.16, 0.025, 0.1], [0, 0.16, 0.02], dark);
    addBox(group, [0.018, 0.07, 0.03], [0, 0.24, 0.02], metal);
    muzzle.position.set(0, 0.08, -0.28);
  } else if (weaponId === 'molotov' || weaponId === 'incendiary') {
    addCylinder(group, 0.09, 0.24, [0, 0.0, -0.08], accent, 12);
    addCylinder(group, 0.045, 0.12, [0, 0.18, -0.08], accent, 12);
    addSphere(group, 0.06, [0, 0.26, -0.08], accent);
    addBox(group, [0.02, 0.13, 0.02], [0, 0.32, -0.08], dark, [0.18, 0, 0]);
    muzzle.position.set(0, 0.08, -0.3);
  } else if (weaponId === 'ssg08' || weaponId === 'awp') {
    const heavy = weaponId === 'awp';
    addBox(group, [0.085, 0.12, heavy ? 0.66 : 0.58], [0, 0, -0.1], accent);
    addCylinder(group, 0.026, heavy ? 0.9 : 0.76, [0, 0.015, heavy ? -0.82 : -0.72], metal);
    addBox(group, [0.08, 0.11, 0.34], [0, -0.02, 0.32], dark);
    addBox(group, [0.06, 0.2, 0.09], [0, -0.14, 0.1], dark);
    addScope(group, dark, glass, -0.18);
    bolt = new Group();
    bolt.position.set(0.09, 0.02, -0.08);
    group.add(bolt);
    addCylinder(bolt, 0.018, 0.12, [0, 0, 0], metal);
    addSphere(bolt, 0.028, [0, 0, 0.07], dark);
    magazine = new Group();
    magazine.position.set(0, -0.16, -0.02);
    group.add(magazine);
    addBox(magazine, [0.07, 0.18, 0.1], [0, 0, 0], dark);
    muzzle.position.set(0, 0.015, heavy ? -1.28 : -1.12);
  } else {
    addBox(group, [0.1, 0.13, 0.62], [0, 0, -0.1], accent);
    addCylinder(group, 0.03, 0.82, [0, 0.015, -0.78], metal);
    addBox(group, [0.085, 0.11, 0.34], [0, -0.02, 0.32], dark);
    addBox(group, [0.07, 0.24, 0.11], [0, -0.18, 0.02], dark);
    addBox(group, [0.06, 0.17, 0.08], [0, -0.13, 0.18], dark);
    addScope(group, dark, glass, -0.18);
    addSights(group, -0.5, metal);

    bolt = new Group();
    bolt.position.set(0.09, 0.02, -0.08);
    group.add(bolt);
    addCylinder(bolt, 0.018, 0.12, [0, 0, 0], metal);
    addSphere(bolt, 0.028, [0, 0, 0.07], dark);

    magazine = new Group();
    magazine.position.set(0, -0.16, -0.02);
    group.add(magazine);
    addBox(magazine, [0.07, 0.18, 0.1], [0, 0, 0], dark);
    muzzle.position.set(0, 0.015, -1.2);
  }

  group.add(muzzle);
  return {
    group,
    muzzle,
    magazine,
    slide,
    bolt,
    dispose: () => disposeObject3D(group),
  };
}
