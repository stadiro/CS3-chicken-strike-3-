import type { Material, Object3D, Texture } from 'three';

/**
 * Resources flagged with `userData.shared = true` are owned by a module-level
 * cache (e.g. the weapon material palette) and must outlive individual objects.
 */
function isShared(resource: { userData?: Record<string, unknown> }): boolean {
  return resource.userData?.shared === true;
}

function disposeMaterial(material: Material): void {
  if (isShared(material)) {
    return;
  }
  const record = material as Material & Record<string, unknown>;
  for (const value of Object.values(record)) {
    if (value instanceof Object && 'isTexture' in value && value.isTexture === true) {
      (value as Texture).dispose();
    }
  }
  material.dispose();
}

export function disposeObject3D(root: Object3D): void {
  root.traverse((object) => {
    const mesh = object as Object3D & {
      geometry?: { dispose(): void; userData?: Record<string, unknown> };
      material?: Material | Material[];
    };
    if (mesh.geometry !== undefined && !isShared(mesh.geometry)) {
      mesh.geometry.dispose();
    }
    if (Array.isArray(mesh.material)) {
      for (const material of mesh.material) {
        disposeMaterial(material);
      }
    } else if (mesh.material !== undefined) {
      disposeMaterial(mesh.material);
    }
  });
  root.removeFromParent();
}
