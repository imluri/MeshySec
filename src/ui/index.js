const REQUEST = 'MESHY_GLB_EXPORT_REQUEST';
const RESULT = 'MESHY_GLB_EXPORT_RESULT';

const btn = document.createElement('button');
btn.id = 'meshy-glb-export-btn';
btn.textContent = 'Export GLB';
document.documentElement.appendChild(btn);

btn.addEventListener('click', () => {
  btn.disabled = true;
  btn.textContent = 'Exporting…';
  window.postMessage({ source: 'meshy-glb-ui', type: REQUEST }, '*');
});

window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  const data = event.data;
  if (!data || data.source !== 'meshy-glb-main' || data.type !== RESULT) return;

  btn.disabled = false;
  btn.textContent = 'Export GLB';

  if (!data.ok) { alert(`Meshy GLB Exporter: ${data.error}`); return; }

  const blob = new Blob([data.glb], { type: 'model/gltf-binary' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = data.filename || 'model.glb';
  document.documentElement.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
});
