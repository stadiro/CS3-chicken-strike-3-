import type { Material, Object3D, Texture } from 'three';

function disposeMaterial(material: Material): void {
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
      geometry?: { dispose(): void };
      material?: Material | Material[];
    };
    mesh.geometry?.dispose();
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
