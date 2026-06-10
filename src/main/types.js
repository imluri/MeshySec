/**
 * @typedef {Object} CapturedMaterial
 * @property {Uint8Array} [baseColorImage]   PNG bytes, sRGB
 * @property {Uint8Array} [normalImage]      PNG bytes, linear
 * @property {Uint8Array} [metalRoughImage]  PNG bytes, linear (G=roughness, B=metalness)
 * @property {Uint8Array} [emissiveImage]    PNG bytes, sRGB
 * @property {number[]}   [baseColorFactor]  [r,g,b,a] linear
 * @property {number}     [metallicFactor]
 * @property {number}     [roughnessFactor]
 * @property {number[]}   [emissiveFactor]   [r,g,b] linear
 */

/**
 * @typedef {Object} CapturedMesh
 * @property {Float32Array} positions
 * @property {Float32Array|null} normals
 * @property {Float32Array|null} uvs
 * @property {Uint32Array|null} indices
 * @property {string} name
 * @property {CapturedMaterial|null} [material]
 */
export {};
