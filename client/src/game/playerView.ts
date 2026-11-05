import {
  BoxGeometry,
  type BufferGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  type Material,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  type MeshStandardMaterialParameters,
  RingGeometry,
  SphereGeometry,
} from 'three';
import { MOVEMENT, PLAYER } from '../../../shared/config';
import type { Side } from '../../../shared/economy';
import type { PlayerSnapshot } from '../../../shared/protocol';
import { getWeapon, type WeaponId, type WeaponSlot } from '../../../shared/weapons';
import { disposeObject3D } from './dispose';
import { createWeaponModel, type WeaponModel } from './weaponModel';

const SIDE_COLORS = {
  t: 0xfb923c,
  ct: 0x38bdf8,
} as const;

// Hitbox matching constants:
// Server head hitbox is a sphere of radius 0.21 centered at y = height - 0.21 (1.59 standing).
// Server body hitbox is a cylinder of radius 0.32 from y = height * 0.46 (0.828) to 1.59.
// Server leg hitbox is a cylinder of radius 0.27 from y = 0 to 0.828.
const CROUCH_SCALE = MOVEMENT.crouchHeight / MOVEMENT.standHeight;
const UPPER_Y = 1.24;
const HEAD_CENTER_Y = MOVEMENT.standHeight - PLAYER.headRadius;
const HEAD_OFFSET_Y = HEAD_CENTER_Y - UPPER_Y;

type Vec3 = [number, number, number];

// ---------------------------------------------------------------------------
// Shared Resource Caches
// Resources flagged with `userData.shared = true` survive disposeObject3D.
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

// ---------------------------------------------------------------------------
// CS2 Agent Color Palette: CT (SAS) & T (Phoenix Connexion)
// ---------------------------------------------------------------------------

interface AgentPalette {
  // CT (SAS) Materials: deep navy coveralls, Kevlar plate carrier, S10 gas mask
  ctUniform: Material;
  ctUniformDark: Material;
  ctVest: Material;
  ctWebbing: Material;
  ctMaskRubber: Material;
  ctMaskCanister: Material;
  ctMaskLens: Material;
  ctMaskLensRim: Material;
  ctGloves: Material;
  ctBoots: Material;
  ctPads: Material;

  // T (Phoenix Connexion) Materials: burnt orange canvas jacket, pale balaclava
  tJacket: Material;
  tJacketDark: Material;
  tPants: Material;
  tBalaclava: Material;
  tBalaclavaSeam: Material;
  tBalaclavaCutout: Material;
  tFaceSkin: Material;
  tHarness: Material;
  tPouches: Material;
  tGloves: Material;
  tBoots: Material;
  tPads: Material;
}

let agentPaletteCache: AgentPalette | null = null;

