// Reproducible original icon: a magnifier over a rounded square. No third-party artwork or logos.
// Usage: node scripts/generate-icons.mjs  ->  public/icon/{16,32,48,128}.png
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';

const crcTable = Array.from({ length: 256 }, (_, n) => { for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1; return n >>> 0; });
const crc = bytes => { let c = 0xffffffff; for (const b of bytes) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
  const out = Buffer.alloc(data.length + 12); out.writeUInt32BE(data.length, 0); out.write(type, 4, 'latin1'); data.copy(out, 8);
  out.writeUInt32BE(crc(out.subarray(4, out.length - 4)), out.length - 4); return out;
};
const clamp = v => Math.max(0, Math.min(1, v));
// Signed distances in a unit square (0..1).
const roundedBox = (x, y, r) => { const qx = Math.abs(x - 0.5) - (0.5 - r), qy = Math.abs(y - 0.5) - (0.5 - r); return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r; };
const segment = (x, y, ax, ay, bx, by) => { const px = x - ax, py = y - ay, dx = bx - ax, dy = by - ay; const t = clamp((px * dx + py * dy) / (dx * dx + dy * dy)); return Math.hypot(px - dx * t, py - dy * t); };

function render(size) {
  const rows = [];
  for (let py = 0; py < size; py++) {
    const row = Buffer.alloc(1 + size * 4);
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      const samples = 4;
      for (let sy = 0; sy < samples; sy++) for (let sx = 0; sx < samples; sx++) {
        const x = (px + (sx + 0.5) / samples) / size, y = (py + (sy + 0.5) / samples) / size;
        const inBox = roundedBox(x, y, 0.22) <= 0;
        if (!inBox) continue;
        // Background: indigo with a soft vertical gradient.
        let cr = 0x3d + (0x5c - 0x3d) * y, cg = 0x5a + (0x33 - 0x5a) * y, cb = 0xfe + (0xd9 - 0xfe) * y;
        const ring = Math.abs(Math.hypot(x - 0.43, y - 0.43) - 0.2) - 0.065;
        const handle = segment(x, y, 0.58, 0.58, 0.76, 0.76) - 0.075;
        const sparkle = Math.abs(x - 0.43) + Math.abs(y - 0.43) - 0.085; // diamond inside the lens
        if (Math.min(ring, handle) <= 0) { cr = cg = cb = 255; }
        else if (size >= 32 && sparkle <= 0) { cr = 0xff; cg = 0xd5; cb = 0x6b; }
        r += cr; g += cg; b += cb; a += 1;
      }
      const n = samples * samples;
      row[1 + px * 4] = a ? Math.round(r / a) : 0; row[2 + px * 4] = a ? Math.round(g / a) : 0;
      row[3 + px * 4] = a ? Math.round(b / a) : 0; row[4 + px * 4] = Math.round((a / n) * 255);
    }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(rows), { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
mkdirSync('public/icon', { recursive: true });
for (const size of [16, 32, 48, 128]) writeFileSync(`public/icon/${size}.png`, render(size));
console.log('public/icon/{16,32,48,128}.png written');
