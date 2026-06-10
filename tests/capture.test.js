import { describe, it, expect } from 'vitest';
import { extractMeshes } from '../src/main/capture.js';

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
