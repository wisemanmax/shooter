/**
 * Type augmentations for three-mesh-bvh patched methods on Three.js prototypes.
 */
import { MeshBVH } from 'three-mesh-bvh';

declare module 'three' {
  interface BufferGeometry {
    boundsTree?: MeshBVH;
    computeBoundsTree(options?: Record<string, unknown>): void;
    disposeBoundsTree(): void;
  }
}
