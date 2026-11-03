import {
  ACESFilmicToneMapping,
  AdditiveBlending,
  AmbientLight,
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  EdgesGeometry,
  Fog,
  Float32BufferAttribute,
  Group,
  HemisphereLight,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PCFSoftShadowMap,
  PerspectiveCamera,
  PointLight,
  Points,
  PointsMaterial,
  RepeatWrapping,
  RingGeometry,
  Scene,
  SphereGeometry,
  SRGBColorSpace,
  Uint32BufferAttribute,
  WebGLRenderer,
} from 'three';
import { getSpawnsForTeam, type ArenaMap, type MapBoxKind } from '../../../shared/map';
import { getWeapon } from '../../../shared/weapons';
import { disposeObject3D } from './dispose';

export interface ArenaScene {
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;
  readonly renderer: WebGLRenderer;
  switchMap(map: ArenaMap): void;
  render(): void;
  resize(): void;
  dispose(): void;
}

const KIND_SURFACE: Record<MapBoxKind, { roughness: number; metalness: number }> = {
  floor: { roughness: 0.94, metalness: 0.02 },
  wall: { roughness: 0.82, metalness: 0.05 },
  crate: { roughness: 0.74, metalness: 0.08 },
  platform: { roughness: 0.78, metalness: 0.06 },
  column: { roughness: 0.7, metalness: 0.12 },
  ramp: { roughness: 0.8, metalness: 0.06 },
  roof: { roughness: 0.86, metalness: 0.03 },
  rock: { roughness: 0.96, metalness: 0.01 },
  ladder: { roughness: 0.72, metalness: 0.18 },
};

interface Dust2TextureSet {
  wall: CanvasTexture;
  floor: CanvasTexture;
  crate: CanvasTexture;
  roof: CanvasTexture;
}

function makeProceduralTexture(
  draw: (ctx: CanvasRenderingContext2D, size: number) => void,
  anisotropy: number,
): CanvasTexture | null {
  if (typeof document === 'undefined') {
    return null;
  }
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx === null) {
    return null;
  }
  draw(ctx, size);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.anisotropy = anisotropy;
  texture.needsUpdate = true;
  return texture;
}

function scaleBoxUVsWorldSpace(
  geometry: BoxGeometry,
  sizeX: number,
  sizeY: number,
  sizeZ: number,
  tileMeters: number,
): void {
  const uv = geometry.getAttribute('uv');
  if (uv === undefined) {
    return;
  }
  // BoxGeometry face order: 0:+X, 1:-X, 2:+Y, 3:-Y, 4:+Z, 5:-Z (4 vertices each)
  const faceDims: ReadonlyArray<readonly [number, number]> = [
    [sizeZ, sizeY],
    [sizeZ, sizeY],
    [sizeX, sizeZ],
    [sizeX, sizeZ],
    [sizeX, sizeY],
    [sizeX, sizeY],
  ];
  for (let face = 0; face < 6; face += 1) {
    const dims = faceDims[face];
    if (dims === undefined) continue;
    const uScale = Math.max(0.15, dims[0] / tileMeters);
    const vScale = Math.max(0.15, dims[1] / tileMeters);
    const base = face * 4;
    for (let v = 0; v < 4; v += 1) {
      const idx = base + v;
      uv.setXY(idx, uv.getX(idx) * uScale, uv.getY(idx) * vScale);
    }
  }
  uv.needsUpdate = true;
}

function createDust2Textures(anisotropy: number): Dust2TextureSet | null {
  const wall = makeProceduralTexture((ctx, size) => {
    ctx.fillStyle = '#ece0ce';
    ctx.fillRect(0, 0, size, size);
    // Soft Moroccan sandstone & stucco plaster bands (low-contrast to prevent moiré)
    const rows = 4;
    const rowH = size / rows;
    for (let r = 0; r < rows; r += 1) {
      const y = r * rowH;
      ctx.fillStyle = r % 2 === 0 ? 'rgba(255,250,242,0.14)' : 'rgba(205,180,145,0.12)';
      ctx.fillRect(0, y, size, rowH);
      ctx.fillStyle = 'rgba(150,122,90,0.12)';
      ctx.fillRect(0, y + rowH - 4, size, 4);
      const cols = 2;
      const colW = size / cols;
      const offset = (r % 2) * (colW / 2);
      for (let c = 0; c < cols; c += 1) {
        const x = (c * colW + offset) % size;
        ctx.fillRect(x, y, 4, rowH);
      }
    }
    // Subtle warm plaster grain patches
    for (let i = 0; i < 36; i += 1) {
      const gx = (i * 53) % size;
      const gy = (i * 97) % size;
      ctx.fillStyle = i % 2 === 0 ? 'rgba(255,248,236,0.08)' : 'rgba(165,134,98,0.08)';
      ctx.fillRect(gx, gy, 28, 18);
    }
  }, anisotropy);

  const floor = makeProceduralTexture((ctx, size) => {
    ctx.fillStyle = '#e5d8c3';
    ctx.fillRect(0, 0, size, size);
    // Soft limestone desert slabs & sand variation (no sharp dark grid lines)
    const grid = 2;
    const cell = size / grid;
    for (let gy = 0; gy < grid; gy += 1) {
      for (let gx = 0; gx < grid; gx += 1) {
        const shade = (gx + gy) % 2 === 0 ? 236 : 228;
        ctx.fillStyle = `rgb(${shade}, ${shade - 12}, ${shade - 28})`;
        ctx.fillRect(gx * cell + 3, gy * cell + 3, cell - 6, cell - 6);
      }
    }
    for (let i = 0; i < 40; i += 1) {
      const sx = (i * 67) % size;
      const sy = (i * 43) % size;
      ctx.fillStyle = i % 2 === 0 ? 'rgba(250,242,226,0.10)' : 'rgba(175,146,110,0.09)';
      ctx.fillRect(sx, sy, 24, 24);
    }
  }, anisotropy);

  const crate = makeProceduralTexture((ctx, size) => {
    ctx.fillStyle = '#dec6a4';
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 4; i += 1) {
      const y = (size / 4) * i;
      ctx.fillStyle = i % 2 === 0 ? 'rgba(255,246,232,0.12)' : 'rgba(150,112,72,0.12)';
      ctx.fillRect(12, y + 3, size - 24, size / 4 - 6);
      ctx.fillStyle = 'rgba(110,76,44,0.22)';
      ctx.fillRect(12, y, size - 24, 3);
    }
    ctx.strokeStyle = 'rgba(115,80,46,0.38)';
    ctx.lineWidth = 14;
    ctx.strokeRect(7, 7, size - 14, size - 14);
  }, anisotropy);

  const roof = makeProceduralTexture((ctx, size) => {
    ctx.fillStyle = '#d8baa0';
    ctx.fillRect(0, 0, size, size);
    for (let r = 0; r < 4; r += 1) {
      const y = (size / 4) * r;
      ctx.fillStyle = r % 2 === 0 ? 'rgba(170,104,68,0.16)' : 'rgba(135,82,52,0.16)';
      ctx.fillRect(0, y, size, size / 4 - 3);
    }
  }, anisotropy);

  if (wall === null || floor === null || crate === null || roof === null) {
    return null;
  }
  return { wall, floor, crate, roof };
}

