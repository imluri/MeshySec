import { captureSceneGeometry } from './capture.js';
import { writeGlb } from './glb.js';

const REQUEST = 'MESHY_GLB_EXPORT_REQUEST';
const RESULT = 'MESHY_GLB_EXPORT_RESULT';

window.addEventListener('message', async (event) => {
  if (event.source !== window) return;
  const data = event.data;
  if (!data || data.source !== 'meshy-glb-ui' || data.type !== REQUEST) return;

  try {
    const meshes = await captureSceneGeometry({ withTextures: !!data.withTextures });
    logCapturedMeshes(meshes);
    const glb = writeGlb(meshes);
    const filename = deriveFilename();
    window.postMessage({ source: 'meshy-glb-main', type: RESULT, ok: true, glb, filename }, '*', [glb]);
  } catch (err) {
    window.postMessage({ source: 'meshy-glb-main', type: RESULT, ok: false, error: String(err && err.message || err) }, '*');
  }
});

/** Diagnostic: log the world-space bbox + index sanity of what we're about to export. */
function logCapturedMeshes(meshes) {
  try {
    const summary = meshes.map((m) => {
      const p = m.positions;
      let mnx = Infinity, mny = Infinity, mnz = Infinity, mxx = -Infinity, mxy = -Infinity, mxz = -Infinity;
      for (let i = 0; i < p.length; i += 3) {
        const x = p[i], y = p[i + 1], z = p[i + 2];
        if (x < mnx) mnx = x; if (y < mny) mny = y; if (z < mnz) mnz = z;
        if (x > mxx) mxx = x; if (y > mxy) mxy = y; if (z > mxz) mxz = z;
      }
      let idxMax = -1;
      if (m.indices) for (let i = 0; i < m.indices.length; i++) if (m.indices[i] > idxMax) idxMax = m.indices[i];
      return {
        name: m.name, verts: p.length / 3,
        min: [+mnx.toFixed(4), +mny.toFixed(4), +mnz.toFixed(4)],
        max: [+mxx.toFixed(4), +mxy.toFixed(4), +mxz.toFixed(4)],
        idxCount: m.indices ? m.indices.length : 0, idxMax,
        normals: m.normals ? m.normals.length / 3 : 0, uvs: m.uvs ? m.uvs.length / 2 : 0,
      };
    });
    console.log('[MeshyGLB] captured meshes ->', JSON.stringify(summary));
  } catch (e) {
    console.log('[MeshyGLB] capture-debug failed', e);
  }
}

function deriveFilename() {
  // Task 1 findings record the id-bearing URL segment; fall back to a timestamp.
  const seg = location.pathname.split('/').filter(Boolean).pop();
  const base = seg && /[0-9a-f-]{8,}/i.test(seg) ? seg : `meshy-${Date.now()}`;
  return `${base}.glb`;
}
