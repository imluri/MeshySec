// Phase 2 probe: what textures (if any) do the model materials carry in the live
// viewer? Run with a model shown WITH its texture/color (not the plain white
// matcap/clay view). Paste the JSON back.
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

  const SLOTS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap', 'matcap', 'specularMap', 'bumpMap', 'displacementMap'];
  const texInfo = (tex) => {
    if (!tex) return null;
    const img = tex.image || (tex.source && tex.source.data);
    let imgType = null, w = null, h = null, hasSrc = false;
    if (img) { try { imgType = img.constructor && img.constructor.name; } catch {} w = img.width || img.naturalWidth || img.videoWidth || null; h = img.height || img.naturalHeight || null; hasSrc = !!img.src; }
    return { name: tex.name || null, texClass: tex.constructor && tex.constructor.name, imgType, w, h, hasSrc, colorSpace: tex.colorSpace || tex.encoding || null, flipY: tex.flipY };
  };
  const matInfo = (mat) => {
    if (!mat) return null;
    if (Array.isArray(mat)) return mat.map(matInfo);
    const out = { type: mat.type || (mat.constructor && mat.constructor.name), name: mat.name || null, color: mat.color ? mat.color.getHexString && '#' + mat.color.getHexString() : null, vertexColors: !!mat.vertexColors, maps: {} };
    for (const s of SLOTS) if (mat[s]) out.maps[s] = texInfo(mat[s]);
    if (Object.keys(out.maps).length === 0) out.maps = 'none';
    return out;
  };

  const meshes = []; const st = [scene], s2 = new Set();
  while (st.length) { const n = st.pop(); if (!n || typeof n !== 'object' || s2.has(n)) continue; s2.add(n); try { if (Array.isArray(n.children)) for (const c of n.children) st.push(c); } catch {} if (n.isMesh && n.geometry && n.geometry.attributes && n.geometry.attributes.position) meshes.push(n); }
  meshes.sort((a, b) => (b.geometry.attributes.position.count || 0) - (a.geometry.attributes.position.count || 0));

  return JSON.stringify({
    sceneFound: true, meshCount: meshes.length,
    meshes: meshes.slice(0, 6).map((m) => ({
      name: m.name || '(unnamed)', verts: m.geometry.attributes.position.count,
      hasUV: !!m.geometry.attributes.uv,
      material: matInfo(m.material),
    })),
  }, null, 2);
})();
