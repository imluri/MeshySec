import { describe, it, expect } from 'vitest';
import { packMetalRough } from '../src/main/textures.js';

describe('packMetalRough', () => {
  it('takes roughness from G, metalness from B, sets R=255 and A=255', () => {
    const rough = new Uint8ClampedArray([10, 150, 20, 255]); // G=150 is the roughness
    const metal = new Uint8ClampedArray([30, 40, 200, 255]); // B=200 is the metalness
    const out = packMetalRough(rough, metal, 1);
    expect(Array.from(out)).toEqual([255, 150, 200, 255]);
  });

  it('packs multiple pixels independently', () => {
    const rough = new Uint8ClampedArray([0, 11, 0, 255, 0, 22, 0, 255]);
    const metal = new Uint8ClampedArray([0, 0, 111, 255, 0, 0, 222, 255]);
    const out = packMetalRough(rough, metal, 2);
    expect(Array.from(out)).toEqual([255, 11, 111, 255, 255, 22, 222, 255]);
  });
});