function mergeIndexedGeometries(geometries: BufferGeometry[]): BufferGeometry {
  if (geometries.length === 1 && geometries[0] !== undefined) {
    return geometries[0];
  }
  let totalVertices = 0;
  let totalIndices = 0;
  for (const geo of geometries) {
    const pos = geo.getAttribute('position');
    const idx = geo.getIndex();
    if (pos !== undefined && idx !== null) {
      totalVertices += pos.count;
      totalIndices += idx.count;
    }
  }
  const positions = new Float32Array(totalVertices * 3);
  const normals = new Float32Array(totalVertices * 3);
  const uvs = new Float32Array(totalVertices * 2);
  const indices = new Uint32Array(totalIndices);

  let vertexOffset = 0;
  let indexOffset = 0;
  for (const geo of geometries) {
    const pos = geo.getAttribute('position');
    const norm = geo.getAttribute('normal');
    const uv = geo.getAttribute('uv');
    const idx = geo.getIndex();
    if (pos === undefined || norm === undefined || uv === undefined || idx === null) {
      continue;
    }
    positions.set(pos.array as ArrayLike<number>, vertexOffset * 3);
    normals.set(norm.array as ArrayLike<number>, vertexOffset * 3);
    uvs.set(uv.array as ArrayLike<number>, vertexOffset * 2);
    const idxArray = idx.array;
    for (let i = 0; i < idx.count; i += 1) {
      indices[indexOffset + i] = (idxArray[i] ?? 0) + vertexOffset;
    }
    vertexOffset += pos.count;
    indexOffset += idx.count;
    geo.dispose();
  }

  const merged = new BufferGeometry();
  merged.setAttribute('position', new Float32BufferAttribute(positions, 3));
  merged.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  merged.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  merged.setIndex(new Uint32BufferAttribute(indices, 1));
  merged.computeBoundingSphere();
  return merged;
}

function freezeStaticGroup(group: Group): Group {
  group.updateMatrixWorld(true);
  group.traverse((child) => {
    child.matrixAutoUpdate = false;
  });
  return group;
}

