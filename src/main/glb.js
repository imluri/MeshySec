const FLOAT = 5126, UINT = 5125;
const ARRAY_BUFFER = 34962, ELEMENT_ARRAY_BUFFER = 34963;
const TRIANGLES = 4;
const align4 = (n) => (n + 3) & ~3;

/**
 * Encode captured meshes as a binary glTF 2.0 (GLB) ArrayBuffer.
 * @param {import('./types.js').CapturedMesh[]} meshes
 * @returns {ArrayBuffer}
 */
export function writeGlb(meshes) {
  const json = {
    asset: { version: '2.0', generator: 'meshy-glb-exporter' },
    scene: 0,
    scenes: [{ nodes: [] }],
    nodes: [],
    meshes: [],
    accessors: [],
    bufferViews: [],
    buffers: [],
  };
  const binChunks = [];
  let binLength = 0;

  function addBufferView(typed, target) {
    const bytes = new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength);
    const byteOffset = binLength;
    const bv = { buffer: 0, byteOffset, byteLength: bytes.byteLength };
    if (target !== undefined) bv.target = target; // images use bufferViews with no target
    json.bufferViews.push(bv);
    binChunks.push(bytes);
    binLength += bytes.byteLength;
    const pad = align4(binLength) - binLength;
    if (pad) { binChunks.push(new Uint8Array(pad)); binLength += pad; }
    return json.bufferViews.length - 1;
  }

  // Embed a PNG and return its glTF texture index, deduping by byte-array identity.
  const texIndexByBytes = new Map();
  function addTexture(bytes) {
    if (texIndexByBytes.has(bytes)) return texIndexByBytes.get(bytes);
    if (!json.images) json.images = [];
    if (!json.textures) json.textures = [];
    if (!json.samplers) json.samplers = [{ wrapS: 10497, wrapT: 10497 }]; // REPEAT
    const bv = addBufferView(bytes);
    json.images.push({ bufferView: bv, mimeType: 'image/png' });
    json.textures.push({ source: json.images.length - 1, sampler: 0 });
    const ti = json.textures.length - 1;
    texIndexByBytes.set(bytes, ti);
    return ti;
  }
  function addMaterial(mat) {
    if (!json.materials) json.materials = [];
    const pbr = {};
    if (mat.baseColorFactor) pbr.baseColorFactor = mat.baseColorFactor;
    if (mat.baseColorImage) pbr.baseColorTexture = { index: addTexture(mat.baseColorImage) };
    pbr.metallicFactor = mat.metallicFactor != null ? mat.metallicFactor : 1;
    pbr.roughnessFactor = mat.roughnessFactor != null ? mat.roughnessFactor : 1;
    if (mat.metalRoughImage) pbr.metallicRoughnessTexture = { index: addTexture(mat.metalRoughImage) };
    const out = { pbrMetallicRoughness: pbr };
    if (mat.normalImage) out.normalTexture = { index: addTexture(mat.normalImage) };
    if (mat.emissiveImage) {
      out.emissiveTexture = { index: addTexture(mat.emissiveImage) };
      out.emissiveFactor = mat.emissiveFactor || [1, 1, 1];
    } else if (mat.emissiveFactor) {
      out.emissiveFactor = mat.emissiveFactor;
    }
    json.materials.push(out);
    return json.materials.length - 1;
  }

  meshes.forEach((m, i) => {
    const prim = { attributes: {}, mode: TRIANGLES };
    const vcount = m.positions.length / 3;

    const posBV = addBufferView(m.positions, ARRAY_BUFFER);
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let v = 0; v < vcount; v++) {
      for (let c = 0; c < 3; c++) {
        const val = m.positions[v * 3 + c];
        if (val < min[c]) min[c] = val;
        if (val > max[c]) max[c] = val;
      }
    }
    json.accessors.push({ bufferView: posBV, componentType: FLOAT, count: vcount, type: 'VEC3', min, max });
    prim.attributes.POSITION = json.accessors.length - 1;

    if (m.normals) {
      const bv = addBufferView(m.normals, ARRAY_BUFFER);
      json.accessors.push({ bufferView: bv, componentType: FLOAT, count: vcount, type: 'VEC3' });
      prim.attributes.NORMAL = json.accessors.length - 1;
    }
    if (m.uvs) {
      const bv = addBufferView(m.uvs, ARRAY_BUFFER);
      json.accessors.push({ bufferView: bv, componentType: FLOAT, count: m.uvs.length / 2, type: 'VEC2' });
      prim.attributes.TEXCOORD_0 = json.accessors.length - 1;
    }
    if (m.indices) {
      const bv = addBufferView(m.indices, ELEMENT_ARRAY_BUFFER);
      json.accessors.push({ bufferView: bv, componentType: UINT, count: m.indices.length, type: 'SCALAR' });
      prim.indices = json.accessors.length - 1;
    }

    if (m.material) prim.material = addMaterial(m.material);

    const name = m.name || `mesh_${i}`;
    json.meshes.push({ primitives: [prim], name });
    json.nodes.push({ mesh: i, name });
    json.scenes[0].nodes.push(i);
  });

  json.buffers.push({ byteLength: binLength });

  let jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jsonPad = align4(jsonBytes.length) - jsonBytes.length;
  if (jsonPad) {
    const padded = new Uint8Array(jsonBytes.length + jsonPad);
    padded.set(jsonBytes);
    padded.fill(0x20, jsonBytes.length);
    jsonBytes = padded;
  }

  const binBuf = new Uint8Array(binLength);
  let off = 0;
  for (const c of binChunks) { binBuf.set(c, off); off += c.byteLength; }

  const total = 12 + 8 + jsonBytes.length + 8 + binBuf.length;
  const out = new ArrayBuffer(total);
  const dv = new DataView(out);
  let p = 0;
  dv.setUint32(p, 0x46546C67, true); p += 4; // 'glTF'
  dv.setUint32(p, 2, true); p += 4;
  dv.setUint32(p, total, true); p += 4;
  dv.setUint32(p, jsonBytes.length, true); p += 4;
  dv.setUint32(p, 0x4E4F534A, true); p += 4; // 'JSON'
  new Uint8Array(out, p, jsonBytes.length).set(jsonBytes); p += jsonBytes.length;
  dv.setUint32(p, binBuf.length, true); p += 4;
  dv.setUint32(p, 0x004E4942, true); p += 4; // 'BIN\0'
  new Uint8Array(out, p, binBuf.length).set(binBuf);

  return out;
}
