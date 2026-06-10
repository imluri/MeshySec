const REQUEST = 'MESHY_GLB_EXPORT_REQUEST';
const RESULT = 'MESHY_GLB_EXPORT_RESULT';
const BTN_ID = 'meshy-glb-export-btn';
const PILL_ID = 'meshy-glb-export-pill';
const BAR_SELECTOR = '[data-testid="viewer-bottom-bar"]';

let btnEl = null;
let labelEl = null;
let busy = false;

function logoUrl() {
  try {
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) {
      return chrome.runtime.getURL('icons/icon32.png');
    }
  } catch { /* not in an extension context */ }
  return '';
}

/**
 * Insert the brand-blue "GLB" export button (with our logo) into Meshy's viewer
 * bottom toolbar, wrapped in a cloned native "pill" so it sits cleanly among the
 * native controls. No-op if the toolbar is absent (no model open) or the button
 * already exists.
 */
function ensureButton() {
  const bar = document.querySelector(BAR_SELECTOR);
  if (!bar || document.getElementById(PILL_ID)) return;

  btnEl = document.createElement('button');
  btnEl.id = BTN_ID;
  btnEl.type = 'button';
  btnEl.title = 'Export this model’s geometry as GLB';
  const url = logoUrl();
  btnEl.innerHTML =
    (url ? `<img src="${url}" alt="">` : '') +
    '<span data-meshy-label>GLB</span>';
  btnEl.addEventListener('click', requestExport);
  labelEl = btnEl.querySelector('[data-meshy-label]');

  // Our own blue "pill" (matching the toolbar's pill shape/size) so the whole
  // control is brand-blue rather than a blue button on the native gray pill.
  const pill = document.createElement('div');
  pill.id = PILL_ID;
  pill.appendChild(btnEl);
  bar.appendChild(pill);
}

function requestExport() {
  if (busy) return;
  busy = true;
  if (btnEl) btnEl.disabled = true;
  if (labelEl) labelEl.textContent = '…';
  window.postMessage({ source: 'meshy-glb-ui', type: REQUEST }, '*');
}

window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  const data = event.data;
  if (!data || data.source !== 'meshy-glb-main' || data.type !== RESULT) return;

  busy = false;
  if (btnEl) btnEl.disabled = false;
  if (labelEl) labelEl.textContent = 'GLB';

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

// Insert into the toolbar now, and keep it there across React re-renders and
// model open/close. Debounced via rAF so bursts of mutations cost one pass.
let rafQueued = false;
const observer = new MutationObserver(() => {
  if (rafQueued) return;
  rafQueued = true;
  requestAnimationFrame(() => { rafQueued = false; ensureButton(); });
});
observer.observe(document.documentElement, { childList: true, subtree: true });
ensureButton();
