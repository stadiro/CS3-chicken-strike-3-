import {
  BoxGeometry,
  type BufferGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  type MeshBasicMaterialParameters,
  MeshStandardMaterial,
  type MeshStandardMaterialParameters,
  type Material,
  Object3D,
  SphereGeometry,
  TorusGeometry,
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

type Vec3 = [number, number, number];
type Axis = 'x' | 'y' | 'z';

// ---------------------------------------------------------------------------
// Shared resource caches. Everything here is flagged `userData.shared` so that
// `disposeObject3D` leaves it alone; the set is small and bounded.
// ---------------------------------------------------------------------------

const geometryCache = new Map<string, BufferGeometry>();
const materialCache = new Map<string, Material>();

function sharedGeometry(key: string, create: () => BufferGeometry): BufferGeometry {
  let geometry = geometryCache.get(key);
  if (geometry === undefined) {
    geometry = create();
    geometry.userData.shared = true;
    geometryCache.set(key, geometry);
  }
  return geometry;
}

function standard(key: string, params: MeshStandardMaterialParameters): MeshStandardMaterial {
  let material = materialCache.get(key);
  if (material === undefined) {
    material = new MeshStandardMaterial(params);
    material.userData.shared = true;
    materialCache.set(key, material);
  }
  return material as MeshStandardMaterial;
}

function basic(key: string, params: MeshBasicMaterialParameters): MeshBasicMaterial {
  let material = materialCache.get(key);
  if (material === undefined) {
    material = new MeshBasicMaterial(params);
    material.userData.shared = true;
    materialCache.set(key, material);
  }
  return material as MeshBasicMaterial;
}

interface Palette {
  steel: Material;
  blued: Material;
  anodized: Material;
  polymer: Material;
  rubber: Material;
  wood: Material;
  woodDark: Material;
  chrome: Material;
  suppressor: Material;
  olive: Material;
  smokeGreen: Material;
  flashSilver: Material;
  incendiary: Material;
  awpGreen: Material;
  blueBand: Material;
  redBand: Material;
  whiteBand: Material;
  dot: Material;
  hole: Material;
  lens: Material;
  bottle: Material;
  liquid: Material;
  rag: Material;
  ember: Material;
}

let paletteCache: Palette | null = null;

function palette(): Palette {
  paletteCache ??= {
    steel: standard('steel', { color: 0x3a4049, metalness: 0.75, roughness: 0.35 }),
    blued: standard('blued', { color: 0x1c2026, metalness: 0.65, roughness: 0.42 }),
    anodized: standard('anodized', { color: 0x2a2d32, metalness: 0.45, roughness: 0.5 }),
    polymer: standard('polymer', { color: 0x17191c, metalness: 0.08, roughness: 0.78 }),
    rubber: standard('rubber', { color: 0x0d0e10, metalness: 0, roughness: 0.95 }),
    wood: standard('wood', { color: 0x8a4320, metalness: 0.05, roughness: 0.55 }),
    woodDark: standard('woodDark', { color: 0x5a2a14, metalness: 0.05, roughness: 0.6 }),
    chrome: standard('chrome', { color: 0xc8ced6, metalness: 0.9, roughness: 0.22 }),
    suppressor: standard('suppressor', { color: 0x26282b, metalness: 0.25, roughness: 0.88 }),
    olive: standard('olive', {
      color: 0x4f5f33,
      metalness: 0.2,
      roughness: 0.65,
      flatShading: true,
    }),
    smokeGreen: standard('smokeGreen', { color: 0x34452e, metalness: 0.2, roughness: 0.6 }),
    flashSilver: standard('flashSilver', { color: 0x9aa1aa, metalness: 0.7, roughness: 0.35 }),
    incendiary: standard('incendiary', { color: 0x6f6a58, metalness: 0.35, roughness: 0.55 }),
    awpGreen: standard('awpGreen', { color: 0x45603d, metalness: 0.05, roughness: 0.7 }),
    blueBand: standard('blueBand', { color: 0x1d4ed8, metalness: 0.3, roughness: 0.5 }),
    redBand: standard('redBand', { color: 0xa3221a, metalness: 0.3, roughness: 0.5 }),
    whiteBand: standard('whiteBand', { color: 0xe8e8e2, metalness: 0.1, roughness: 0.6 }),
    dot: basic('dot', { color: 0xf5f5f5 }),
    hole: basic('hole', { color: 0x050505 }),
    lens: basic('lens', { color: 0x4fc3d9 }),
    bottle: standard('bottle', {
      color: 0x6e9c78,
      metalness: 0.1,
      roughness: 0.08,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
    }),
    liquid: standard('liquid', {
      color: 0xd2691e,
      emissive: 0x401800,
      metalness: 0,
      roughness: 0.3,
    }),
    rag: standard('rag', {
      color: 0xc9b48a,
      emissive: 0x6a1f00,
      emissiveIntensity: 0.7,
      metalness: 0,
      roughness: 0.95,
    }),
    ember: basic('ember', { color: 0xffa040 }),
  };
  return paletteCache;
}

function accentMaterial(color: number): Material {
  return standard(`accent:${color}`, { color, metalness: 0.55, roughness: 0.38 });
}

// ---------------------------------------------------------------------------
// Primitive helpers
// ---------------------------------------------------------------------------

function place(
  parent: Object3D,
  geometry: BufferGeometry,
  material: Material,
  position: Vec3,
  rotation: Vec3 = [0, 0, 0],
): Mesh {
  const mesh = new Mesh(geometry, material);
  mesh.position.set(position[0], position[1], position[2]);
  mesh.rotation.set(rotation[0], rotation[1], rotation[2]);
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  parent.add(mesh);
  return mesh;
}

function addGroup(parent: Object3D, position: Vec3, rotation: Vec3 = [0, 0, 0]): Group {
  const group = new Group();
  group.position.set(position[0], position[1], position[2]);
  group.rotation.set(rotation[0], rotation[1], rotation[2]);
  parent.add(group);
  return group;
}

function addBox(
  parent: Object3D,
  size: Vec3,
  position: Vec3,
  material: Material,
  rotation: Vec3 = [0, 0, 0],
): Mesh {
  const [w, h, d] = size;
  const geometry = sharedGeometry(`box:${w}:${h}:${d}`, () => new BoxGeometry(w, h, d));
  return place(parent, geometry, material, position, rotation);
}

/**
 * Cylinder along `axis`. `radius` is at the positive end of the axis (+Z = back,
 * +Y = top, +X = right); `radiusNeg` (defaults to `radius`) at the negative end.
 */
function addCylinder(
  parent: Object3D,
  radius: number,
  length: number,
  position: Vec3,
  material: Material,
  radialSegments = 12,
  axis: Axis = 'z',
  radiusNeg = radius,
): Mesh {
  const geometry = sharedGeometry(
    `cyl:${radius}:${radiusNeg}:${length}:${radialSegments}`,
    () => new CylinderGeometry(radius, radiusNeg, length, radialSegments),
  );
  const rotation: Vec3 =
    axis === 'z' ? [Math.PI / 2, 0, 0] : axis === 'x' ? [0, 0, -Math.PI / 2] : [0, 0, 0];
  return place(parent, geometry, material, position, rotation);
}

function addSphere(
  parent: Object3D,
  radius: number,
  position: Vec3,
  material: Material,
  widthSegments = 12,
  heightSegments = 8,
): Mesh {
  const geometry = sharedGeometry(
    `sph:${radius}:${widthSegments}:${heightSegments}`,
    () => new SphereGeometry(radius, widthSegments, heightSegments),
  );
  return place(parent, geometry, material, position);
}

/** Torus; by default lies in the XY plane (hole along Z). */
function addTorus(
  parent: Object3D,
  radius: number,
  tube: number,
  position: Vec3,
  material: Material,
  rotation: Vec3 = [0, 0, 0],
  tubularSegments = 10,
): Mesh {
  const geometry = sharedGeometry(
    `tor:${radius}:${tube}:${tubularSegments}`,
    () => new TorusGeometry(radius, tube, 4, tubularSegments),
  );
  return place(parent, geometry, material, position, rotation);
}

/** Cone/pyramid pointing towards -Z. */
function addCone(
  parent: Object3D,
  radius: number,
  length: number,
  position: Vec3,
  material: Material,
  radialSegments: number,
  scaleX = 1,
): Mesh {
  const geometry = sharedGeometry(
    `cone:${radius}:${length}:${radialSegments}`,
    () => new CylinderGeometry(0, radius, length, radialSegments),
  );
  const mesh = place(parent, geometry, material, position, [-Math.PI / 2, 0, 0]);
  mesh.scale.x = scaleX;
  return mesh;
}

/** Ring of small radial holes around a vertical body centred at (0, y, z). */
function addRadialHoles(
  parent: Object3D,
  count: number,
  bodyRadius: number,
  y: number,
  z: number,
  holeRadius: number,
  material: Material,
  phase = 0,
): void {
  const geometry = sharedGeometry(
    `hole:${holeRadius}`,
    () => new CylinderGeometry(holeRadius, holeRadius, 0.012, 6),
  );
  for (let i = 0; i < count; i += 1) {
    const angle = phase + (i / count) * Math.PI * 2;
    const mesh = place(parent, geometry, material, [
      Math.sin(angle) * (bodyRadius - 0.004),
      y,
      z + Math.cos(angle) * (bodyRadius - 0.004),
    ]);
    // Rotate X first (Y -> +Z), then Y (+Z -> radial direction).
    mesh.rotation.set(Math.PI / 2, angle, 0, 'YXZ');
  }
}

function addSights(parent: Object3D, z: number, material: Material, front = true): void {
  addBox(parent, [0.012, 0.035, 0.012], [0, 0.09, z], material);
  if (front) {
    addBox(parent, [0.035, 0.018, 0.012], [0, 0.078, z + 0.02], material);
  }
}

function addScope(parent: Object3D, material: Material, glass: Material, z = -0.2): void {
  addCylinder(parent, 0.055, 0.34, [0, 0.14, z], material, 14);
  addCylinder(parent, 0.065, 0.08, [0, 0.14, z - 0.15], material, 14);
  addCylinder(parent, 0.07, 0.06, [0, 0.14, z + 0.17], material, 14);
  addSphere(parent, 0.045, [0, 0.14, z - 0.19], glass);
  addSphere(parent, 0.04, [0, 0.14, z + 0.2], glass);
}

/** 3-dot iron sights on a pistol slide (top surface at `topY`). */
function addPistolSights(
  slide: Group,
  p: Palette,
  topY: number,
  frontZ: number,
  rearZ: number,
): void {
  const y = topY + 0.007;
  addBox(slide, [0.012, 0.014, 0.012], [0, y, frontZ], p.rubber);
  addBox(slide, [0.005, 0.005, 0.002], [0, y + 0.002, frontZ + 0.0072], p.dot);
  for (const side of [-1, 1]) {
    addBox(slide, [0.018, 0.016, 0.012], [side * 0.017, y + 0.001, rearZ], p.rubber);
    addBox(slide, [0.005, 0.005, 0.002], [side * 0.017, y + 0.002, rearZ + 0.0072], p.dot);
  }
}

/** Fuze head, spoon, safety pin and pull ring on top of a grenade body. */
function addGrenadeFuze(
  group: Group,
  p: Palette,
  topY: number,
  z: number,
  bodyRadius: number,
  leverTilt = 0,
): void {
  addCylinder(group, 0.028, 0.045, [0, topY + 0.02, z], p.steel, 10, 'y');
  addCylinder(group, 0.034, 0.018, [0, topY + 0.05, z], p.steel, 10, 'y');
  const reach = bodyRadius + 0.012;
  addBox(group, [0.026, 0.01, reach], [0, topY + 0.062, z + reach / 2], p.steel);
  addBox(group, [0.026, 0.13, 0.01], [0, topY - 0.004, z + reach], p.steel, [leverTilt, 0, 0]);
  addCylinder(group, 0.004, 0.05, [0.03, topY + 0.03, z], p.chrome, 6, 'x');
  addTorus(group, 0.022, 0.0045, [0.066, topY + 0.03, z], p.chrome, [0, Math.PI / 2, 0]);
}

interface CanGrenadeOptions {
  body: Material;
  band: Material;
  radius: number;
  height: number;
  bandY: number;
  holeCount: number;
  holeY: number;
  holeRadius: number;
}

function buildCanGrenade(group: Group, p: Palette, o: CanGrenadeOptions): void {
  const z = -0.08;
  addCylinder(group, o.radius, o.height, [0, 0, z], o.body, 12, 'y');
  addCylinder(group, o.radius + 0.002, 0.026, [0, o.bandY, z], o.band, 12, 'y');
  addCylinder(group, o.radius * 0.8, 0.016, [0, o.height / 2 + 0.006, z], p.steel, 10, 'y');
  addRadialHoles(group, o.holeCount, o.radius, o.holeY, z, o.holeRadius, p.hole);
  addGrenadeFuze(group, p, o.height / 2 + 0.012, z, o.radius);
}

// ---------------------------------------------------------------------------
// CS2-styled builders for iconic weapons
// ---------------------------------------------------------------------------

interface Parts {
  muzzle: Object3D;
  magazine?: Group;
  slide?: Group;
  bolt?: Group;
}

function buildKnife(g: Group, p: Palette, parts: Parts): void {
  // Handle with grip ridges, pommel and lanyard ring (+Z).
  addBox(g, [0.05, 0.072, 0.2], [0, -0.012, 0.1], p.polymer);
  for (const z of [0.05, 0.1, 0.15]) {
    addBox(g, [0.054, 0.076, 0.014], [0, -0.012, z], p.rubber);
  }
  addCylinder(g, 0.032, 0.03, [0, -0.012, 0.214], p.steel, 10);
  addTorus(g, 0.02, 0.005, [0, -0.012, 0.246], p.steel, [0, Math.PI / 2, 0], 8);
  // Cross guard with bayonet muzzle ring.
  addBox(g, [0.066, 0.13, 0.018], [0, 0.0, -0.004], p.steel);
  addTorus(g, 0.022, 0.006, [0, 0.074, -0.004], p.steel, [0, 0, 0], 10);
  // Blade: blued spine, bright edge, fuller and clip-point tip (-Z).
  addBox(g, [0.014, 0.024, 0.27], [0, 0.024, -0.145], p.blued);
  addBox(g, [0.008, 0.05, 0.27], [0, -0.012, -0.145], p.chrome);
  addBox(g, [0.016, 0.008, 0.16], [0, 0.005, -0.12], p.blued);
  addCone(g, 0.038, 0.09, [0, 0.004, -0.325], p.chrome, 4, 0.22);
  parts.muzzle.position.set(0, 0.0, -0.37);
}

function buildPistolGrip(
  g: Group,
  p: Palette,
  tilt: number,
  gripMaterial: Material,
  fingerGrooves: boolean,
): void {
  const grip = addGroup(g, [0, -0.035, 0.04], [-tilt, 0, 0]);
  addBox(grip, [0.068, 0.2, 0.1], [0, -0.1, 0], gripMaterial);
  addBox(grip, [0.072, 0.1, 0.07], [0, -0.11, 0.006], p.rubber);
  addBox(grip, [0.058, 0.02, 0.04], [0, 0.0, 0.062], gripMaterial);
  if (fingerGrooves) {
    addBox(grip, [0.064, 0.016, 0.014], [0, -0.075, -0.054], gripMaterial);
    addBox(grip, [0.064, 0.016, 0.014], [0, -0.125, -0.054], gripMaterial);
  } else {
    addBox(grip, [0.074, 0.008, 0.08], [0, -0.085, 0.006], p.polymer);
    addBox(grip, [0.074, 0.008, 0.08], [0, -0.135, 0.006], p.polymer);
  }
}

/** Straight pistol magazine following the grip angle (group itself is unrotated). */
function buildPistolMagazine(g: Group, p: Palette, tilt: number): Group {
  const magazine = addGroup(g, [0, -0.15, 0.09]);
  const c = Math.cos(tilt);
  const s = Math.sin(tilt);
  // Points along grip axis relative to grip pivot (0,-0.035,0.04).
  const at = (d: number): Vec3 => [0, -0.035 - d * c + 0.15, 0.04 + d * s - 0.09];
  addBox(magazine, [0.054, 0.16, 0.07], at(0.11), p.blued, [-tilt, 0, 0]);
  addBox(magazine, [0.072, 0.022, 0.104], at(0.206), p.polymer, [-tilt, 0, 0]);
  return magazine;
}

function buildTriggerGroup(g: Group, p: Palette, frame: Material, large: boolean): void {
  const front = large ? -0.125 : -0.11;
  const length = -front - 0.01;
  addBox(g, [0.02, 0.01, length], [0, -0.09, front / 2 - 0.005], frame);
  addBox(g, [0.02, 0.06, 0.012], [0, -0.062, front], frame);
  addBox(g, [0.008, 0.038, 0.012], [0, -0.055, -0.045], p.steel, [-0.25, 0, 0]);
}

function buildGlock(g: Group, p: Palette, parts: Parts): void {
  const tilt = 0.38; // ~22 degrees
  // Polymer frame + accessory rail.
  addBox(g, [0.078, 0.048, 0.32], [0, -0.01, -0.12], p.polymer);
  addBox(g, [0.05, 0.012, 0.09], [0, -0.04, -0.22], p.polymer);
  buildPistolGrip(g, p, tilt, p.polymer, true);
  buildTriggerGroup(g, p, p.polymer, false);

  // Boxy slide: bevelled top, rear serrations, ejection port, 3-dot sights.
  const slide = addGroup(g, [0, 0.045, -0.08]);
  addBox(slide, [0.085, 0.05, 0.4], [0, -0.005, -0.06], p.blued);
  addBox(slide, [0.066, 0.016, 0.39], [0, 0.026, -0.065], p.blued);
  addBox(slide, [0.07, 0.03, 0.02], [0, 0.004, -0.262], p.blued, [0.5, 0, 0]);
  for (const z of [0.06, 0.08, 0.1, 0.12]) {
    addBox(slide, [0.087, 0.04, 0.006], [0, -0.008, z], p.rubber);
  }
  addBox(slide, [0.004, 0.024, 0.07], [0.0435, 0.008, -0.03], p.rubber);
  addCylinder(slide, 0.012, 0.004, [0, -0.002, -0.261], p.hole, 8);
  addPistolSights(slide, p, 0.034, -0.23, 0.12);
  parts.slide = slide;

  parts.magazine = buildPistolMagazine(g, p, tilt);
  parts.muzzle.position.set(0, 0.043, -0.35);
}

function buildUsp(g: Group, p: Palette, parts: Parts): void {
  const tilt = 0.3;
  addBox(g, [0.076, 0.05, 0.32], [0, -0.01, -0.12], p.polymer);
  addBox(g, [0.05, 0.014, 0.1], [0, -0.04, -0.2], p.polymer);
  buildPistolGrip(g, p, tilt, p.polymer, false);
  buildTriggerGroup(g, p, p.polymer, true);
  // External hammer behind the slide.
  addBox(g, [0.02, 0.035, 0.016], [0, 0.058, 0.07], p.steel, [0.5, 0, 0]);

  const slide = addGroup(g, [0, 0.045, -0.08]);
  addBox(slide, [0.082, 0.05, 0.38], [0, -0.005, -0.05], p.anodized);
  addBox(slide, [0.058, 0.016, 0.37], [0, 0.026, -0.05], p.anodized);
  for (const z of [0.07, 0.095, 0.12]) {
    addBox(slide, [0.084, 0.04, 0.01], [0, -0.008, z], p.rubber);
  }
  addBox(slide, [0.004, 0.024, 0.07], [0.0425, 0.008, -0.02], p.rubber);
  addPistolSights(slide, p, 0.034, -0.21, 0.11);
  parts.slide = slide;

  // QD suppressor: threaded barrel, knurled base bands, matte body, end cap.
  addCylinder(g, 0.013, 0.03, [0, 0.043, -0.335], p.steel, 10);
  addCylinder(g, 0.03, 0.26, [0, 0.043, -0.48], p.suppressor, 12);
  for (const z of [-0.365, -0.385, -0.405]) {
    addCylinder(g, 0.0325, 0.012, [0, 0.043, z], p.rubber, 12);
  }
  addCylinder(g, 0.03, 0.014, [0, 0.043, -0.617], p.suppressor, 12, 'z', 0.024);

  parts.magazine = buildPistolMagazine(g, p, tilt);
  parts.muzzle.position.set(0, 0.043, -0.626);
}

function buildAk47(g: Group, p: Palette, parts: Parts): void {
  // Stamped receiver, ribbed dust cover, rear sight block, selector.
  addBox(g, [0.08, 0.1, 0.46], [0, -0.005, -0.12], p.blued);
  addBox(g, [0.07, 0.03, 0.4], [0, 0.058, -0.11], p.steel);
  for (const z of [0.0, 0.05]) {
    addBox(g, [0.074, 0.008, 0.012], [0, 0.072, z], p.steel);
  }
  addBox(g, [0.05, 0.034, 0.07], [0, 0.06, -0.33], p.blued);
  addBox(g, [0.006, 0.02, 0.16], [0.043, 0.005, -0.02], p.steel, [0.08, 0, 0]);
  // Charging handle rides with the bolt carrier.
  const slide = addGroup(g, [0.05, 0.028, -0.13]);
  addBox(slide, [0.03, 0.016, 0.022], [0, 0, 0], p.steel);
  parts.slide = slide;

  // Wooden lower handguard + gas tube cover, steel ferrule.
  addBox(g, [0.078, 0.075, 0.26], [0, -0.01, -0.49], p.wood);
  addBox(g, [0.06, 0.04, 0.22], [0, 0.065, -0.48], p.wood);
  addBox(g, [0.07, 0.06, 0.02], [0, 0.0, -0.63], p.steel);

  // Barrel, gas block/tube, hooded front sight, slant brake, cleaning rod.
  addCylinder(g, 0.018, 0.33, [0, 0.015, -0.785], p.blued, 10);
  addBox(g, [0.036, 0.06, 0.04], [0, 0.045, -0.68], p.steel);
  addCylinder(g, 0.015, 0.09, [0, 0.075, -0.635], p.steel, 8);
  addBox(g, [0.03, 0.045, 0.03], [0, 0.04, -0.87], p.blued);
  addTorus(g, 0.02, 0.004, [0, 0.08, -0.87], p.blued, [0, 0, 0], 10);
  addBox(g, [0.006, 0.03, 0.006], [0, 0.072, -0.87], p.blued);
  addCylinder(g, 0.022, 0.05, [0, 0.015, -0.95], p.blued, 10);
  addBox(g, [0.04, 0.012, 0.03], [0, -0.004, -0.985], p.blued);
  addCylinder(g, 0.005, 0.3, [0, -0.012, -0.78], p.steel, 6);

  // Pistol grip, trigger guard, trigger.
  const grip = addGroup(g, [0, -0.055, 0.06], [-0.35, 0, 0]);
  addBox(grip, [0.05, 0.15, 0.07], [0, -0.07, 0], p.woodDark);
  addBox(g, [0.018, 0.01, 0.12], [0, -0.1, -0.03], p.steel);
  addBox(g, [0.008, 0.04, 0.012], [0, -0.075, -0.02], p.steel, [-0.25, 0, 0]);

  // Classic stock with drop, flared heel and steel buttplate.
  addBox(g, [0.06, 0.1, 0.3], [0, -0.04, 0.27], p.wood, [0.12, 0, 0]);
  addBox(g, [0.056, 0.06, 0.16], [0, -0.09, 0.34], p.wood, [0.25, 0, 0]);
  addBox(g, [0.064, 0.14, 0.02], [0, -0.075, 0.425], p.blued, [0.12, 0, 0]);

  // Curved "banana" magazine with vertical ribs.
  const magazine = addGroup(g, [0, -0.06, -0.06]);
  addBox(magazine, [0.05, 0.1, 0.11], [0, -0.04, 0], p.blued, [0.1, 0, 0]);
  addBox(magazine, [0.05, 0.1, 0.11], [0, -0.1376, -0.0198], p.blued, [0.3, 0, 0]);
  addBox(magazine, [0.05, 0.1, 0.11], [0, -0.2293, -0.0586], p.blued, [0.5, 0, 0]);
  addBox(magazine, [0.056, 0.06, 0.012], [0, -0.1376, -0.0198], p.steel, [0.3, 0, 0]);
  addBox(magazine, [0.056, 0.06, 0.012], [0, -0.2293, -0.0586], p.steel, [0.5, 0, 0]);
  parts.magazine = magazine;
  parts.muzzle.position.set(0, 0.015, -1.0);
}

function buildM4a1(g: Group, p: Palette, parts: Parts): void {
  // Lower + magwell, upper receiver with forward assist and port cover.
  addBox(g, [0.07, 0.07, 0.3], [0, -0.04, -0.06], p.anodized);
  addBox(g, [0.064, 0.06, 0.09], [0, -0.09, -0.13], p.anodized);
  addBox(g, [0.075, 0.055, 0.32], [0, 0.02, -0.08], p.anodized);
  addCylinder(g, 0.011, 0.05, [0.042, 0.025, 0.04], p.anodized, 8);
  addBox(g, [0.004, 0.03, 0.08], [0.039, 0.015, -0.06], p.steel);
  // Carry handle with diopter rear sight.
  addBox(g, [0.03, 0.025, 0.2], [0, 0.085, -0.1], p.anodized);
  addBox(g, [0.03, 0.035, 0.025], [0, 0.06, -0.19], p.anodized);
  addBox(g, [0.03, 0.035, 0.025], [0, 0.06, 0.0], p.anodized);
  addTorus(g, 0.01, 0.004, [0, 0.112, 0.0], p.blued, [0, 0, 0], 8);
  // Charging handle (rear of upper) moves on reload.
  const slide = addGroup(g, [0, 0.045, 0.1]);
  addBox(slide, [0.05, 0.012, 0.03], [0, 0, 0], p.anodized);
  parts.slide = slide;

  // Ribbed round handguard with delta ring.
  addCylinder(g, 0.04, 0.02, [0, 0.015, -0.245], p.steel, 10);
  addCylinder(g, 0.034, 0.26, [0, 0.015, -0.375], p.polymer, 8);
  addCylinder(g, 0.037, 0.014, [0, 0.015, -0.42], p.polymer, 8);
  // Barrel and triangular A2 front sight.
  addCylinder(g, 0.012, 0.08, [0, 0.015, -0.54], p.blued, 8);
  addBox(g, [0.026, 0.03, 0.03], [0, 0.035, -0.56], p.anodized);
  addBox(g, [0.012, 0.075, 0.016], [0, 0.07, -0.548], p.anodized, [-0.3, 0, 0]);
  addBox(g, [0.012, 0.075, 0.016], [0, 0.07, -0.572], p.anodized, [0.3, 0, 0]);
  addBox(g, [0.004, 0.02, 0.004], [0, 0.112, -0.56], p.blued);
  // Long detachable suppressor with chamfered end.
  addCylinder(g, 0.028, 0.03, [0, 0.015, -0.595], p.steel, 12);
  addCylinder(g, 0.026, 0.33, [0, 0.015, -0.775], p.suppressor, 12);
  addCylinder(g, 0.026, 0.015, [0, 0.015, -0.9475], p.suppressor, 12, 'z', 0.02);

  // Pistol grip, trigger guard, trigger.
  const grip = addGroup(g, [0, -0.07, 0.04], [-0.4, 0, 0]);
  addBox(grip, [0.048, 0.14, 0.065], [0, -0.06, 0], p.polymer);
  addBox(g, [0.016, 0.01, 0.11], [0, -0.1, -0.035], p.anodized);
  addBox(g, [0.008, 0.035, 0.012], [0, -0.085, -0.03], p.steel, [-0.25, 0, 0]);

  // Buffer tube + collapsible LE stock.
  addCylinder(g, 0.018, 0.2, [0, 0.0, 0.18], p.anodized, 10);
  addBox(g, [0.055, 0.1, 0.16], [0, -0.02, 0.28], p.polymer);
  addBox(g, [0.045, 0.05, 0.07], [0, -0.08, 0.33], p.polymer);
  addBox(g, [0.06, 0.15, 0.02], [0, -0.04, 0.37], p.rubber);

  // Curved STANAG magazine.
  const magazine = addGroup(g, [0, -0.11, -0.13]);
  addBox(magazine, [0.05, 0.1, 0.075], [0, -0.03, 0], p.anodized, [0.08, 0, 0]);
  addBox(magazine, [0.05, 0.1, 0.075], [0, -0.1288, -0.0149], p.anodized, [0.22, 0, 0]);
  addBox(magazine, [0.056, 0.014, 0.085], [0, -0.1806, -0.0273], p.polymer, [0.22, 0, 0]);
  parts.magazine = magazine;
  parts.muzzle.position.set(0, 0.015, -0.96);
}

function buildDeagle(g: Group, p: Palette, parts: Parts): void {
  const tilt = 0.25;
  addBox(g, [0.09, 0.05, 0.36], [0, -0.005, -0.12], p.steel);
  // Fixed polygonal barrel with triangular top and rail.
  addBox(g, [0.08, 0.06, 0.26], [0, 0.06, -0.33], p.chrome);
  addBox(g, [0.045, 0.045, 0.26], [0, 0.09, -0.33], p.chrome, [0, 0, Math.PI / 4]);
  addBox(g, [0.022, 0.01, 0.26], [0, 0.124, -0.33], p.blued);
  addCylinder(g, 0.014, 0.005, [0, 0.055, -0.461], p.hole, 8);
  buildPistolGrip(g, p, tilt, p.rubber, false);
  buildTriggerGroup(g, p, p.steel, true);
  addBox(g, [0.022, 0.035, 0.016], [0, 0.062, 0.07], p.steel, [0.45, 0, 0]);

  // Heavy slide behind the barrel.
  const slide = addGroup(g, [0, 0.06, -0.08]);
  addBox(slide, [0.1, 0.075, 0.24], [0, 0, 0], p.steel);
  for (const z of [0.06, 0.08, 0.1]) {
    addBox(slide, [0.102, 0.05, 0.008], [0, -0.008, z], p.blued);
  }
  addBox(slide, [0.004, 0.03, 0.08], [0.051, 0.012, -0.04], p.hole);
  addPistolSights(slide, p, 0.0375, -0.1, 0.105);
  parts.slide = slide;

  parts.magazine = buildPistolMagazine(g, p, tilt);
  parts.muzzle.position.set(0, 0.055, -0.47);
}

function buildAwp(g: Group, p: Palette, parts: Parts): void {
  // L96-style green chassis with thumbhole stock.
  addBox(g, [0.085, 0.09, 0.5], [0, -0.03, -0.35], p.awpGreen);
  addBox(g, [0.09, 0.11, 0.24], [0, -0.04, 0.0], p.awpGreen);
  addBox(g, [0.07, 0.06, 0.3], [0, 0.0, 0.27], p.awpGreen);
  addBox(g, [0.06, 0.03, 0.18], [0, 0.045, 0.3], p.awpGreen);
  addBox(g, [0.07, 0.07, 0.26], [0, -0.15, 0.3], p.awpGreen);
  addBox(g, [0.06, 0.13, 0.07], [0, -0.09, 0.14], p.awpGreen, [-0.3, 0, 0]);
  addBox(g, [0.075, 0.22, 0.08], [0, -0.075, 0.44], p.awpGreen);
  addBox(g, [0.078, 0.23, 0.02], [0, -0.075, 0.49], p.rubber);
  // Receiver, fluted barrel and muzzle brake.
  addCylinder(g, 0.032, 0.3, [0, 0.03, -0.08], p.blued, 12);
  addCylinder(g, 0.024, 0.9, [0, 0.03, -0.68], p.blued, 10, 'z', 0.018);
  addCylinder(g, 0.03, 0.1, [0, 0.03, -1.17], p.blued, 10);
  addBox(g, [0.064, 0.014, 0.03], [0, 0.03, -1.17], p.hole);

  // Big scope with turrets, mounts and lenses.
  addBox(g, [0.03, 0.06, 0.03], [0, 0.08, -0.2], p.blued);
  addBox(g, [0.03, 0.06, 0.03], [0, 0.08, 0.02], p.blued);
  addCylinder(g, 0.03, 0.36, [0, 0.12, -0.1], p.polymer, 12);
  addCylinder(g, 0.03, 0.1, [0, 0.12, -0.33], p.polymer, 12, 'z', 0.05);
  addCylinder(g, 0.05, 0.06, [0, 0.12, -0.41], p.polymer, 12);
  addCylinder(g, 0.03, 0.08, [0, 0.12, 0.12], p.polymer, 12, 'z', 0.042);
  addCylinder(g, 0.046, 0.004, [0, 0.12, -0.441], p.lens, 12);
  addCylinder(g, 0.036, 0.004, [0, 0.12, 0.162], p.lens, 12);
  addCylinder(g, 0.018, 0.04, [0, 0.165, -0.1], p.steel, 10, 'y');
  addCylinder(g, 0.018, 0.04, [0.045, 0.12, -0.1], p.steel, 10, 'x');

  const bolt = addGroup(g, [0.04, 0.035, 0.03]);
  addCylinder(bolt, 0.008, 0.07, [0.035, 0, 0], p.chrome, 8, 'x');
  addSphere(bolt, 0.016, [0.072, -0.004, 0], p.polymer, 8, 6);
  parts.bolt = bolt;

  const magazine = addGroup(g, [0, -0.12, -0.06]);
  addBox(magazine, [0.06, 0.1, 0.11], [0, 0, 0], p.blued);
  parts.magazine = magazine;
  parts.muzzle.position.set(0, 0.03, -1.22);
}

function buildHeGrenade(g: Group, p: Palette): void {
  const z = -0.08;
  const body = addSphere(g, 0.125, [0, 0.02, z], p.olive, 10, 8);
  body.scale.y = 1.08;
  addTorus(g, 0.125, 0.007, [0, 0.02, z], p.blued, [Math.PI / 2, 0, 0], 12);
  addTorus(g, 0.13, 0.007, [0, 0.02, z], p.blued, [0, Math.PI / 2, 0], 12);
  addGrenadeFuze(g, p, 0.15, z, 0.1, 0.25);
}

function buildMolotov(g: Group, p: Palette): void {
  const z = -0.08;
  addCylinder(g, 0.07, 0.2, [0, -0.02, z], p.bottle, 12, 'y');
  addCylinder(g, 0.062, 0.13, [0, -0.055, z], p.liquid, 10, 'y');
  addCylinder(g, 0.025, 0.05, [0, 0.105, z], p.bottle, 10, 'y', 0.07);
  addCylinder(g, 0.024, 0.08, [0, 0.17, z], p.bottle, 10, 'y');
  addCylinder(g, 0.028, 0.04, [0, 0.215, z], p.rag, 8, 'y');
  addBox(g, [0.03, 0.09, 0.012], [0, 0.26, z + 0.01], p.rag, [0.3, 0, 0.15]);
  addSphere(g, 0.016, [0.006, 0.305, z - 0.004], p.ember, 6, 4);
}

// ---------------------------------------------------------------------------

export function createWeaponModel(weaponId: WeaponId, scale = 1): WeaponModel {
  const definition = getWeapon(weaponId);
  const group = new Group();
  group.scale.setScalar(scale);

  const p = palette();
  const metal = p.steel;
  const dark = p.polymer;
  const accent = accentMaterial(definition.color);
  const glass = p.lens;
  const muzzle = new Object3D();
  const parts: Parts = { muzzle };

  let magazine: Group | undefined;
  let slide: Group | undefined;
  let bolt: Group | undefined;

  if (weaponId === 'knife') {
    buildKnife(group, p, parts);
  } else if (weaponId === 'glock') {
    buildGlock(group, p, parts);
  } else if (weaponId === 'usp') {
    buildUsp(group, p, parts);
  } else if (weaponId === 'deagle') {
    buildDeagle(group, p, parts);
  } else if (weaponId === 'ak47') {
    buildAk47(group, p, parts);
  } else if (weaponId === 'm4a1') {
    buildM4a1(group, p, parts);
  } else if (weaponId === 'awp') {
    buildAwp(group, p, parts);
  } else if (weaponId === 'hegrenade') {
    buildHeGrenade(group, p);
    muzzle.position.set(0, 0.08, -0.28);
  } else if (weaponId === 'flashbang') {
    buildCanGrenade(group, p, {
      body: p.flashSilver,
      band: p.blueBand,
      radius: 0.07,
      height: 0.22,
      bandY: -0.06,
      holeCount: 8,
      holeY: 0.045,
      holeRadius: 0.012,
    });
    muzzle.position.set(0, 0.08, -0.28);
  } else if (weaponId === 'smokegrenade') {
    buildCanGrenade(group, p, {
      body: p.smokeGreen,
      band: p.whiteBand,
      radius: 0.07,
      height: 0.24,
      bandY: 0.0,
      holeCount: 4,
      holeY: 0.095,
      holeRadius: 0.01,
    });
    muzzle.position.set(0, 0.08, -0.28);
  } else if (weaponId === 'incendiary') {
    buildCanGrenade(group, p, {
      body: p.incendiary,
      band: p.redBand,
      radius: 0.068,
      height: 0.22,
      bandY: 0.055,
      holeCount: 6,
      holeY: -0.04,
      holeRadius: 0.011,
    });
    muzzle.position.set(0, 0.08, -0.3);
  } else if (weaponId === 'molotov') {
    buildMolotov(group, p);
    muzzle.position.set(0, 0.08, -0.3);
  } else if (
    weaponId === 'p250' ||
    weaponId === 'fiveseven' ||
    weaponId === 'tec9' ||
    weaponId === 'dualberettas'
  ) {
    const long = weaponId === 'fiveseven' || weaponId === 'tec9';
    addBox(group, [0.088, 0.1, long ? 0.4 : 0.34], [0, -0.015, -0.08], accent);
    addBox(group, [0.075, 0.19, 0.1], [0, -0.13, 0.09], dark, [-0.25, 0, 0]);
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
  } else if (weaponId === 'ssg08') {
    addBox(group, [0.085, 0.12, 0.58], [0, 0, -0.1], accent);
    addCylinder(group, 0.026, 0.76, [0, 0.015, -0.72], metal);
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
    muzzle.position.set(0, 0.015, -1.12);
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
    magazine: magazine ?? parts.magazine,
    slide: slide ?? parts.slide,
    bolt: bolt ?? parts.bolt,
    dispose: () => disposeObject3D(group),
  };
}