function makeArenaGeometry(map: ArenaMap, maxAnisotropy = 4): Group {
  const group = new Group();
  const isDust2 = map.id === 'de_dust2';
  const dust2Textures = isDust2 ? createDust2Textures(maxAnisotropy) : null;
  const edgeMaterial = new LineBasicMaterial({
    color: new Color(map.theme.accent),
    transparent: true,
    opacity: map.id === 'fy_sand' ? 0.08 : 0.16,
  });
  const materials = new Map<string, MeshStandardMaterial>();
  const buckets = new Map<
    string,
    {
      material: MeshStandardMaterial;
      castShadow: boolean;
      geometries: BufferGeometry[];
    }
  >();

  for (const box of map.boxes) {
    if (box.kind === 'ladder') {
      const railMaterial = new MeshStandardMaterial({
        color: new Color(box.color),
        roughness: 0.62,
        metalness: 0.35,
      });
      const ladder = new Group();
      const cx = (box.min.x + box.max.x) / 2;
      const cz = (box.min.z + box.max.z) / 2;
      const width = box.max.z - box.min.z;
      const height = box.max.y - box.min.y;
      for (const side of [-1, 1] as const) {
        const rail = new Mesh(new BoxGeometry(0.06, height, 0.06), railMaterial);
        rail.position.set(cx, (box.min.y + box.max.y) / 2, cz + side * (width / 2 - 0.05));
        ladder.add(rail);
      }
      const rungCount = Math.max(3, Math.floor(height / 0.34));
      for (let rung = 1; rung <= rungCount; rung += 1) {
        const bar = new Mesh(new BoxGeometry(0.06, 0.055, width - 0.1), railMaterial);
        bar.position.set(cx, box.min.y + (height * rung) / (rungCount + 1), cz);
        ladder.add(bar);
      }
      group.add(ladder);
      continue;
    }
    let renderMinX = box.min.x;
    let renderMaxX = box.max.x;
    const renderMinY = box.min.y;
    let renderMaxY = box.max.y;
    let renderMinZ = box.min.z;
    let renderMaxZ = box.max.z;
    let slopeAxis: 'z' | 'x' | null = null;
    let slopeStart = 0;
    let slopeEnd = 0;
    let slopeYStart = 0;
    let slopeYEnd = 0;

    if (box.id.startsWith('slopeZ:') || box.id.startsWith('slopeX:')) {
      const parts = box.id.split(':');
      const sliceIndex = Number(parts[6]);
      if (sliceIndex > 0) {
        continue;
      }
      slopeAxis = box.id.startsWith('slopeZ:') ? 'z' : 'x';
      slopeStart = Number(parts[2]);
      slopeEnd = Number(parts[3]);
      slopeYStart = Number(parts[4]);
      slopeYEnd = Number(parts[5]);
      renderMaxY = Math.max(slopeYStart, slopeYEnd);
      if (slopeAxis === 'z') {
        renderMinZ = Math.min(slopeStart, slopeEnd);
        renderMaxZ = Math.max(slopeStart, slopeEnd);
      } else {
        renderMinX = Math.min(slopeStart, slopeEnd);
        renderMaxX = Math.max(slopeStart, slopeEnd);
      }
    }

    const size = {
      x: renderMaxX - renderMinX,
      y: renderMaxY - renderMinY,
      z: renderMaxZ - renderMinZ,
    };
    const cx = (renderMinX + renderMaxX) / 2;
    const cy = (renderMinY + renderMaxY) / 2;
    const cz = (renderMinZ + renderMaxZ) / 2;

    const geometry = new BoxGeometry(size.x, size.y, size.z);
    if (slopeAxis !== null) {
      const pos = geometry.attributes.position;
      if (pos !== undefined) {
        for (let i = 0; i < pos.count; i += 1) {
          const vy = pos.getY(i);
          if (vy > 0) {
            const worldCoord = slopeAxis === 'z' ? cz + pos.getZ(i) : cx + pos.getX(i);
            const t = Math.max(
              0,
              Math.min(1, (worldCoord - slopeStart) / (slopeEnd - slopeStart || 1)),
            );
            const targetWorldY = slopeYStart + t * (slopeYEnd - slopeYStart);
            pos.setY(i, targetWorldY - cy);
          }
        }
        pos.needsUpdate = true;
        geometry.computeVertexNormals();
      }
    }
    if (isDust2) {
      const tileMeters =
        box.kind === 'crate'
          ? 1.8
          : box.kind === 'floor' || box.kind === 'platform' || box.kind === 'ramp'
            ? 3.6
            : 3.2;
      scaleBoxUVsWorldSpace(geometry, size.x, size.y, size.z, tileMeters);
    }
    const materialKey = `${box.kind}:${box.color}`;
    let material = materials.get(materialKey);
    if (material === undefined) {
      const surface = KIND_SURFACE[box.kind];
      const tex =
        dust2Textures === null
          ? null
          : box.kind === 'floor' || box.kind === 'platform' || box.kind === 'ramp'
            ? dust2Textures.floor
            : box.kind === 'crate'
              ? dust2Textures.crate
              : box.kind === 'roof'
                ? dust2Textures.roof
                : dust2Textures.wall;
      material = new MeshStandardMaterial({
        color: new Color(box.color),
        map: tex,
        roughness: surface.roughness,
        metalness: surface.metalness,
      });
      materials.set(materialKey, material);
    }

    geometry.translate(cx, cy, cz);
    if (!isDust2 && box.kind !== 'floor') {
      const edges = new LineSegments(new EdgesGeometry(geometry), edgeMaterial);
      group.add(edges);
    }

    const castShadow = box.kind !== 'floor';
    const bucketKey = `${materialKey}:${castShadow ? 1 : 0}`;
    let bucket = buckets.get(bucketKey);
    if (bucket === undefined) {
      bucket = { material, castShadow, geometries: [] };
      buckets.set(bucketKey, bucket);
    }
    bucket.geometries.push(geometry);
  }

  for (const bucket of buckets.values()) {
    const mergedGeometry = mergeIndexedGeometries(bucket.geometries);
    const mesh = new Mesh(mergedGeometry, bucket.material);
    mesh.castShadow = bucket.castShadow;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  return freezeStaticGroup(group);
}

function makeTeamStrips(map: ArenaMap): Group {
  const group = new Group();
  const alphaSpawns = getSpawnsForTeam(map, 'alpha');
  const bravoSpawns = getSpawnsForTeam(map, 'bravo');
  if (alphaSpawns.length === 0 || bravoSpawns.length === 0) {
    return group;
  }

  const alpha = alphaSpawns[0];
  const bravo = bravoSpawns[0];
  if (alpha === undefined || bravo === undefined) {
    return group;
  }

  // In bomb/buy mode, alpha starts on T side (orange) and bravo starts on CT side (blue)
  const alphaColor = map.mode === 'buy' ? 0xfb923c : 0x38bdf8;
  const bravoColor = map.mode === 'buy' ? 0x38bdf8 : 0xfb923c;
  const alphaMaterial = new MeshBasicMaterial({ color: alphaColor, toneMapped: false });
  const bravoMaterial = new MeshBasicMaterial({ color: bravoColor, toneMapped: false });
  const northSouth = Math.abs(bravo.position.z - alpha.position.z) > 15;
  const alphaLen = map.id === 'fy_sand' ? 22 : map.id === 'de_dust2' ? 8.0 : 10;
  const bravoLen = map.id === 'fy_sand' ? 22 : map.id === 'de_dust2' ? 4.2 : 10;

  const avgX = (spawns: typeof alphaSpawns): number =>
    spawns.reduce((sum, s) => sum + s.position.x, 0) / spawns.length;
  const avgZ = (spawns: typeof alphaSpawns): number =>
    spawns.reduce((sum, s) => sum + s.position.z, 0) / spawns.length;

  if (!northSouth) {
    const alphaStrip = new Mesh(new BoxGeometry(0.07, 0.025, alphaLen), alphaMaterial);
    alphaStrip.position.set(alpha.position.x, alpha.position.y + 0.03, 0);
    group.add(alphaStrip);
    const bravoStrip = new Mesh(new BoxGeometry(0.07, 0.025, bravoLen), bravoMaterial);
    bravoStrip.position.set(bravo.position.x, bravo.position.y + 0.03, 0);
    group.add(bravoStrip);
  } else {
    const alphaStrip = new Mesh(new BoxGeometry(alphaLen, 0.025, 0.07), alphaMaterial);
    alphaStrip.position.set(avgX(alphaSpawns), alpha.position.y + 0.03, avgZ(alphaSpawns));
    group.add(alphaStrip);
    const bravoStrip = new Mesh(new BoxGeometry(bravoLen, 0.025, 0.07), bravoMaterial);
    bravoStrip.position.set(avgX(bravoSpawns), bravo.position.y + 0.03, avgZ(bravoSpawns));
    group.add(bravoStrip);
  }

  return group;
}

function makePickupHalos(map: ArenaMap): Group {
  const group = new Group();
  const addHalo = (x: number, y: number, z: number, color: number, radius: number): void => {
    const material = new MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.42,
      blending: AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    const halo = new Mesh(new RingGeometry(radius * 0.72, radius, 32), material);
    halo.rotation.x = -Math.PI / 2;
    halo.position.set(x, y, z);
    group.add(halo);
  };

  for (const spawn of map.weaponSpawns) {
    addHalo(
      spawn.position.x,
      spawn.position.y - 0.88,
      spawn.position.z,
      getWeapon(spawn.weapon).color,
      0.5,
    );
  }
  for (const spawn of map.armorSpawns) {
    addHalo(spawn.position.x, spawn.position.y - 0.88, spawn.position.z, 0x60a5fa, 0.58);
  }

  return group;
}

function makeSiteLetterMesh(letter: 'A' | 'B', material: MeshBasicMaterial): Group {
  const glyph = new Group();
  const bar = (w: number, h: number, x: number, z: number): void => {
    const m = new Mesh(new BoxGeometry(w, 0.03, h), material);
    m.position.set(x, 0, z);
    glyph.add(m);
  };
  if (letter === 'A') {
    bar(0.28, 1.8, -0.52, 0);
    bar(0.28, 1.8, 0.52, 0);
    bar(1.32, 0.28, 0, -0.76);
    bar(1.04, 0.26, 0, 0.08);
  } else {
    bar(0.28, 1.8, -0.52, 0);
    bar(1.16, 0.26, -0.04, -0.77);
    bar(1.12, 0.24, -0.06, 0);
    bar(1.16, 0.26, -0.04, 0.77);
    bar(0.26, 0.76, 0.48, -0.38);
    bar(0.26, 0.76, 0.48, 0.38);
  }
  return glyph;
}

function makeBombSites(map: ArenaMap): Group {
  const group = new Group();
  for (const site of map.bombSites) {
    const color = site.id === 'A' ? 0xf59e0b : 0xf43f5e;
    const width = site.max.x - site.min.x;
    const depth = site.max.z - site.min.z;
    const cx = (site.min.x + site.max.x) / 2;
    const cz = (site.min.z + site.max.z) / 2;
    const floorY = site.center.y;

    const padMaterial = new MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.1,
      blending: AdditiveBlending,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      toneMapped: false,
    });
    const pad = new Mesh(new BoxGeometry(width, 0.015, depth), padMaterial);
    pad.position.set(cx, floorY + 0.02, cz);
    group.add(pad);

    const borderMaterial = new MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.62,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
      toneMapped: false,
    });
    const thickness = 0.08;
    const north = new Mesh(new BoxGeometry(width, 0.025, thickness), borderMaterial);
    north.position.set(cx, floorY + 0.035, site.min.z);
    const south = north.clone();
    south.position.set(cx, floorY + 0.035, site.max.z);
    const west = new Mesh(new BoxGeometry(thickness, 0.025, depth), borderMaterial);
    west.position.set(site.min.x, floorY + 0.035, cz);
    const east = west.clone();
    east.position.set(site.max.x, floorY + 0.035, cz);
    group.add(north, south, west, east);

    const letterMaterial = new MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.78,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
      toneMapped: false,
    });
    const glyphNorth = makeSiteLetterMesh(site.id, letterMaterial);
    glyphNorth.position.set(cx, floorY + 0.05, cz - 1.8);
    const glyphSouth = makeSiteLetterMesh(site.id, letterMaterial);
    glyphSouth.position.set(cx, floorY + 0.05, cz + 1.8);
    group.add(glyphNorth, glyphSouth);

    const signGlyph = makeSiteLetterMesh(site.id, letterMaterial);
    signGlyph.rotation.x = Math.PI / 2;
    signGlyph.rotation.z = site.id === 'A' ? -Math.PI / 2 : Math.PI / 2;
    signGlyph.position.set(cx, floorY + 3.4, cz);
    group.add(signGlyph);
  }
  return group;
}

