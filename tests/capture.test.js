import { describe, it, expect } from 'vitest';
import { extractMeshes, findSceneInGraph } from '../src/main/capture.js';

// Minimal fake Three.js objects (duck-typed).
function fakeMesh(name, positions, opts = {}) {
  const attributes = { position: { array: Float32Array.from(positions), itemSize: 3, count: positions.length / 3 } };
  if (opts.normals) attributes.normal = { array: Float32Array.from(opts.normals), itemSize: 3, count: opts.normals.length / 3 };
  if (opts.uvs) attributes.uv = { array: Float32Array.from(opts.uvs), itemSize: 2, count: opts.uvs.length / 2 };
  return {
    isMesh: true, isObject3D: true, name, visible: opts.visible !== false, children: [],
    matrixWorld: { elements: opts.matrix || [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1] },
    geometry: { isBufferGeometry: true, attributes, index: opts.indices ? { array: Uint32Array.from(opts.indices) } : null },
  };
}
function fakeScene(children) { return { isScene: true, isObject3D: true, name: 'Scene', children }; }

describe('extractMeshes', () => {
  it('extracts a single mesh with positions, uvs and indices', () => {
    const scene = fakeScene([fakeMesh('Model', [0,0,0,1,0,0,0,1,0], { uvs:[0,0,1,0,0,1], indices:[0,1,2] })]);
    const out = extractMeshes(scene);
    expect(out.length).toBe(1);
    expect(Array.from(out[0].positions)).toEqual([0,0,0,1,0,0,0,1,0]);
    expect(Array.from(out[0].uvs)).toEqual([0,0,1,0,0,1]);
    expect(Array.from(out[0].indices)).toEqual([0,1,2]);
  });

  it('bakes the world matrix into positions (translation)', () => {
    const m = [1,0,0,0, 0,1,0,0, 0,0,1,0, 10,20,30,1]; // column-major translate (10,20,30)
    const scene = fakeScene([fakeMesh('Model', [0,0,0, 1,0,0], { matrix: m })]);
    const out = extractMeshes(scene);
    expect(Array.from(out[0].positions)).toEqual([10,20,30, 11,20,30]);
  });

  it('filters out grid/helper/skybox and empty objects', () => {
    const scene = fakeScene([
      fakeMesh('Model', [0,0,0,1,0,0,0,1,0]),
      fakeMesh('GridHelper', [0,0,0,1,0,0,0,1,0]),
      fakeMesh('skybox', [0,0,0,1,0,0,0,1,0]),
      { isObject3D: true, name: 'Light', children: [] }, // not a mesh
    ]);
    const out = extractMeshes(scene);
    expect(out.map(o => o.name)).toEqual(['Model']);
  });

  it('recurses into nested children', () => {
    const child = fakeMesh('Model', [0,0,0,1,0,0,0,1,0]);
    const group = { isObject3D: true, name: 'Group', children: [child] };
    const out = extractMeshes(fakeScene([group]));
    expect(out.length).toBe(1);
  });
});

describe('extractMeshes — interleaved / accessor-based attributes', () => {
  // Mimics a Three.js InterleavedBufferAttribute backed by a quantized Uint16
  // packed buffer (stride 4). The real per-vertex values are exposed ONLY via
  // getX/getY/getZ; `.array` is the wrong-length packed buffer and must be ignored.
  function interleavedPosition(localXYZ) {
    const count = localXYZ.length / 3;
    return {
      count, itemSize: 3, isInterleavedBufferAttribute: true, data: { stride: 4 },
      array: new Uint16Array(count * 4), // wrong length on purpose
      getX: (i) => localXYZ[i * 3], getY: (i) => localXYZ[i * 3 + 1], getZ: (i) => localXYZ[i * 3 + 2],
    };
  }
  const meshWith = (position, matrix) => ({
    isMesh: true, isObject3D: true, name: 'm', visible: true, children: [],
    matrixWorld: { elements: matrix || [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1] },
    geometry: { isBufferGeometry: true, attributes: { position }, index: null },
  });

  it('de-interleaves position via getX/getY/getZ instead of the raw packed array', () => {
    const out = extractMeshes({ isScene: true, children: [meshWith(interleavedPosition([1,2,3, 4,5,6]))] });
    expect(out.length).toBe(1);
    expect(Array.from(out[0].positions)).toEqual([1,2,3, 4,5,6]);
  });

  it('bakes the world matrix onto de-interleaved (quantized) positions', () => {
    const m = [1,0,0,0, 0,1,0,0, 0,0,1,0, 100,0,0,1]; // translate +100 on x
    const out = extractMeshes({ isScene: true, children: [meshWith(interleavedPosition([1,2,3]), m)] });
    expect(Array.from(out[0].positions)).toEqual([101,2,3]);
  });
});

describe('findSceneInGraph', () => {
  const noTime = { now: () => 0 };

  it('reaches a Scene buried behind arbitrary nested properties (incl. a cycle)', () => {
    // Mimics the real find: scene sits behind React-context-like nesting with
    // minified/arbitrary key names, reached via modelRoots[0].parent.
    const scene = { isScene: true, isObject3D: true, name: 'Scene', children: [] };
    const modelRoot = { isObject3D: true, isMesh: false, name: 'ModelRoot', parent: scene };
    scene.children.push(modelRoot);
    const ctxLeaf = { memoizedValue: { modelRoots: [modelRoot], other: 1 } };
    const chain = { next: { next: { next: ctxLeaf } } };
    const fiber = { return: { dependencies: { firstContext: chain } }, junk: { a: 1 } };
    fiber.alternate = fiber; // cycle must not hang the walk

    expect(findSceneInGraph([fiber], noTime)).toBe(scene);
  });

  it('climbs .parent from a Mesh up to the root Scene', () => {
    const scene = { isScene: true, isObject3D: true };
    const group = { isObject3D: true, parent: scene };
    const mesh = { isMesh: true, isObject3D: true, parent: group };
    const root = { a: { b: { c: mesh } } };
    expect(findSceneInGraph([root], noTime)).toBe(scene);
  });

  it('returns null when no Scene is reachable', () => {
    const root = { a: { b: { c: { d: 1 } } } };
    expect(findSceneInGraph([root], noTime)).toBe(null);
  });

  it('honors maxDepth (does not find a scene deeper than the limit)', () => {
    const scene = { isScene: true };
    const root = { a: { b: { c: { d: { e: scene } } } } }; // scene at depth 5
    expect(findSceneInGraph([root], { ...noTime, maxDepth: 2 })).toBe(null);
    expect(findSceneInGraph([root], { ...noTime, maxDepth: 10 })).toBe(scene);
  });
});
