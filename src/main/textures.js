/** @typedef {import('./types.js').CapturedMaterial} CapturedMaterial */

// Texture capture for the "with textures" export. Reads a Three.js
// MeshStandardMaterial's maps (ImageBitmaps in the live viewer) into PNG bytes
// and assembles a glTF-shaped material descriptor. Browser-only: the encode
// helpers touch <canvas>/ImageBitmap, but only inside function bodies so this
// module is safe to import in Node tests for the pure `packMetalRough`.

/** Pack roughness (G) and metalness (B) into one glTF metallicRoughness texture.
 *  glTF samples roughness from the green channel and metalness from the blue.
 *  R is left at 255 (occlusion is exported separately if ever needed).
 *  @param {Uint8ClampedArray|Uint8Array} roughRGBA
 *  @param {Uint8ClampedArray|Uint8Array} metalRGBA
 *  @param {number} pixels  number of pixels (length / 4)
 *  @returns {Uint8ClampedArray} RGBA */
export function packMetalRough(roughRGBA, metalRGBA, pixels) {
  const out = new Uint8ClampedArray(pixels * 4);
  for (let i = 0; i < pixels; i++) {
    const o = i * 4;
    out[o] = 255;
    out[o + 1] = roughRGBA[o + 1];
    out[o + 2] = metalRGBA[o + 2];
    out[o + 3] = 255;
  }
  return out;
}

function imageOf(tex) {
  if (!tex) return null;
  return tex.image || (tex.source && tex.source.data) || null;
}

function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

async function canvasToPng(canvas) {
  if (canvas.convertToBlob) {
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    return new Uint8Array(await blob.arrayBuffer());
  }
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  return new Uint8Array(await blob.arrayBuffer());
}

async function encodeImage(img) {
  if (!img || !img.width) return null;
  const canvas = makeCanvas(img.width, img.height);
  canvas.getContext('2d').drawImage(img, 0, 0);
  return canvasToPng(canvas);
}

async function encodeMetalRough(roughImg, metalImg) {
  if (roughImg === metalImg) return encodeImage(roughImg); // already a packed ORM/MR map
  const w = roughImg.width, h = roughImg.height;
  const rc = makeCanvas(w, h); rc.getContext('2d').drawImage(roughImg, 0, 0);
  const mc = makeCanvas(w, h); mc.getContext('2d').drawImage(metalImg, 0, 0);
  const rData = rc.getContext('2d').getImageData(0, 0, w, h).data;
  const mData = mc.getContext('2d').getImageData(0, 0, w, h).data;
  const packed = packMetalRough(rData, mData, w * h);
  const out = makeCanvas(w, h);
  out.getContext('2d').putImageData(new ImageData(packed, w, h), 0, 0);
  return canvasToPng(out);
}

/**
 * Read a Three.js standard material into a CapturedMaterial with PNG textures.
 * Returns null if there's nothing usable. Async (image encoding is async).
 * @param {object|object[]} material
 * @returns {Promise<CapturedMaterial|null>}
 */
export async function captureMaterial(material) {
  const mat = Array.isArray(material) ? material[0] : material;
  if (!mat) return null;

  /** @type {CapturedMaterial} */
  const desc = {};

  const base = imageOf(mat.map);
  if (base) desc.baseColorImage = await encodeImage(base);

  const normal = imageOf(mat.normalMap);
  if (normal) desc.normalImage = await encodeImage(normal);

  const rough = imageOf(mat.roughnessMap);
  const metal = imageOf(mat.metalnessMap);
  if (rough && metal) desc.metalRoughImage = await encodeMetalRough(rough, metal);
  else if (rough) desc.metalRoughImage = await encodeImage(rough);
  else if (metal) desc.metalRoughImage = await encodeImage(metal);

  desc.metallicFactor = mat.metalness != null ? mat.metalness : 1;
  desc.roughnessFactor = mat.roughness != null ? mat.roughness : 1;

  if (mat.color) {
    desc.baseColorFactor = [mat.color.r, mat.color.g, mat.color.b, mat.opacity != null ? mat.opacity : 1];
  }

  const emissive = imageOf(mat.emissiveMap);
  if (emissive) {
    const e = mat.emissive;
    const ei = mat.emissiveIntensity != null ? mat.emissiveIntensity : 1;
    const factor = e ? [e.r * ei, e.g * ei, e.b * ei] : [1, 1, 1];
    // A black emissive factor zeroes out the map in the viewer, so don't bother
    // embedding a large emissive texture that won't show.
    if (factor[0] || factor[1] || factor[2]) {
      desc.emissiveImage = await encodeImage(emissive);
      desc.emissiveFactor = factor;
    }
  }

  // Drop any maps that failed to encode.
  for (const k of ['baseColorImage', 'normalImage', 'metalRoughImage', 'emissiveImage']) {
    if (desc[k] == null) delete desc[k];
  }
  return desc;
}