function makeSkyline(): Group {
  const group = new Group();
  const towerMaterial = new MeshStandardMaterial({
    color: 0x08111d,
    emissive: new Color(0x0b2433),
    emissiveIntensity: 0.75,
    roughness: 0.86,
    metalness: 0.2,
  });
  const windowMaterial = new MeshBasicMaterial({
    color: 0x4cc9e8,
    transparent: true,
    opacity: 0.42,
    toneMapped: false,
  });

  const towers: ReadonlyArray<readonly [number, number, number, number]> = [
    [-28, -26, 8, 14],
    [-12, -31, 6, 20],
    [10, -29, 7, 11],
    [28, -22, 9, 18],
    [30, 8, 7, 12],
    [25, 28, 10, 21],
    [8, 31, 6, 16],
    [-14, 30, 8, 12],
    [-31, 12, 7, 17],
    [-30, 28, 9, 9],
  ];

  for (const [x, z, width, height] of towers) {
    const tower = new Mesh(new BoxGeometry(width, height, width), towerMaterial);
    tower.position.set(x, height / 2 - 0.4, z);
    group.add(tower);

    for (let floor = 1; floor < height - 1; floor += 3) {
      const window = new Mesh(new BoxGeometry(width * 0.66, 0.08, 0.05), windowMaterial);
      window.position.set(x, floor, z + width / 2 + 0.03);
      group.add(window);
    }
  }

  return group;
}

