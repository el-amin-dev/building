/**
 * Procedural surface textures, drawn on a canvas at load time.
 *
 * Everything in this building is derived from numbers rather than downloaded, and a texture is
 * no exception: ADR-015 rules out external 3D assets for the fixtures, and the same argument
 * applies to an image file. A bouclé weave and an oak grain are patterns, and a pattern is
 * something you can write down — so these are written down, and the repository stays a
 * repository of numbers with no binary to licence, fetch or keep in sync with the code.
 *
 * **Deterministic, and that is not optional.** ADR-009 established that nothing in the scene may
 * differ between two loads of the same page, because two committed screenshot baselines compare
 * the rendered frame pixel for pixel. `Math.random` would make every run a different building.
 * Each generator therefore draws from its own seeded stream, and the seed is written beside it.
 *
 * **Every generator may return `undefined`, and every caller must cope.** A canvas has no 2D
 * context under jsdom, which is where the whole unit suite runs, so a texture is a thing the
 * scene has when it can and does without when it cannot. The materials fall back to their flat
 * colour, which is what the floor looked like before this module existed.
 *
 * **A texture carries the pattern, never the colour.** `meshStandardMaterial` multiplies its
 * `color` by its `map`, so a map that also held the family's colour would render that colour
 * squared and leave the palette entry describing nothing. Each generator therefore draws over
 * its family's own colour and is then divided by it (`neutralise`), which turns the drawing
 * into a modulation of the palette rather than a second opinion about it.
 *
 * The textures are small — 256 px square — and tile. They are read at a metre or two by a
 * walking eye, never inspected, so resolution buys nothing and memory costs something on a
 * machine already rasterising the whole floor in software.
 */

import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from 'three';

import { PARIS_BOUCLE, PARIS_CARPET, PARIS_MARBLE, PARIS_OAK } from './floorMaterials.ts';

/** Side of every generated texture, in pixels. Square, so one number says it. */
const TEXTURE_SIZE = 256;

/**
 * How many times a texture repeats across one face of a box it is mapped onto, by default.
 *
 * A default and not a constant, because the same material is now mapped onto boxes of very
 * different sizes: the merged geometry gives every face the same 0…1 UV square whatever its
 * real width, so a repeat that reads as oak grain on a 0.60 m wardrobe door reads as a smear
 * on a 10 m corridor floor. A caller that maps one of these onto a floor passes its own
 * repeat; these four are the furniture-scale values, which is the common case.
 */
const CARPET_REPEAT = 4;
const OAK_REPEAT = 2;
const BOUCLE_REPEAT = 2;
const MARBLE_REPEAT = 1;

