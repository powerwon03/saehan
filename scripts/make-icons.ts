import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { deflateSync } from 'node:zlib';

// npx tsx scripts/make-icons.ts — writes the PWA icons in public/icons (committed; rerun only to change the mark).
// The mark: dark rounded square, a white check over an amber line. Drawn with distance fields, 4×4 supersampled.

type RGB = [number, number, number];
const BG: RGB = [0x0f, 0x17, 0x2a]; // slate-900, same as theme_color
const CHECK: RGB = [0xff, 0xff, 0xff];
const LINE: RGB = [0xf5, 0x9e, 0x0b]; // amber-500
const SS = 4;

/** Distance from p to segment ab. */
function segment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}

/** Signed distance to a square [0,1]² with corner radius r (negative inside). */
function roundedSquare(x: number, y: number, r: number): number {
  const qx = Math.abs(x - 0.5) - (0.5 - r);
  const qy = Math.abs(y - 0.5) - (0.5 - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

/**
 * Colour at unit coordinates. `fullBleed`: opaque square edge to edge (maskable / Apple, the OS cuts the shape);
 * the mark is then shrunk into the maskable safe zone. Otherwise a transparent-cornered rounded square.
 */
function shade(x: number, y: number, fullBleed: boolean): [number, number, number, number] {
  if (!fullBleed && roundedSquare(x, y, 0.22) > 0) return [0, 0, 0, 0];
  const k = fullBleed ? 0.78 : 1; // content scale around the centre
  const u = 0.5 + (x - 0.5) / k;
  const v = 0.5 + (y - 0.5) / k;
  const check = Math.min(segment(u, v, 0.27, 0.47, 0.43, 0.62), segment(u, v, 0.43, 0.62, 0.73, 0.3)) < 0.055;
  const line = segment(u, v, 0.27, 0.77, 0.73, 0.77) < 0.04;
  const c = check ? CHECK : line ? LINE : BG;
  return [c[0], c[1], c[2], 255];
}

function render(size: number, fullBleed: boolean): Buffer {
  const rowBytes = size * 4 + 1;
  const raw = Buffer.alloc(rowBytes * size);
  for (let py = 0; py < size; py++) {
    raw[py * rowBytes] = 0; // filter: none
    for (let px = 0; px < size; px++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SS; sy++)
        for (let sx = 0; sx < SS; sx++) {
          const [cr, cg, cb, ca] = shade((px + (sx + 0.5) / SS) / size, (py + (sy + 0.5) / SS) / size, fullBleed);
          r += cr * ca;
          g += cg * ca;
          b += cb * ca;
          a += ca;
        }
      const o = py * rowBytes + 1 + px * 4;
      raw[o] = a ? Math.round(r / a) : 0;
      raw[o + 1] = a ? Math.round(g / a) : 0;
      raw[o + 2] = a ? Math.round(b / a) : 0;
      raw[o + 3] = Math.round(a / (SS * SS));
    }
  }
  return png(size, raw);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** 8-bit RGBA PNG from filtered scanlines. */
function png(size: number, raw: Buffer): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const out = path.resolve(process.cwd(), 'public/icons');
mkdirSync(out, { recursive: true });
const icons: [string, number, boolean][] = [
  ['icon-192.png', 192, false],
  ['icon-512.png', 512, false],
  ['icon-maskable-512.png', 512, true],
  ['apple-touch-icon.png', 180, true],
];
for (const [name, size, fullBleed] of icons) {
  writeFileSync(path.join(out, name), render(size, fullBleed));
  console.log(`public/icons/${name}`);
}