function makeDesertHills(): Group {
  const group = new Group();
  const hillMaterial = new MeshStandardMaterial({
    color: 0xb98b58,
    roughness: 1,
    metalness: 0,
  });
  const farMaterial = new MeshStandardMaterial({
    color: 0xc9a674,
    roughness: 1,
    metalness: 0,
  });
  const hills: ReadonlyArray<readonly [number, number, number, number, number]> = [
    [-48, -62, 18, 7, 12],
    [-18, -72, 24, 9, 15],
    [22, -68, 20, 8, 13],
    [56, -52, 22, 10, 14],
    [68, 4, 18, 8, 12],
    [54, 54, 25, 9, 16],
    [16, 70, 20, 7, 13],
    [-26, 66, 24, 8, 15],
    [-62, 38, 20, 9, 13],
    [-66, -18, 18, 7, 12],
  ];

  for (const [x, z, width, height, depth] of hills) {
    const hill = new Mesh(new SphereGeometry(1, 16, 8), farMaterial);
    hill.scale.set(width, height, depth);
    hill.position.set(x, height * 0.38 - 1.8, z);
    group.add(hill);
  }

  // A warm sun disc sits above the horizon and gives the arena a clear focal point.
  const sun = new Mesh(
    new CircleGeometry(7, 32),
    new MeshBasicMaterial({ color: 0xfff2c8, toneMapped: false, fog: false }),
  );
  sun.position.set(-52, 48, -86);
  sun.lookAt(0, 8, 0);
  group.add(sun);

  const innerDune = new Mesh(new SphereGeometry(1, 18, 8), hillMaterial);
  innerDune.scale.set(32, 4, 18);
  innerDune.position.set(-8, -2.4, -38);
  group.add(innerDune);

  return group;
}

function makePalmTree(
  trunkMaterial: MeshStandardMaterial,
  frondMaterial: MeshStandardMaterial,
): Group {
  const palm = new Group();
  const segments = 5;
  for (let i = 0; i < segments; i += 1) {
    const rBottom = 0.28 - i * 0.03;
    const rTop = 0.25 - i * 0.03;
    const seg = new Mesh(new CylinderGeometry(rTop, rBottom, 1.35, 8), trunkMaterial);
    seg.position.set(i * 0.08, 0.65 + i * 1.28, 0);
    seg.rotation.z = -0.05 * i;
    palm.add(seg);
  }
  const crownX = (segments - 1) * 0.08;
  const crownY = 0.65 + (segments - 1) * 1.28 + 0.65;
  const fronds = 7;
  for (let f = 0; f < fronds; f += 1) {
    const angle = (f / fronds) * Math.PI * 2;
    const leafGroup = new Group();
    leafGroup.position.set(crownX, crownY, 0);
    leafGroup.rotation.y = angle;
    const leaf = new Mesh(new BoxGeometry(2.3, 0.06, 0.48), frondMaterial);
    leaf.position.set(1.1, -0.18, 0);
    leaf.rotation.z = -0.32;
    leafGroup.add(leaf);
    palm.add(leafGroup);
  }
  return palm;
}