function getAgentPalette(): AgentPalette {
  if (agentPaletteCache !== null) {
    return agentPaletteCache;
  }

  agentPaletteCache = {
    // CT (SAS)
    ctUniform: standard('ct-uniform', { color: 0x1d2c3f, roughness: 0.72, metalness: 0.08 }),
    ctUniformDark: standard('ct-uniform-dark', { color: 0x131e2b, roughness: 0.8, metalness: 0.05 }),
    ctVest: standard('ct-vest', { color: 0x151b24, roughness: 0.62, metalness: 0.18 }),
    ctWebbing: standard('ct-webbing', { color: 0x0f131a, roughness: 0.85, metalness: 0.1 }),
    ctMaskRubber: standard('ct-mask-rubber', { color: 0x12161d, roughness: 0.5, metalness: 0.2 }),
    ctMaskCanister: standard('ct-mask-canister', { color: 0x1f2732, roughness: 0.38, metalness: 0.45 }),
    ctMaskLens: standard('ct-mask-lens', { color: 0x0a1622, roughness: 0.12, metalness: 0.85 }),
    ctMaskLensRim: standard('ct-mask-lens-rim', { color: 0x222c3a, roughness: 0.4, metalness: 0.6 }),
    ctGloves: standard('ct-gloves', { color: 0x141a22, roughness: 0.7, metalness: 0.15 }),
    ctBoots: standard('ct-boots', { color: 0x0b0e13, roughness: 0.78, metalness: 0.12 }),
    ctPads: standard('ct-pads', { color: 0x0c1015, roughness: 0.45, metalness: 0.25 }),

    // T (Phoenix Connexion)
    tJacket: standard('t-jacket', { color: 0xa24d22, roughness: 0.76, metalness: 0.05 }),
    tJacketDark: standard('t-jacket-dark', { color: 0x783515, roughness: 0.82, metalness: 0.04 }),
    tPants: standard('t-pants', { color: 0x39352e, roughness: 0.84, metalness: 0.05 }),
    tBalaclava: standard('t-balaclava', { color: 0xd0c9be, roughness: 0.92, metalness: 0.02 }),
    tBalaclavaSeam: standard('t-balaclava-seam', { color: 0xbdb5a7, roughness: 0.9, metalness: 0.02 }),
    tBalaclavaCutout: standard('t-balaclava-cutout', { color: 0x1a1715, roughness: 0.95, metalness: 0.0 }),
    tFaceSkin: standard('t-face-skin', { color: 0x7a5b46, roughness: 0.75, metalness: 0.0 }),
    tHarness: standard('t-harness', { color: 0x221f1c, roughness: 0.8, metalness: 0.1 }),
    tPouches: standard('t-pouches', { color: 0x2e2924, roughness: 0.82, metalness: 0.08 }),
    tGloves: standard('t-gloves', { color: 0x221f1d, roughness: 0.75, metalness: 0.12 }),
    tBoots: standard('t-boots', { color: 0x161412, roughness: 0.8, metalness: 0.1 }),
    tPads: standard('t-pads', { color: 0x1e1c19, roughness: 0.5, metalness: 0.2 }),
  };

  return agentPaletteCache;
}

// ---------------------------------------------------------------------------
// Mesh Construction Helpers
// ---------------------------------------------------------------------------

function addBox(
  parent: Group,
  size: Vec3,
  pos: Vec3,
  material: Material,
  rot?: Vec3,
  castShadow = true,
): Mesh {
  const key = `box_${size[0]}_${size[1]}_${size[2]}`;
  const geo = sharedGeometry(key, () => new BoxGeometry(size[0], size[1], size[2]));
  const mesh = new Mesh(geo, material);
  mesh.position.set(pos[0], pos[1], pos[2]);
  if (rot !== undefined) {
    mesh.rotation.set(rot[0], rot[1], rot[2]);
  }
  mesh.castShadow = castShadow;
  parent.add(mesh);
  return mesh;
}

function addCylinder(
  parent: Group,
  rTop: number,
  rBottom: number,
  height: number,
  pos: Vec3,
  material: Material,
  rot?: Vec3,
  segments = 12,
  castShadow = true,
): Mesh {
  const key = `cyl_${rTop}_${rBottom}_${height}_${segments}`;
  const geo = sharedGeometry(key, () => new CylinderGeometry(rTop, rBottom, height, segments));
  const mesh = new Mesh(geo, material);
  mesh.position.set(pos[0], pos[1], pos[2]);
  if (rot !== undefined) {
    mesh.rotation.set(rot[0], rot[1], rot[2]);
  }
  mesh.castShadow = castShadow;
  parent.add(mesh);
  return mesh;
}

function addSphere(
  parent: Group,
  radius: number,
  pos: Vec3,
  material: Material,
  segments = 16,
  rings = 12,
  castShadow = true,
): Mesh {
  const key = `sphere_${radius}_${segments}_${rings}`;
  const geo = sharedGeometry(key, () => new SphereGeometry(radius, segments, rings));
  const mesh = new Mesh(geo, material);
  mesh.position.set(pos[0], pos[1], pos[2]);
  mesh.castShadow = castShadow;
  parent.add(mesh);
  return mesh;
}

