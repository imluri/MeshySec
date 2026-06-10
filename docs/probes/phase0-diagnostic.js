// Phase 0 DEEP DIAGNOSTIC probe for the Meshy GLB Exporter.
// GOAL: figure out WHY findScene() can't reach the Three.js scene.
//
// HOW TO RUN (important — do these in order):
//   1. Open a model in the Meshy workspace so the 3D model is VISIBLY rendered.
//   2. Click on the 3D view and orbit it once with the mouse (confirms it's live).
//   3. In DevTools, make sure the Console "context" dropdown says "top" (not an iframe).
//   4. Paste this whole file, press Enter, copy the JSON output back.
(() => {
  const out = { threeRevision: window.__THREE__ ?? null, location: location.href.replace(/\?.*/, '') };
  const isThree = (o) => { try { return !!o && (o.isScene || o.isObject3D || o.isMesh || o.isWebGLRenderer); } catch { return false; } };
  const hasCurrent = (v) => { try { return v && typeof v === 'object' && 'current' in v; } catch { return false; } };
  const ownKeys = (o) => { try { return Object.keys(o); } catch { return []; } };

  try {
    // --- frames / shadow / gpu marker ---------------------------------------
    out.frameCount = window.frames.length;
    try { out.isTopFrame = window.top === window.self; } catch { out.isTopFrame = 'cross-origin'; }
    try { const g = window.__meshyViewerGpuWorkaroundState; out.gpuWorkaround = g ? (typeof g === 'object' ? ownKeys(g).slice(0, 20) : String(g)) : null; } catch { out.gpuWorkaround = 'err'; }

    // --- collect canvases, including shadow DOM -----------------------------
    const canvases = [];
    const visitForCanvas = (root) => {
      let nodes; try { nodes = root.querySelectorAll('*'); } catch { return; }
      for (const el of nodes) { if (el.tagName === 'CANVAS') canvases.push(el); if (el.shadowRoot) visitForCanvas(el.shadowRoot); }
    };
    visitForCanvas(document);
    out.canvasCount = canvases.length;

    out.canvases = canvases.slice(0, 8).map((c) => {
      let ctx = 'none';
      try { ctx = c.getContext('webgl2') ? 'webgl2' : (c.getContext('webgl') ? 'webgl' : 'null'); }
      catch (e) { ctx = 'throws:' + e.name; } // InvalidStateError => transferred to OffscreenCanvas (worker render)
      let fiberOwner = null;
      for (let i = 0, node = c; i < 8 && node; i++, node = node.parentElement) {
        const fk = ownKeys(node).find(k => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'));
        if (fk) { fiberOwner = { tag: node.tagName, depth: i }; break; }
      }
      return { w: c.width, h: c.height, cw: c.clientWidth, ch: c.clientHeight, ctx, ownDunder: ownKeys(c).filter(k => k.startsWith('__')).slice(0, 8), fiberOwner };
    });

    // --- deep search for a Three.js scene -----------------------------------
    const seen = new Set(); const hits = []; let scene = null; let steps = 0; const MAX = 80000;
    const climbToScene = (v) => { let n = v, g = new Set(); while (n && !g.has(n)) { g.add(n); if (n.isScene) return n; try { n = n.parent; } catch { break; } } return null; };
    const consider = (v, via) => {
      if (!isThree(v)) return;
      hits.push({ via, kind: v.isScene ? 'Scene' : v.isWebGLRenderer ? 'Renderer' : v.isMesh ? 'Mesh' : 'Object3D', name: (() => { try { return v.name || null; } catch { return null; } })() });
      if (!scene) { const s = v.isScene ? v : climbToScene(v); if (s) scene = s; }
    };

    const walkFiber = (root, label) => {
      const stack = [root];
      while (stack.length && steps < MAX) {
        steps++;
        const node = stack.pop();
        if (!node || typeof node !== 'object' || seen.has(node)) continue;
        seen.add(node);
        for (const p of ['child', 'sibling', 'return']) { try { if (node[p]) stack.push(node[p]); } catch {} }

        let sn; try { sn = node.stateNode; } catch {}
        if (sn && typeof sn === 'object' && !(sn instanceof Node)) {
          consider(sn, label + ':stateNode');
          for (const k of ownKeys(sn).slice(0, 40)) { let v; try { v = sn[k]; } catch { continue; } consider(v, label + ':stateNode.' + k); if (hasCurrent(v)) consider(v.current, label + ':stateNode.' + k + '.current'); }
        }
        let mp; try { mp = node.memoizedProps; } catch {}
        if (mp && typeof mp === 'object') for (const k of ownKeys(mp).slice(0, 30)) { let v; try { v = mp[k]; } catch { continue; } consider(v, label + ':props.' + k); if (hasCurrent(v)) consider(v.current, label + ':props.' + k + '.current'); }

        let ms; try { ms = node.memoizedState; } catch {}
        let hop = 0;
        while (ms && typeof ms === 'object' && hop < 60) {
          hop++;
          let hv; try { hv = ms.memoizedState; } catch {}
          consider(hv, label + ':hook');
          if (hasCurrent(hv)) consider(hv.current, label + ':hook.current');
          if (hv && typeof hv === 'object') for (const k of ownKeys(hv).slice(0, 20)) { let v; try { v = hv[k]; } catch { continue; } consider(v, label + ':hook.' + k); }
          try { ms = ms.next; } catch { break; }
          if (!ms || seen.has(ms)) break; seen.add(ms);
        }
      }
    };

    // fiber start points: canvas ancestors + react containers
    const starts = [];
    for (const c of canvases) for (let i = 0, node = c; i < 10 && node; i++, node = node.parentElement) { const fk = ownKeys(node).find(k => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$')); if (fk) { starts.push(node[fk]); break; } }
    for (const el of document.querySelectorAll('body, body > div, #__next, #root')) { const k = ownKeys(el).find(k => k.startsWith('__reactContainer$')); if (k) { try { const r = el[k]; starts.push(r.current || r); } catch {} } }
    out.fiberStartCount = starts.length;
    for (const s of starts) walkFiber(s, 'fiber');

    for (const k of Object.keys(window)) { let v; try { v = window[k]; } catch { continue; } consider(v, 'window.' + k); }

    // summarize the scene if found
    let meshSummary = null;
    if (scene) {
      meshSummary = []; const st = [scene], s2 = new Set();
      while (st.length) { const n = st.pop(); if (!n || typeof n !== 'object' || s2.has(n)) continue; s2.add(n); try { if (Array.isArray(n.children)) for (const c of n.children) st.push(c); } catch {} if (n.isMesh && n.geometry && n.geometry.attributes) { const a = n.geometry.attributes; meshSummary.push({ name: n.name || '(unnamed)', verts: a.position ? a.position.count : 0, normal: !!a.normal, uv: !!a.uv, idx: n.geometry.index ? n.geometry.index.count : 0 }); } }
    }

    out.steps = steps;
    out.hitCount = hits.length;
    out.hits = hits.slice(0, 25);
    out.sceneFound = !!scene;
    out.meshCount = meshSummary ? meshSummary.length : 0;
    out.meshSummary = meshSummary ? meshSummary.slice(0, 40) : null;
    out.windowThreeish = Object.keys(window).filter(k => /three|scene|render|viewer|mesh|webgl|model|babylon|gpu/i.test(k)).slice(0, 30);
  } catch (e) {
    out.PROBE_ERROR = String(e && e.stack || e);
  }
  return JSON.stringify(out, null, 2);
})();