function makeDust2Environment(): Group {
  const group = new Group();

  // Distant Atlas mountain ridges & dunes
  const duneMat = new MeshStandardMaterial({ color: 0xc8a372, roughness: 0.98, metalness: 0 });
  const ridgeMat = new MeshStandardMaterial({ color: 0xb0895a, roughness: 0.96, metalness: 0 });
  const ridges: ReadonlyArray<readonly [number, number, number, number, number]> = [
    [-70, -88, 32, 14, 20],
    [-16, -96, 38, 17, 22],
    [42, -90, 34, 15, 20],
    [88, -45, 30, 14, 22],
    [92, 24, 34, 16, 22],
    [68, 84, 36, 15, 24],
    [8, 94, 38, 14, 22],
    [-58, 86, 34, 16, 22],
    [-92, 22, 30, 13, 20],
    [-88, -36, 32, 15, 20],
  ];
  for (const [x, z, w, h, d] of ridges) {
    const mesh = new Mesh(new SphereGeometry(1, 16, 8), (x + z) % 2 === 0 ? duneMat : ridgeMat);
    mesh.scale.set(w, h, d);
    mesh.position.set(x, h * 0.35 - 2.2, z);
    group.add(mesh);
  }

  // Bright desert sun with soft halo
  const sun = new Mesh(
    new CircleGeometry(8.5, 32),
    new MeshBasicMaterial({ color: 0xfff7dc, toneMapped: false, fog: false }),
  );
  sun.position.set(58, 62, -92);
  sun.lookAt(0, 6, 0);
  group.add(sun);

  // Moroccan Kasbah skyline buildings & Hotel Aurore upper storeys directly over internal blocks
  const kasbahWallMat = new MeshStandardMaterial({
    color: 0xdcc096,
    roughness: 0.88,
    metalness: 0.04,
  });
  const kasbahTerracottaMat = new MeshStandardMaterial({
    color: 0xb86b43,
    roughness: 0.85,
    metalness: 0.05,
  });
  const domeMat = new MeshStandardMaterial({
    color: 0xe6b85c,
    roughness: 0.45,
    metalness: 0.28,
  });
  const windowDarkMat = new MeshBasicMaterial({ color: 0x261c14 });

  // Upper storeys sitting directly on top of the solid internal building blocks (y = 7.65+)
  const innerUpperBlocks: ReadonlyArray<readonly [number, number, number, number, number, number]> =
    [
      [-9.25, 7.65, 19.75, 10.6, 3.8, 9.6], // West-Mid building upper floor
      [5.75, 7.65, 19.75, 7.8, 3.6, 9.6], // SE Suicide building upper floor
      [9.0, 7.65, 5.25, 8.2, 4.0, 8.8], // Central Mid building upper floor
      [18.5, 7.65, -10.5, 11.2, 4.2, 11.2], // Long Corner building upper floor
      [18.25, 8.25, -30.75, 8.0, 4.4, 4.0], // Hotel Aurore behind Bombsite A
      [-20.1, 7.65, -7.0, 9.4, 3.8, 5.4], // B Tunnel citadel upper tower
    ];
  for (const [cx, baseY, cz, w, h, d] of innerUpperBlocks) {
    const upper = new Mesh(new BoxGeometry(w, h, d), kasbahWallMat);
    upper.position.set(cx, baseY + h / 2, cz);
    group.add(upper);
    const cornice = new Mesh(new BoxGeometry(w + 0.35, 0.38, d + 0.35), kasbahTerracottaMat);
    cornice.position.set(cx, baseY + h + 0.2, cz);
    group.add(cornice);
  }

  // Outer perimeter buildings & domed minarets
  const buildings: ReadonlyArray<readonly [number, number, number, number, number, boolean]> = [
    [-44, -40, 12, 15, 12, true],
    [-20, -43, 14, 13, 10, false],
    [6, -44, 16, 14, 11, false],
    [32, -43, 14, 16, 12, true],
    [45, -18, 12, 14, 14, false],
    [45, 14, 12, 15, 14, false],
    [38, 43, 15, 13, 12, false],
    [0, 44, 18, 15, 11, true],
    [-34, 43, 14, 14, 12, false],
    [-45, 10, 11, 13, 14, false],
  ];

  for (const [x, z, w, h, d, hasDome] of buildings) {
    const body = new Mesh(new BoxGeometry(w, h, d), kasbahWallMat);
    body.position.set(x, h / 2 - 0.5, z);
    group.add(body);

    const cornice = new Mesh(new BoxGeometry(w + 0.5, 0.55, d + 0.5), kasbahTerracottaMat);
    cornice.position.set(x, h + 0.28, z);
    group.add(cornice);

    for (const offset of [-w * 0.24, w * 0.24]) {
      const win = new Mesh(new BoxGeometry(1.1, 1.8, d + 0.16), windowDarkMat);
      win.position.set(x + offset, h * 0.62, z);
      group.add(win);
    }

    if (hasDome) {
      const drum = new Mesh(new CylinderGeometry(2.6, 2.8, 2.2, 16), kasbahWallMat);
      drum.position.set(x, h + 1.6, z);
      group.add(drum);
      const dome = new Mesh(
        new SphereGeometry(2.65, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2),
        domeMat,
      );
      dome.position.set(x, h + 2.7, z);
      group.add(dome);
      const spire = new Mesh(new CylinderGeometry(0.05, 0.14, 1.6, 8), domeMat);
      spire.position.set(x, h + 5.9, z);
      group.add(spire);
    }
  }

  // Backdrop palm trees outside play lanes & wooden utility pole ONLY at ПАЛЬМА (Top Mid corner)
  const trunkMat = new MeshStandardMaterial({ color: 0x7d5838, roughness: 0.92, metalness: 0.02 });
  const frondMat = new MeshStandardMaterial({ color: 0x4d7c3f, roughness: 0.78, metalness: 0.04 });
  const palmSpots: ReadonlyArray<readonly [number, number, number, number]> = [
    [20.8, 1.2, 29.8, 1.2], // Площадь (Outside Long backdrop)
    [-29.8, 1.65, -29.8, -0.8], // Bombsite B far corner backdrop
  ];
  for (const [x, y, z, rot] of palmSpots) {
    const palm = makePalmTree(trunkMat, frondMat);
    palm.position.set(x, y, z);
    palm.rotation.y = rot;
    group.add(palm);
  }

  // Wooden utility pole & crossbar at ПАЛЬМА (Top Mid corner at start of Parapet fence, no palm tree!)
  const pole = new Mesh(new CylinderGeometry(0.11, 0.15, 7.2, 10), trunkMat);
  pole.position.set(1.7, 4.8, 9.45);
  group.add(pole);
  const crossbar = new Mesh(new BoxGeometry(1.6, 0.1, 0.1), trunkMat);
  crossbar.position.set(1.7, 8.1, 9.45);
  group.add(crossbar);
  const barrelMat = new MeshStandardMaterial({ color: 0x9b6446, roughness: 0.72, metalness: 0.35 });
  const barrel1 = new Mesh(new CylinderGeometry(0.28, 0.28, 0.88, 12), barrelMat);
  barrel1.position.set(1.7, 1.64, 9.85);
  group.add(barrel1);
  const barrel2 = new Mesh(new CylinderGeometry(0.28, 0.28, 0.88, 12), barrelMat);
  barrel2.position.set(2.25, 1.64, 9.6);
  group.add(barrel2);

  // Red spray-painted target rings on Bombsite A (19.6, 2.4, -24.2) and Bombsite B (-21.8, 1.2, -19.5)
  const sprayMat = new MeshBasicMaterial({
    color: 0xd93829,
    transparent: true,
    opacity: 0.85,
    polygonOffset: true,
    polygonOffsetFactor: -5,
    polygonOffsetUnits: -5,
    toneMapped: false,
  });
  const ringA = new Mesh(new RingGeometry(1.15, 1.38, 32), sprayMat);
  ringA.rotation.x = -Math.PI / 2;
  ringA.position.set(19.6, 2.43, -25.6);
  group.add(ringA);

  const ringB = new Mesh(new RingGeometry(1.15, 1.38, 32), sprayMat);
  ringB.rotation.x = -Math.PI / 2;
  ringB.position.set(-22.8, 1.23, -19.5);
  group.add(ringB);

  // Warm interior lantern fixtures inside Upper B Tunnels, Lower B Tunnels, Банка & CT Underpass
  const lanternBulbMat = new MeshBasicMaterial({ color: 0xffdf9e, toneMapped: false });
  const lanternSpots: ReadonlyArray<readonly [number, number, number, boolean]> = [
    [-22.5, 4.65, 2.0, true], // Upper B Tunnels center (with point light)
    [-26.8, 4.25, -7.0, false], // B Tunnel exit corridor
    [-9.5, 3.65, 0.2, false], // Lower B Tunnels
    [17.8, 5.25, 7.2, true], // Банка (Long House Double Doors, with point light)
    [9.8, 2.1, -19.2, false], // КТ (CT Spawn Underpass under Short bridge)
    [-1.0, 2.95, 19.5, false], // Suicide covered alley ceiling light
  ];
  for (const [x, y, z, emitLight] of lanternSpots) {
    const fixture = new Mesh(new BoxGeometry(0.45, 0.1, 0.45), lanternBulbMat);
    fixture.position.set(x, y, z);
    group.add(fixture);
    if (emitLight) {
      const light = new PointLight(0xffcb7d, 22, 24, 1.6);
      light.position.set(x, y - 0.25, z);
      group.add(light);
    }
  }

  return freezeStaticGroup(group);
}