export class PlayerView {
  readonly root = new Group();

  private readonly upper = new Group();
  private readonly weaponMount = new Group();
  private readonly legLeft = new Group();
  private readonly legRight = new Group();

  // Arm joint hierarchies for authentic weapon grip and poses
  private readonly armRightUpper = new Group();
  private readonly armRightForearm = new Group();
  private readonly armLeftUpper = new Group();
  private readonly armLeftForearm = new Group();

  // Team visual nodes (swapped cleanly based on side)
  private readonly ctNodes: Group[] = [];
  private readonly tNodes: Group[] = [];

  private weapon: WeaponModel | null = null;
  private weaponId: WeaponId | null = null;
  private walkPhase = 0;
  private lastPosition = { x: 0, y: 0, z: 0 };
  private lastColorKey: string | null = null;
  private lastCrouching = false;
  private disposed = false;

  constructor(playerId: string) {
    this.root.name = `player-${playerId}`;

    // Team Ring on ground
    const teamRing = new Mesh(
      new RingGeometry(0.44, 0.56, 32),
      new MeshBasicMaterial({
        color: 0x38bdf8,
        transparent: true,
        opacity: 0.65,
        side: DoubleSide,
        depthWrite: false,
      }),
    );
    teamRing.rotation.x = -Math.PI / 2;
    teamRing.position.y = 0.018;
    teamRing.name = 'team-ring';
    this.root.add(teamRing);

    const p = getAgentPalette();

    // -------------------------------------------------------------------------
    // Lower Torso & Pelvis (on root)
    // Conforms strictly to body cylinder radius 0.32, height 0.72 - 1.24
    // -------------------------------------------------------------------------

    // CT Lower Torso
    const ctTorso = new Group();
    addBox(ctTorso, [0.46, 0.32, 0.24], [0, 0.98, 0], p.ctUniform);
    addBox(ctTorso, [0.44, 0.26, 0.27], [0, 1.02, 0.005], p.ctVest);
    // 3 Front magazine pouches
    addBox(ctTorso, [0.08, 0.14, 0.05], [-0.11, 1.00, -0.15], p.ctWebbing);
    addBox(ctTorso, [0.08, 0.14, 0.05], [0.0, 1.00, -0.155], p.ctWebbing);
    addBox(ctTorso, [0.08, 0.14, 0.05], [0.11, 1.00, -0.15], p.ctWebbing);
    // Tactical belt & buckle
    addBox(ctTorso, [0.50, 0.08, 0.28], [0, 0.78, 0], p.ctWebbing);
    addBox(ctTorso, [0.09, 0.06, 0.02], [0, 0.78, -0.145], p.ctMaskCanister);
    addBox(ctTorso, [0.06, 0.10, 0.10], [0.25, 0.76, 0.02], p.ctWebbing);
    addBox(ctTorso, [0.38, 0.12, 0.22], [0, 0.72, 0], p.ctUniformDark);
    this.root.add(ctTorso);
    this.ctNodes.push(ctTorso);

    // T Lower Torso
    const tTorso = new Group();
    addBox(tTorso, [0.46, 0.32, 0.24], [0, 0.98, 0], p.tJacket);
    addBox(tTorso, [0.03, 0.32, 0.01], [0, 0.98, -0.125], p.tHarness);
    addBox(tTorso, [0.44, 0.05, 0.26], [0, 1.08, 0], p.tHarness);
    // 3 Front canvas magazine pouches
    addBox(tTorso, [0.08, 0.14, 0.05], [-0.11, 1.00, -0.15], p.tPouches);
    addBox(tTorso, [0.08, 0.14, 0.05], [0.0, 1.00, -0.155], p.tPouches);
    addBox(tTorso, [0.08, 0.14, 0.05], [0.11, 1.00, -0.15], p.tPouches);
    // Belt & holster
    addBox(tTorso, [0.50, 0.08, 0.28], [0, 0.78, 0], p.tHarness);
    addBox(tTorso, [0.08, 0.06, 0.02], [0, 0.78, -0.145], p.tFaceSkin);
    addBox(tTorso, [0.06, 0.11, 0.10], [0.25, 0.75, 0.02], p.tPouches);
    addBox(tTorso, [0.38, 0.12, 0.22], [0, 0.72, 0], p.tPants);
    this.root.add(tTorso);
    this.tNodes.push(tTorso);

    // -------------------------------------------------------------------------
    // Legs (on root, pivot at y = 0.70)
    // Conforms strictly to leg cylinder radius 0.27, height 0.0 - 0.70
    // -------------------------------------------------------------------------

    this.legLeft.position.set(-0.13, 0.70, 0);
    this.legRight.position.set(0.13, 0.70, 0);
    this.root.add(this.legLeft, this.legRight);

    // Build legs for CT and T
    for (const [legGroup, isLeft] of [[this.legLeft, true], [this.legRight, false]] as const) {
      // CT Leg
      const ctLeg = new Group();
      addBox(ctLeg, [0.18, 0.38, 0.20], [0, -0.20, 0], p.ctUniform);
      addBox(ctLeg, [0.17, 0.30, 0.19], [0, -0.48, 0], p.ctUniform);
      addBox(ctLeg, [0.13, 0.11, 0.04], [0, -0.32, -0.115], p.ctPads);
      // Assault boot
      addBox(ctLeg, [0.16, 0.16, 0.18], [0, -0.60, 0.01], p.ctBoots);
      addBox(ctLeg, [0.15, 0.10, 0.22], [0, -0.65, -0.04], p.ctBoots);
      addBox(ctLeg, [0.16, 0.03, 0.24], [0, -0.69, -0.03], p.ctBoots);
      legGroup.add(ctLeg);
      this.ctNodes.push(ctLeg);

      // T Leg
      const tLeg = new Group();
      addBox(tLeg, [0.18, 0.38, 0.20], [0, -0.20, 0], p.tPants);
      addBox(tLeg, [0.17, 0.30, 0.19], [0, -0.48, 0], p.tPants);
      // Cargo pocket on outer side
      const pocketX = isLeft ? -0.10 : 0.10;
      addBox(tLeg, [0.04, 0.13, 0.12], [pocketX, -0.22, 0], p.tPants);
      addBox(tLeg, [0.13, 0.11, 0.04], [0, -0.32, -0.115], p.tPads);
      // Combat boot
      addBox(tLeg, [0.16, 0.16, 0.18], [0, -0.60, 0.01], p.tBoots);
      addBox(tLeg, [0.15, 0.10, 0.22], [0, -0.65, -0.04], p.tBoots);
      addBox(tLeg, [0.16, 0.03, 0.24], [0, -0.69, -0.03], p.tBoots);
      legGroup.add(tLeg);
      this.tNodes.push(tLeg);
    }

    // -------------------------------------------------------------------------
    // Upper Body, Head & Arms (tilts with player.pitch)
    // -------------------------------------------------------------------------

    this.upper.position.y = UPPER_Y;
    this.root.add(this.upper);

    // CT Upper Body & SAS Gas Mask Head
    const ctUpper = new Group();
    addBox(ctUpper, [0.48, 0.24, 0.26], [0, 0.08, 0], p.ctVest);
    addBox(ctUpper, [0.10, 0.06, 0.28], [-0.16, 0.19, 0], p.ctWebbing);
    addBox(ctUpper, [0.10, 0.06, 0.28], [0.16, 0.19, 0], p.ctWebbing);
    // Shoulder tactical radio
    addBox(ctUpper, [0.06, 0.10, 0.05], [-0.18, 0.14, -0.14], p.ctWebbing);
    addCylinder(ctUpper, 0.005, 0.005, 0.12, [-0.18, 0.24, -0.14], p.ctWebbing);
    addCylinder(ctUpper, 0.11, 0.13, 0.12, [0, 0.20, 0], p.ctUniformDark);

    // SAS Head (sphere radius 0.20 at HEAD_OFFSET_Y = 0.35, matching server head radius 0.21)
    addSphere(ctUpper, 0.20, [0, HEAD_OFFSET_Y, 0], p.ctUniformDark, 18, 14);
    addSphere(ctUpper, 0.185, [0, HEAD_OFFSET_Y - 0.02, -0.04], p.ctMaskRubber, 16, 12);
    // Left eye lens & metallic bezel
    addCylinder(ctUpper, 0.042, 0.042, 0.025, [-0.062, HEAD_OFFSET_Y + 0.025, -0.17], p.ctMaskLensRim, [Math.PI / 2, 0, 0]);
    addCylinder(ctUpper, 0.036, 0.036, 0.026, [-0.062, HEAD_OFFSET_Y + 0.025, -0.172], p.ctMaskLens, [Math.PI / 2, 0, 0]);
    // Right eye lens & metallic bezel
    addCylinder(ctUpper, 0.042, 0.042, 0.025, [0.062, HEAD_OFFSET_Y + 0.025, -0.17], p.ctMaskLensRim, [Math.PI / 2, 0, 0]);
    addCylinder(ctUpper, 0.036, 0.036, 0.026, [0.062, HEAD_OFFSET_Y + 0.025, -0.172], p.ctMaskLens, [Math.PI / 2, 0, 0]);
    // Voice emitter / front speech diaphragm
    addCylinder(ctUpper, 0.038, 0.038, 0.035, [0, HEAD_OFFSET_Y - 0.065, -0.175], p.ctMaskCanister, [Math.PI / 2, 0, 0]);
    // S10 respirator filter canister (left cheek)
    addCylinder(ctUpper, 0.042, 0.044, 0.055, [-0.095, HEAD_OFFSET_Y - 0.065, -0.145], p.ctMaskCanister, [Math.PI / 2 - 0.2, -0.3, 0]);
    this.upper.add(ctUpper);
    this.ctNodes.push(ctUpper);

    // T Upper Body & Phoenix Connexion Balaclava Head
    const tUpper = new Group();
    addBox(tUpper, [0.48, 0.24, 0.26], [0, 0.08, 0], p.tJacket);
    addBox(tUpper, [0.28, 0.08, 0.24], [0, 0.18, 0], p.tJacketDark);
    addBox(tUpper, [0.08, 0.06, 0.28], [-0.15, 0.18, 0], p.tHarness);
    addBox(tUpper, [0.08, 0.06, 0.28], [0.15, 0.18, 0], p.tHarness);

    // Phoenix Balaclava Head (radius 0.20 at HEAD_OFFSET_Y = 0.35)
    addSphere(tUpper, 0.20, [0, HEAD_OFFSET_Y, 0], p.tBalaclava, 18, 14);
    addBox(tUpper, [0.02, 0.22, 0.22], [0, HEAD_OFFSET_Y + 0.10, 0.02], p.tBalaclavaSeam);
    addCylinder(tUpper, 0.125, 0.14, 0.10, [0, 0.22, 0], p.tBalaclava);
    // Eye slit opening & inner face tone
    addBox(tUpper, [0.17, 0.055, 0.04], [0, HEAD_OFFSET_Y + 0.025, -0.18], p.tBalaclavaCutout);
    addBox(tUpper, [0.14, 0.028, 0.02], [0, HEAD_OFFSET_Y + 0.025, -0.185], p.tFaceSkin);
    this.upper.add(tUpper);
    this.tNodes.push(tUpper);

    // -------------------------------------------------------------------------
    // Articulated Arms: Right Arm grips the weapon mount; Left Arm supports
    // -------------------------------------------------------------------------

    // Right Arm: starts at shoulder, bends down to hand gripping weapon
    this.armRightUpper.position.set(0.24, 0.16, -0.02);
    this.armRightForearm.position.set(0, -0.20, 0);
    this.armRightUpper.add(this.armRightForearm);
    this.upper.add(this.armRightUpper);

    // CT Right Arm
    const ctRightUpper = new Group();
    addBox(ctRightUpper, [0.12, 0.20, 0.12], [0, -0.10, 0], p.ctUniform);
    addBox(ctRightUpper, [0.10, 0.08, 0.06], [0, -0.19, -0.05], p.ctPads);
    this.armRightUpper.add(ctRightUpper);
    this.ctNodes.push(ctRightUpper);

    const ctRightForearm = new Group();
    addBox(ctRightForearm, [0.11, 0.16, 0.11], [0, -0.08, 0], p.ctUniform);
    addBox(ctRightForearm, [0.10, 0.08, 0.10], [0, -0.18, 0], p.ctGloves);
    addBox(ctRightForearm, [0.08, 0.06, 0.08], [0, -0.18, -0.04], p.ctGloves);
    this.armRightForearm.add(ctRightForearm);
    this.ctNodes.push(ctRightForearm);

    // T Right Arm
    const tRightUpper = new Group();
    addBox(tRightUpper, [0.12, 0.20, 0.12], [0, -0.10, 0], p.tJacket);
    addBox(tRightUpper, [0.10, 0.08, 0.06], [0, -0.19, -0.05], p.tJacketDark);
    this.armRightUpper.add(tRightUpper);
    this.tNodes.push(tRightUpper);

    const tRightForearm = new Group();
    addBox(tRightForearm, [0.11, 0.16, 0.11], [0, -0.08, 0], p.tJacket);
    addBox(tRightForearm, [0.10, 0.08, 0.10], [0, -0.18, 0], p.tGloves);
    addBox(tRightForearm, [0.08, 0.06, 0.08], [0, -0.18, -0.04], p.tGloves);
    this.armRightForearm.add(tRightForearm);
    this.tNodes.push(tRightForearm);

    // Left Arm: reaches to support weapon or rests in ready stance
    this.armLeftUpper.position.set(-0.24, 0.16, -0.02);
    this.armLeftForearm.position.set(0, -0.20, 0);
    this.armLeftUpper.add(this.armLeftForearm);
    this.upper.add(this.armLeftUpper);

    // CT Left Arm
    const ctLeftUpper = new Group();
    addBox(ctLeftUpper, [0.12, 0.20, 0.12], [0, -0.10, 0], p.ctUniform);
    addBox(ctLeftUpper, [0.10, 0.08, 0.06], [0, -0.19, -0.05], p.ctPads);
    this.armLeftUpper.add(ctLeftUpper);
    this.ctNodes.push(ctLeftUpper);

    const ctLeftForearm = new Group();
    addBox(ctLeftForearm, [0.11, 0.16, 0.11], [0, -0.08, 0], p.ctUniform);
    addBox(ctLeftForearm, [0.09, 0.08, 0.09], [0, -0.18, 0], p.ctGloves);
    addBox(ctLeftForearm, [0.08, 0.05, 0.07], [0, -0.18, -0.04], p.ctGloves);
    this.armLeftForearm.add(ctLeftForearm);
    this.ctNodes.push(ctLeftForearm);

    // T Left Arm
    const tLeftUpper = new Group();
    addBox(tLeftUpper, [0.12, 0.20, 0.12], [0, -0.10, 0], p.tJacket);
    addBox(tLeftUpper, [0.10, 0.08, 0.06], [0, -0.19, -0.05], p.tJacketDark);
    this.armLeftUpper.add(tLeftUpper);
    this.tNodes.push(tLeftUpper);

    const tLeftForearm = new Group();
    addBox(tLeftForearm, [0.11, 0.16, 0.11], [0, -0.08, 0], p.tJacket);
    addBox(tLeftForearm, [0.09, 0.08, 0.09], [0, -0.18, 0], p.tGloves);
    addBox(tLeftForearm, [0.08, 0.05, 0.07], [0, -0.18, -0.04], p.tGloves);
    this.armLeftForearm.add(tLeftForearm);
    this.tNodes.push(tLeftForearm);

    // Default right arm angles: hands firmly hold weapon grip
    this.armRightUpper.rotation.set(0.85, 0.10, -0.10);
    this.armRightForearm.rotation.set(0.40, 0, 0);

    // Weapon Mount positioned precisely where the right hand holds the grip
    this.weaponMount.position.set(0.20, 0.02, -0.34);
    this.upper.add(this.weaponMount);

    this.root.userData.playerId = playerId;
    this.setSideColor('t');
    this.applyArmPose('primary');
  }

