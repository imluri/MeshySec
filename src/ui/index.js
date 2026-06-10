const REQUEST = 'MESHY_GLB_EXPORT_REQUEST';
const RESULT = 'MESHY_GLB_EXPORT_RESULT';
const BTN_ID = 'meshy-glb-export-btn';
const PILL_ID = 'meshy-glb-export-pill';
const POP_ID = 'meshy-glb-export-popover';
const BAR_SELECTOR = '[data-testid="viewer-bottom-bar"]';

let btnEl = null;
let labelEl = null;
let popEl = null;
let busy = false;

function logoUrl() {
  try {
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) {
      return chrome.runtime.getURL('icons/icon32.png');
    }
  } catch { /* not in an extension context */ }
  return '';
}

function caretSvg() {
  return '<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" style="margin-left:2px"><path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
}

function makeOption(title, sub, withTextures) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'meshy-glb-opt';
  b.innerHTML = `<span class="t">${title}</span><span class="s">${sub}</span>`;
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    closePopover();
    requestExport(withTextures);
  });
  return b;
}

/**
 * Insert the brand-blue export control into Meshy's viewer toolbar: a button that
 * opens a small menu (With textures / Geometry only). Kept in place across React
 * re-renders. No-op if the toolbar is absent or the control already exists.
 */
function ensureButton() {
  const bar = document.querySelector(BAR_SELECTOR);
  if (!bar || document.getElementById(PILL_ID)) return;

  btnEl = document.createElement('button');
  btnEl.id = BTN_ID;
  btnEl.type = 'button';
  btnEl.title = 'Export this model as GLB';
  const url = logoUrl();
  btnEl.innerHTML =
    (url ? `<img src="${url}" alt="">` : '') +
    '<span data-meshy-label>GLB</span>' +
    caretSvg();
  btnEl.addEventListener('click', togglePopover);
  labelEl = btnEl.querySelector('[data-meshy-label]');

  popEl = document.createElement('div');
  popEl.id = POP_ID;
  popEl.hidden = true;
  popEl.appendChild(makeOption('With textures', 'base color, normal, metal/rough', true));
  popEl.appendChild(makeOption('Geometry only', 'mesh shape — smaller file', false));

  const pill = document.createElement('div');
  pill.id = PILL_ID;
  pill.appendChild(btnEl);
  pill.appendChild(popEl);
  bar.appendChild(pill);
}

function togglePopover(e) {
  e.stopPropagation();
  if (!popEl || busy) return;
  popEl.hidden = !popEl.hidden;
  if (!popEl.hidden) document.addEventListener('click', onDocClick);
  else document.removeEventListener('click', onDocClick);
}

function closePopover() {
  if (popEl) popEl.hidden = true;
  document.removeEventListener('click', onDocClick);
}

function onDocClick(e) {
  const pill = document.getElementById(PILL_ID);
  if (pill && !pill.contains(e.target)) closePopover();
}

function requestExport(withTextures) {
  if (busy) return;
  busy = true;
  if (btnEl) btnEl.disabled = true;
  if (labelEl) labelEl.textContent = 'exporting…';
  window.postMessage({ source: 'meshy-glb-ui', type: REQUEST, withTextures: !!withTextures }, '*');
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