function makeDust(map: ArenaMap): Points {
  const positions: number[] = [];
  const radius = Math.max(map.size, map.sizeZ) / 2;
  for (let index = 0; index < 140; index += 1) {
    positions.push(
      (Math.random() - 0.5) * radius * 2,
      0.4 + Math.random() * 6,
      (Math.random() - 0.5) * radius * 2,
    );
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  const material = new PointsMaterial({
    color: new Color(map.theme.accent),
    size: map.id === 'fy_sand' ? 0.06 : 0.045,
    transparent: true,
    opacity: map.id === 'fy_sand' ? 0.24 : 0.35,
    depthWrite: false,
    blending: AdditiveBlending,
  });
  return new Points(geometry, material);
}

function makeStars(): Points {
  const positions: number[] = [];
  for (let index = 0; index < 180; index += 1) {
    const angle = Math.random() * Math.PI * 2;
    const radius = 18 + Math.random() * 45;
    positions.push(Math.cos(angle) * radius, 10 + Math.random() * 30, Math.sin(angle) * radius);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  const material = new PointsMaterial({
    color: 0xbfe8ff,
    size: 0.12,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    blending: AdditiveBlending,
  });
  return new Points(geometry, material);
}

function makeBeacon(x: number, z: number, color: number, height: number, baseY = 0): Group {
  const group = new Group();
  const beamMaterial = new MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.12,
    blending: AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
  const beam = new Mesh(new CylinderGeometry(0.1, 0.5, height, 16, 1, true), beamMaterial);
  beam.position.set(x, baseY + height / 2, z);
  group.add(beam);
  return group;
}

export function createArenaScene(container: HTMLElement, map: ArenaMap): ArenaScene {
  const scene = new Scene();
  const isDust2 = map.id === 'de_dust2';
  const desert = map.id === 'fy_sand' || isDust2;
  scene.background = new Color(map.theme.sky);
  scene.fog = new Fog(map.theme.fog, map.theme.fogNear, map.theme.fogFar);

  const camera = new PerspectiveCamera(
    78,
    window.innerWidth / window.innerHeight,
    isDust2 ? 0.12 : 0.05,
    240,
  );
  camera.rotation.order = 'YXZ';
  camera.position.set(0, 8, 20);

  const renderer = new WebGLRenderer({
    antialias: true,
    powerPreference: 'high-performance',
    alpha: false,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = isDust2 ? 1.08 : desert ? 1.02 : 1.16;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;
  // Static geometry dominates the scene. Refreshing the shadow map a few
  // times per second is enough for moving players and saves a lot of GPU time.
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;
  renderer.domElement.className = 'game-canvas';
  container.appendChild(renderer.domElement);

  let currentMap = map;
  let currentDust: Points;
  const mapGroup = new Group();
  mapGroup.name = 'map-root';
  scene.add(mapGroup);

  const populateMap = (targetMap: ArenaMap): void => {
    const isTargetDust2 = targetMap.id === 'de_dust2';
    const isTargetDesert = targetMap.id === 'fy_sand' || isTargetDust2;
    scene.background = new Color(targetMap.theme.sky);
    scene.fog = new Fog(targetMap.theme.fog, targetMap.theme.fogNear, targetMap.theme.fogFar);
    camera.near = isTargetDust2 ? 0.12 : 0.05;
    camera.updateProjectionMatrix();
    renderer.toneMappingExposure = isTargetDust2 ? 1.08 : isTargetDesert ? 1.02 : 1.16;

    const hemi = new HemisphereLight(
      isTargetDust2 ? 0xdbeeff : isTargetDesert ? 0xcfe7f2 : 0x9ecbff,
      isTargetDust2 ? 0x9c7448 : isTargetDesert ? 0x7d5c3b : 0x05070c,
      isTargetDust2 ? 1.62 : isTargetDesert ? 1.5 : 1.35,
    );
    mapGroup.add(hemi);

    const ambient = new AmbientLight(targetMap.theme.ambient, isTargetDust2 ? 0.38 : isTargetDesert ? 0.3 : 0.2);
    mapGroup.add(ambient);

    const keyLight = new DirectionalLight(targetMap.theme.sun, isTargetDust2 ? 2.45 : isTargetDesert ? 2.3 : 2.1);
    keyLight.position.set(
      isTargetDust2 ? 28 : isTargetDesert ? 22 : 14,
      isTargetDust2 ? 38 : 28,
      isTargetDust2 ? -26 : isTargetDesert ? -18 : 9,
    );
    keyLight.castShadow = true;
    const shadowMapRes = 1024;
    const shadowBounds = isTargetDust2 ? 44 : 46;
    keyLight.shadow.mapSize.set(shadowMapRes, shadowMapRes);
    keyLight.shadow.camera.left = -shadowBounds;
    keyLight.shadow.camera.right = shadowBounds;
    keyLight.shadow.camera.top = shadowBounds;
    keyLight.shadow.camera.bottom = -shadowBounds;
    keyLight.shadow.camera.near = 1;
    keyLight.shadow.camera.far = isTargetDust2 ? 115 : 90;
    keyLight.shadow.bias = -0.00035;
    mapGroup.add(keyLight);

    const alphaSpawn = getSpawnsForTeam(targetMap, 'alpha')[0];
    const bravoSpawn = getSpawnsForTeam(targetMap, 'bravo')[0];
    const alphaColor = targetMap.mode === 'buy' ? 0xfb923c : 0x38bdf8;
    const bravoColor = targetMap.mode === 'buy' ? 0x38bdf8 : 0xfb923c;
    if (!isTargetDust2 && alphaSpawn !== undefined) {
      const alphaLight = new PointLight(alphaColor, isTargetDesert ? 18 : 32, 30, 2);
      alphaLight.position.set(
        alphaSpawn.position.x + 2,
        alphaSpawn.position.y + 4.5,
        alphaSpawn.position.z,
      );
      mapGroup.add(alphaLight);
    }
    if (!isTargetDust2 && bravoSpawn !== undefined) {
      const bravoLight = new PointLight(bravoColor, isTargetDesert ? 18 : 32, 30, 2);
      bravoLight.position.set(
        bravoSpawn.position.x - 2,
        bravoSpawn.position.y + 4.5,
        bravoSpawn.position.z,
      );
      mapGroup.add(bravoLight);
    }

    const maxAnisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    mapGroup.add(makeArenaGeometry(targetMap, maxAnisotropy));
    mapGroup.add(freezeStaticGroup(makeTeamStrips(targetMap)));
    mapGroup.add(freezeStaticGroup(makePickupHalos(targetMap)));
    mapGroup.add(freezeStaticGroup(makeBombSites(targetMap)));
    if (isTargetDust2) {
      mapGroup.add(makeDust2Environment());
    } else if (isTargetDesert) {
      mapGroup.add(freezeStaticGroup(makeDesertHills()));
    } else {
      mapGroup.add(freezeStaticGroup(makeSkyline()));
    }

    if (alphaSpawn !== undefined) {
      mapGroup.add(
        makeBeacon(
          alphaSpawn.position.x,
          alphaSpawn.position.z,
          alphaColor,
          isTargetDesert ? 4.5 : 7,
          alphaSpawn.position.y,
        ),
      );
    }
    if (bravoSpawn !== undefined) {
      mapGroup.add(
        makeBeacon(
          bravoSpawn.position.x,
          bravoSpawn.position.z,
          bravoColor,
          isTargetDesert ? 4.5 : 7,
          bravoSpawn.position.y,
        ),
      );
    }

    currentDust = makeDust(targetMap);
    mapGroup.add(currentDust);
    if (!isTargetDesert) {
      mapGroup.add(makeStars());
    }
  };

  populateMap(map);

  const switchMap = (nextMap: ArenaMap): void => {
    if (nextMap.id === currentMap.id) {
      return;
    }
    currentMap = nextMap;
    while (mapGroup.children.length > 0) {
      const child = mapGroup.children[0];
      if (child !== undefined) {
        mapGroup.remove(child);
        disposeObject3D(child);
      }
    }
    populateMap(nextMap);
    renderer.shadowMap.needsUpdate = true;
  };

  const resize = (): void => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.setSize(window.innerWidth, window.innerHeight);
  };
  window.addEventListener('resize', resize);

  let disposed = false;
  let shadowFrame = 0;

  return {
    scene,
    camera,
    renderer,
    switchMap,
    render: () => {
      if (currentDust !== undefined) {
        currentDust.rotation.y += 0.00018;
      }
      shadowFrame += 1;
      if (shadowFrame % 8 === 0) {
        renderer.shadowMap.needsUpdate = true;
      }
      renderer.render(scene, camera);
    },
    resize,
    dispose: () => {
      if (disposed) {
        return;
      }
      disposed = true;
      window.removeEventListener('resize', resize);
      disposeObject3D(scene);
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