  update(player: PlayerSnapshot, dt: number): void {
    if (this.disposed) {
      return;
    }

    this.root.visible = player.alive;
    if (!player.alive) {
      return;
    }

    this.root.position.set(player.position.x, player.position.y, player.position.z);
    this.root.rotation.y = player.yaw;
    this.upper.rotation.x = player.pitch;

    if (player.crouching !== this.lastCrouching) {
      this.lastCrouching = player.crouching;
      this.root.scale.y = player.crouching ? CROUCH_SCALE : 1;
    }

    const dx = player.position.x - this.lastPosition.x;
    const dz = player.position.z - this.lastPosition.z;
    const speed = Math.hypot(dx, dz) / Math.max(dt, 0.001);
    this.lastPosition = { ...player.position };

    if (speed > 0.15) {
      this.walkPhase += dt * Math.min(speed, 8) * 3.6;
      const swing = Math.sin(this.walkPhase) * 0.5;
      this.legLeft.rotation.x = swing;
      this.legRight.rotation.x = -swing;
    } else {
      this.legLeft.rotation.x *= Math.max(0, 1 - dt * 10);
      this.legRight.rotation.x *= Math.max(0, 1 - dt * 10);
    }

    if (player.activeWeapon !== this.weaponId) {
      this.setWeapon(player.activeWeapon);
    }

    const side: Side = player.side ?? (player.team === 'alpha' ? 't' : 'ct');
    if (side !== this.lastColorKey) {
      this.lastColorKey = side;
      this.setSideColor(side);
    }
  }

