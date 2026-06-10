// Phase 2 probe: are the model's UVs normalized 0..1, or raw quantized 0..65535?
// Also dumps the base-color texture transform (offset/repeat/flipY/channel).
// Run with a textured model open; paste the JSON.
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
  while (st.length) { const n = st.pop(); if (!n || typeof n !== 'object' || s2.has(n)) continue; s2.add(n); try { if (Array.isArray(n.children)) for (const c of n.children) st.push(c); } catch {} if (n.isMesh && n.geometry && n.geometry.attributes && n.geometry.attributes.position && n.geometry.attributes.uv) meshes.push(n); }
  meshes.sort((a, b) => (b.geometry.attributes.position.count || 0) - (a.geometry.attributes.position.count || 0));
  const m = meshes[0]; if (!m) return JSON.stringify({ sceneFound: true, uvMesh: false });
  const uv = m.geometry.attributes.uv;

  const c = uv.count, step = Math.max(1, Math.floor(c / 5000));
  let mnU = Infinity, mnV = Infinity, mxU = -Infinity, mxV = -Infinity;
  for (let i = 0; i < c; i += step) { const u = uv.getX(i), v = uv.getY(i); if (u < mnU) mnU = u; if (u > mxU) mxU = u; if (v < mnV) mnV = v; if (v > mxV) mxV = v; }
  const sample = []; for (let i = 0; i < 4 && i < c; i++) sample.push([uv.getX(i), uv.getY(i)]);

  const mat = Array.isArray(m.material) ? m.material[0] : m.material;
  const map = mat && mat.map;
  const texXform = map ? {
    flipY: map.flipY, channel: map.channel != null ? map.channel : null,
    offset: map.offset ? [map.offset.x, map.offset.y] : null,
    repeat: map.repeat ? [map.repeat.x, map.repeat.y] : null,
    rotation: map.rotation != null ? map.rotation : null,
    wrapS: map.wrapS, wrapT: map.wrapT,
    matrixAutoUpdate: map.matrixAutoUpdate,
    matrix: map.matrix && map.matrix.elements ? Array.from(map.matrix.elements) : null,
  } : null;

  return JSON.stringify({
    sceneFound: true,
    uv: {
      count: uv.count, itemSize: uv.itemSize,
      isInterleaved: !!(uv.isInterleavedBufferAttribute || uv.data),
      stride: uv.data ? uv.data.stride : null,
      normalized: !!uv.normalized,
      arrayType: uv.array ? uv.array.constructor.name : null,
      getRange: { uMin: mnU, uMax: mxU, vMin: mnV, vMax: mxV },
      sampleGetXY: sample,
    },
    baseColorTexture: texXform,
    hasUV2: !!m.geometry.attributes.uv1 || !!m.geometry.attributes.uv2,
  }, null, 2);
})();
