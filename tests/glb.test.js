import { describe, it, expect } from 'vitest';
import { WebIO } from '@gltf-transform/core';
import { writeGlb } from '../src/main/glb.js';

describe('writeGlb', () => {
  it('produces a valid GLB with correct header and a parseable triangle', async () => {
    const positions = new Float32Array([0,0,0, 1,0,0, 0,1,0]);
    const indices = new Uint32Array([0,1,2]);
    const buf = writeGlb([{ positions, normals: null, uvs: null, indices, name: 'tri' }]);

    const dv = new DataView(buf);
    expect(dv.getUint32(0, true)).toBe(0x46546C67); // 'glTF'
    expect(dv.getUint32(4, true)).toBe(2);          // version
    expect(dv.getUint32(8, true)).toBe(buf.byteLength); // total length

    const doc = await new WebIO().readBinary(new Uint8Array(buf));
    const meshes = doc.getRoot().listMeshes();
    expect(meshes.length).toBe(1);
    const prim = meshes[0].listPrimitives()[0];
    expect(prim.getAttribute('POSITION').getCount()).toBe(3);
    expect(prim.getIndices().getCount()).toBe(3);
    const min = prim.getAttribute('POSITION').getMin([]);
    const max = prim.getAttribute('POSITION').getMax([]);
    expect(min).toEqual([0,0,0]);
    expect(max).toEqual([1,1,0]);
  });

  it('includes NORMAL and TEXCOORD_0 when provided', async () => {
    const positions = new Float32Array([0,0,0, 1,0,0, 0,1,0]);
    const normals = new Float32Array([0,0,1, 0,0,1, 0,0,1]);
    const uvs = new Float32Array([0,0, 1,0, 0,1]);
    const buf = writeGlb([{ positions, normals, uvs, indices: new Uint32Array([0,1,2]), name: 'tri' }]);
    const doc = await new WebIO().readBinary(new Uint8Array(buf));
    const prim = doc.getRoot().listMeshes()[0].listPrimitives()[0];
    expect(prim.getAttribute('NORMAL').getCount()).toBe(3);
    expect(prim.getAttribute('TEXCOORD_0').getCount()).toBe(3);
  });

  it('writes multiple meshes as separate nodes', async () => {
    const tri = () => ({ positions: new Float32Array([0,0,0,1,0,0,0,1,0]), normals:null, uvs:null, indices:new Uint32Array([0,1,2]), name:'t' });
    const buf = writeGlb([tri(), tri()]);
    const doc = await new WebIO().readBinary(new Uint8Array(buf));
    expect(doc.getRoot().listMeshes().length).toBe(2);
    expect(doc.getRoot().listNodes().length).toBe(2);
  });
});