  private setSideColor(side: Side): void {
    const isCt = side === 'ct';
    for (const node of this.ctNodes) {
      node.visible = isCt;
    }
    for (const node of this.tNodes) {
      node.visible = !isCt;
    }

    const hex = SIDE_COLORS[side];
    const ring = this.root.getObjectByName('team-ring');
    if (ring instanceof Mesh && ring.material instanceof MeshBasicMaterial) {
      ring.material.color.setHex(hex);
    }
  }

  private setWeapon(weaponId: WeaponId): void {
    this.weapon?.dispose();
    this.weapon = createWeaponModel(weaponId, 0.78);
    this.weapon.group.position.set(0, 0, 0);
    this.weaponMount.add(this.weapon.group);
    this.weaponId = weaponId;

    const def = getWeapon(weaponId);
    const slot = def ? def.slot : 'primary';
    this.applyArmPose(slot);
  }

  private applyArmPose(slot: WeaponSlot): void {
    if (slot === 'primary') {
      // Two-handed hold: left arm extends forward across body to support handguard
      this.armLeftUpper.rotation.set(1.10, -0.50, -0.55);
      this.armLeftForearm.rotation.set(0.70, 0.20, -0.10);
    } else if (slot === 'secondary') {
      // Tactical pistol grip: left hand wraps under right hand at grip
      this.armLeftUpper.rotation.set(0.90, -0.30, -0.40);
      this.armLeftForearm.rotation.set(0.50, 0.10, -0.05);
    } else {
      // Knife / Grenades / C4: off-hand rests in combat ready stance near ribs
      this.armLeftUpper.rotation.set(0.25, 0.15, 0.10);
      this.armLeftForearm.rotation.set(0.45, 0.10, -0.05);
    }
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.weapon?.dispose();
    disposeObject3D(this.root);
  }
}
