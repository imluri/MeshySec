// Phase 1 (debugging) probe: dump each mesh's material so we can robustly identify
// and filter the background/environment dome (the giant sphere wrapping the model).
// Run with the model open; paste the JSON back.
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

  const SIDE = { 0: 'Front', 1: 'Back', 2: 'Double' };
  const matInfo = (mat) => {
    if (!mat) return null;
    if (Array.isArray(mat)) return mat.map(matInfo);
    return {
      type: mat.type || (mat.constructor && mat.constructor.name) || null,
      name: mat.name || null,
      side: mat.side != null ? (SIDE[mat.side] || mat.side) : null,
      transparent: !!mat.transparent, opacity: mat.opacity,
      depthWrite: mat.depthWrite, depthTest: mat.depthTest,
      colorWrite: mat.colorWrite, fog: mat.fog, toneMapped: mat.toneMapped,
      hasMap: !!mat.map, hasEnvMap: !!mat.envMap, hasEmissive: !!mat.emissiveMap,
      vertexColors: !!mat.vertexColors,
    };
  };

  const meshes = []; const st = [scene], s2 = new Set();
  while (st.length) {
    const n = st.pop(); if (!n || typeof n !== 'object' || s2.has(n)) continue; s2.add(n);
    try { if (Array.isArray(n.children)) for (const c of n.children) st.push(c); } catch {}
    if (n.isMesh && n.geometry && n.geometry.attributes && n.geometry.attributes.position) {
      const p = n.geometry.attributes.position;
      meshes.push({
        name: n.name || '(unnamed)', verts: p.count,
        renderOrder: n.renderOrder, frustumCulled: n.frustumCulled,
        isMesh: !!n.isMesh, type: n.type || null,
        parentName: n.parent ? (n.parent.name || n.parent.type || null) : null,
        material: matInfo(n.material),
      });
    }
  }
  return JSON.stringify({ sceneFound: true, meshCount: meshes.length, meshes }, null, 2);
})();
