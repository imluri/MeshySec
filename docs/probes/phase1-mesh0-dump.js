// Phase 1 (debugging) probe: why does the exported truck render as a sphere/blob?
// Dumps the largest mesh's transform, raw position range, world-space bbox, index
// sanity, and normals. Run with the model open; paste the JSON back.
//
// DECISIVE CHECKS:
//   - indexMax must be < posCount. If indexMax >= posCount, triangles reference
//     non-existent vertices -> scrambled blob.
//   - worldBBox aspect ratio: a truck is elongated; ~cubic+huge => positions not
//     dequantized (matrixWorld lacks the scale/offset).
(() => {
  const climb = (v) => { let n = v, g = new Set(); while (n && typeof n === 'object' && !g.has(n)) { g.add(n); if (n.isScene) return n; try { n = n.parent; } catch { return null; } } return null; };
  const canvas = document.querySelector('canvas'); const roots = [];
  if (canvas) { for (const k of Object.keys(canvas)) if (k.startsWith('__react')) roots.push(canvas[k]); let nd = canvas.parentElement; for (let i = 0; i < 12 && nd; i++, nd = nd.parentElement) for (const k of Object.keys(nd)) if (k.startsWith('__reactFiber$')) roots.push(nd[k]); }
  const seen = new Set(); let scene = null; const stack = roots.map((r) => [r, 0]); const t0 = performance.now();
  while (stack.length) {
    if (performance.now() - t0 > 3000) break;
    const [v, d] = stack.pop(); if (v == null || d > 30) continue;
    const t = typeof v; if (t !== 'object' && t !== 'function') continue; if (seen.has(v)) continue; seen.add(v);
    try { if (v.isScene) { scene = v; break; } if (v.isObject3D || v.isMesh) { const s = climb(v); if (s) { scene = s; break; } } } catch {}
    try { if (v instanceof Node || v === window || v === document) continue; } catch {}
    if (t === 'object') { let keys; try { keys = Object.keys(v); } catch { continue; } if (Array.isArray(v)) { for (let i = 0; i < Math.min(v.length, 4000); i++) stack.push([v[i], d + 1]); } else for (const k of keys) { if (k === '_owner' || k === '_debugOwner') continue; let cv; try { cv = v[k]; } catch { continue; } stack.push([cv, d + 1]); } }
  }
  if (!scene) return JSON.stringify({ sceneFound: false });

  const meshes = []; const st = [scene], s2 = new Set();
  while (st.length) { const n = st.pop(); if (!n || typeof n !== 'object' || s2.has(n)) continue; s2.add(n); try { if (Array.isArray(n.children)) for (const c of n.children) st.push(c); } catch {} if (n.isMesh && n.geometry && n.geometry.attributes && n.geometry.attributes.position) meshes.push(n); }
  meshes.sort((a, b) => (b.geometry.attributes.position.count || 0) - (a.geometry.attributes.position.count || 0));
  const m = meshes[0], g = m.geometry, p = g.attributes.position, nrm = g.attributes.normal;

  const sample = (attr, comps, N) => {
    const c = attr.count, mn = Array(comps).fill(Infinity), mx = Array(comps).fill(-Infinity);
    const step = Math.max(1, Math.floor(c / N)); let zero = 0, sampled = 0;
    for (let i = 0; i < c; i += step) {
      const a = [attr.getX(i), comps > 1 ? attr.getY(i) : 0, comps > 2 ? attr.getZ(i) : 0].slice(0, comps);
      for (let k = 0; k < comps; k++) { if (a[k] < mn[k]) mn[k] = a[k]; if (a[k] > mx[k]) mx[k] = a[k]; }
      if (comps === 3 && a[0] === 0 && a[1] === 0 && a[2] === 0) zero++; sampled++;
    }
    return { min: mn, max: mx, zeroCount: zero, sampled };
  };

  const e = m.matrixWorld && m.matrixWorld.elements;
  const bbW = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  const c = p.count, step = Math.max(1, Math.floor(c / 5000));
  for (let i = 0; i < c; i += step) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const w = [e[0]*x + e[4]*y + e[8]*z + e[12], e[1]*x + e[5]*y + e[9]*z + e[13], e[2]*x + e[6]*y + e[10]*z + e[14]];
    for (let k = 0; k < 3; k++) { if (w[k] < bbW.min[k]) bbW.min[k] = w[k]; if (w[k] > bbW.max[k]) bbW.max[k] = w[k]; }
  }

  const idx = g.index; let idxMax = -1; const idxFirst = [];
  if (idx) { const ic = idx.count, istep = Math.max(1, Math.floor(ic / 20000)); for (let i = 0; i < ic; i += istep) { const val = idx.getX ? idx.getX(i) : idx.array[i]; if (val > idxMax) idxMax = val; } for (let i = 0; i < 9 && i < ic; i++) idxFirst.push(idx.getX ? idx.getX(i) : idx.array[i]); }

  return JSON.stringify({
    sceneFound: true, meshCount: meshes.length,
    name: m.name || '(unnamed)', isSkinnedMesh: !!m.isSkinnedMesh,
    hasMorph: !!(g.morphAttributes && Object.keys(g.morphAttributes).length),
    posCount: p.count, posType: p.array ? p.array.constructor.name : null,
    posInterleaved: !!(p.isInterleavedBufferAttribute || p.data), posNormalized: !!p.normalized, posStride: p.data ? p.data.stride : null,
    rawPosSample: sample(p, 3, 5000),
    worldBBox: bbW,
    geometryBoundingBox: g.boundingBox ? { min: [g.boundingBox.min.x, g.boundingBox.min.y, g.boundingBox.min.z], max: [g.boundingBox.max.x, g.boundingBox.max.y, g.boundingBox.max.z] } : null,
    normalSample: nrm ? sample(nrm, 3, 5000) : null,
    matrixWorld: e ? Array.from(e) : null,
    matrixLocal: m.matrix && m.matrix.elements ? Array.from(m.matrix.elements) : null,
    indexCount: idx ? idx.count : null, indexMax: idxMax, indexFirst: idxFirst,
  }, null, 2);
})();
