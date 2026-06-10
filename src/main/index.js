import { captureSceneGeometry } from './capture.js';
import { writeGlb } from './glb.js';

const REQUEST = 'MESHY_GLB_EXPORT_REQUEST';
const RESULT = 'MESHY_GLB_EXPORT_RESULT';

window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  const data = event.data;
  if (!data || data.source !== 'meshy-glb-ui' || data.type !== REQUEST) return;

  try {
    const meshes = captureSceneGeometry();
    const glb = writeGlb(meshes);
    const filename = deriveFilename();
    window.postMessage({ source: 'meshy-glb-main', type: RESULT, ok: true, glb, filename }, '*', [glb]);
  } catch (err) {
    window.postMessage({ source: 'meshy-glb-main', type: RESULT, ok: false, error: String(err && err.message || err) }, '*');
  }
});

function deriveFilename() {
  // Task 1 findings record the id-bearing URL segment; fall back to a timestamp.
  const seg = location.pathname.split('/').filter(Boolean).pop();
  const base = seg && /[0-9a-f-]{8,}/i.test(seg) ? seg : `meshy-${Date.now()}`;
  return `${base}.glb`;
}