/**
 * Builds a seeded pseudo-random stream.
 *
 * Mulberry32: thirty-two bits of state, a handful of operations, and the same sequence for the
 * same seed on every machine and every run — which is the only property that matters here.
 *
 * @param seed - The stream's seed. Different seeds give different, but equally fixed, patterns.
 * @returns A function returning the next value in `[0, 1)`.
 */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let drawn = Math.imul(state ^ (state >>> 15), 1 | state);
    drawn = (drawn + Math.imul(drawn ^ (drawn >>> 7), 61 | drawn)) ^ drawn;
    return ((drawn ^ (drawn >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Opens a square canvas to draw a texture on.
 *
 * @returns The drawing context, or `undefined` where there is no canvas to draw on — jsdom,
 *   which is where every unit test runs.
 */
function openCanvas(): CanvasRenderingContext2D | undefined {
  const canvas = document.createElement('canvas');
  canvas.width = TEXTURE_SIZE;
  canvas.height = TEXTURE_SIZE;
  return canvas.getContext('2d') ?? undefined;
}

/** Channels per pixel in the canvas's RGBA buffer. */
const CHANNELS_PER_PIXEL = 4;
/** The largest value a channel can hold, and the divisor that turns one into a fraction. */
const CHANNEL_MAX = 255;

/**
 * Reads the three channels of a `#rrggbb` string.
 *
 * @param hex - A six-digit hexadecimal colour, as the palette writes them.
 * @returns Its red, green and blue channels, each 0…255.
 */
function readChannels(hex: string): readonly [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

/**
 * Divides a finished drawing by the colour it was drawn over.
 *
 * WHY this exists at all: `meshStandardMaterial` multiplies its `color` by its `map`, so a map
 * that already carries the family's colour renders that colour **squared** — `#ddc9a8` oak
 * comes back at roughly `#c1a26e`, a darker and more saturated timber than the palette says,
 * and the palette entry stops describing anything. Worse, it is inconsistent: where a texture
 * cannot be built the same surface falls back to the flat, correct colour, so the two paths
 * would not agree about what the room looks like.
 *
 * Dividing the drawing by its own base turns it into a **modulation**: a pixel that matched the
 * base becomes white and multiplies to exactly the palette colour, a darker pixel darkens it in
 * the same proportion the drawing intended, and a lighter one lightens it. The pattern survives,
 * the colour goes back to being the palette's business, and the two paths differ by the pattern
 * alone — which is the whole of what a map is supposed to add.
 *
 * @param context - The context whose canvas holds the drawing.
 * @param base - The colour the drawing was laid over, which becomes white.
 */
function neutralise(context: CanvasRenderingContext2D, base: string): void {
  const image = context.getImageData(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);
  const channels = readChannels(base);
  for (let index = 0; index < image.data.length; index += CHANNELS_PER_PIXEL) {
    for (let channel = 0; channel < channels.length; channel += 1) {
      const divisor = channels[channel] ?? CHANNEL_MAX;
      const drawn = image.data[index + channel] ?? 0;
      image.data[index + channel] = Math.min(
        CHANNEL_MAX,
        Math.round((drawn * CHANNEL_MAX) / (divisor === 0 ? CHANNEL_MAX : divisor)),
      );
    }
  }
  context.putImageData(image, 0, 0);
}

/**
 * Wraps a finished canvas as a tiling texture, neutralised against the colour it was drawn over.
 *
 * @param context - The context whose canvas holds the drawing.
 * @param repeat - How many times it tiles across one face.
 * @param base - The family colour the drawing was laid over; see {@link neutralise}.
 * @returns The texture, in sRGB, wrapping in both directions.
 */
function toTexture(context: CanvasRenderingContext2D, repeat: number, base: string): CanvasTexture {
  neutralise(context, base);
  const texture = new CanvasTexture(context.canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.repeat.set(repeat, repeat);
  return texture;
}

/**
 * A flat-weave carpet: a dense, low-contrast grid with the fibre noise of a woven floor.
 *
 * Drawn as a warp and a weft of slightly varying lightness rather than as noise alone, because
 * a flat weave reads by its grid — that is what separates it from felt.
 *
 * @param repeat - How many times it tiles across one face; the furniture-scale default
 *   when omitted.
 * @returns The texture, or `undefined` under jsdom.
 */
export function createCarpetTexture(repeat: number = CARPET_REPEAT): CanvasTexture | undefined {
  const context = openCanvas();
  if (!context) {
    return undefined;
  }
  const random = seededRandom(0x0c_a7_9e_7a);
  context.fillStyle = PARIS_CARPET;
  context.fillRect(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);
  const thread = 8;
  for (let y = 0; y < TEXTURE_SIZE; y += thread) {
    for (let x = 0; x < TEXTURE_SIZE; x += thread) {
      // The checker is the weave; the jitter is the fibre.
      const warp = (x / thread + y / thread) % 2 === 0;
      const shade = (warp ? 214 : 188) + Math.round(random() * 14 - 7);
      context.fillStyle = `rgb(${String(shade)}, ${String(shade - 6)}, ${String(shade - 18)})`;
      context.fillRect(x, y, thread, thread);
    }
  }
  return toTexture(context, repeat, PARIS_CARPET);
}

/**
 * Unvarnished light oak: straight grain, with the occasional darker ray across it.
 *
 * @param repeat - How many times it tiles across one face; the furniture-scale default
 *   when omitted.
 * @returns The texture, or `undefined` under jsdom.
 */
export function createOakTexture(repeat: number = OAK_REPEAT): CanvasTexture | undefined {
  const context = openCanvas();
  if (!context) {
    return undefined;
  }
  const random = seededRandom(0x0a_c0_11_ea);
  context.fillStyle = PARIS_OAK;
  context.fillRect(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);
  for (let line = 0; line < TEXTURE_SIZE; line += 1) {
    // A grain line wavers by a pixel or two along its length; a ruler-straight one reads as
    // printed paper rather than as timber.
    const waver = Math.sin(line / 9) * 2 + random() * 2;
    const shade = 198 + Math.round(random() * 22);
    // Light and low-contrast on purpose: unvarnished oak is a pale timber, and a strong
    // grain at this scale reads as a dark tropical hardwood instead.
    context.fillStyle = `rgba(${String(shade - 30)}, ${String(shade - 52)}, ${String(shade - 80)}, 0.18)`;
    context.fillRect(0, line + waver, TEXTURE_SIZE, random() > 0.93 ? 2 : 1);
  }
  return toTexture(context, repeat, PARIS_OAK);
}

/**
 * Bouclé: the looped, knobbly upholstery the scheme is built on.
 *
 * Small overlapping arcs of near-white on cream. Density matters more than shape — the fabric
 * reads as texture at a distance and as loops only when you are standing over it.
 *
 * @param repeat - How many times it tiles across one face; the furniture-scale default
 *   when omitted.
 * @returns The texture, or `undefined` under jsdom.
 */
export function createBoucleTexture(repeat: number = BOUCLE_REPEAT): CanvasTexture | undefined {
  const context = openCanvas();
  if (!context) {
    return undefined;
  }
  const random = seededRandom(0x0b_00_c1_e5);
  context.fillStyle = PARIS_BOUCLE;
  context.fillRect(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);
  const loops = 1500;
  for (let loop = 0; loop < loops; loop += 1) {
    const x = random() * TEXTURE_SIZE;
    const y = random() * TEXTURE_SIZE;
    const radius = 3 + random() * 4;
    const light = random() > 0.5;
    context.strokeStyle = light ? 'rgba(255, 253, 248, 0.95)' : 'rgba(178, 166, 148, 0.85)';
    context.lineWidth = 1.6;
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.stroke();
  }
  return toTexture(context, repeat, PARIS_BOUCLE);
}

/**
 * White marble with cool veining, for the table tops.
 *
 * The veins are random walks rather than drawn curves: a vein that wanders is the one thing
 * that stops marble looking like printed stone.
 *
 * @param repeat - How many times it tiles across one face; the furniture-scale default
 *   when omitted.
 * @returns The texture, or `undefined` under jsdom.
 */
export function createMarbleTexture(repeat: number = MARBLE_REPEAT): CanvasTexture | undefined {
  const context = openCanvas();
  if (!context) {
    return undefined;
  }
  const random = seededRandom(0x0_1a_2b_1e);
  context.fillStyle = PARIS_MARBLE;
  context.fillRect(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);
  const veins = 9;
  for (let vein = 0; vein < veins; vein += 1) {
    let x = random() * TEXTURE_SIZE;
    let y = -10;
    context.strokeStyle = `rgba(150, 158, 168, ${String(0.15 + random() * 0.3)})`;
    context.lineWidth = 0.6 + random() * 1.6;
    context.beginPath();
    context.moveTo(x, y);
    while (y < TEXTURE_SIZE + 10) {
      x += random() * 10 - 5;
      y += 3 + random() * 5;
      context.lineTo(x, y);
    }
    context.stroke();
  }
  return toTexture(context, repeat, PARIS_MARBLE);
}
