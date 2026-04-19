// Génère icons/icon16.png, icon48.png, icon128.png — aucune dépendance externe
const zlib = require("zlib");
const fs   = require("fs");
const path = require("path");

// CRC32 (requis par le format PNG)
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buf[i]) & 0xff];
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const buf = Buffer.alloc(12 + data.length);
  buf.writeUInt32BE(data.length, 0);
  buf.write(type, 4, "ascii");
  data.copy(buf, 8);
  buf.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, "ascii"), data])), 8 + data.length);
  return buf;
}

function makePNG(pixels, size) {
  const PNG_SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA

  // Scanlines with filter byte 0 (None)
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }

  return Buffer.concat([
    PNG_SIG,
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// Point-in-polygon (ray casting)
function inPolygon(px, py, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi)
      inside = !inside;
  }
  return inside;
}

function drawIcon(size) {
  const s      = size / 128;
  const radius = Math.round(24 * s);

  // Rounded rect mask
  function inRoundedRect(x, y) {
    const r = radius, n = size - 1;
    if (x < r     && y < r    ) return (x - r) ** 2 + (y - r) ** 2 <= r * r;
    if (x > n - r && y < r    ) return (x - (n - r)) ** 2 + (y - r) ** 2 <= r * r;
    if (x < r     && y > n - r) return (x - r) ** 2 + (y - (n - r)) ** 2 <= r * r;
    if (x > n - r && y > n - r) return (x - (n - r)) ** 2 + (y - (n - r)) ** 2 <= r * r;
    return true;
  }

  // Bolt points scaled from 128px reference
  const bolt = [[68,22],[26,73],[64,73],[60,107],[102,56],[64,56]].map(([x, y]) => [x * s, y * s]);

  const buf = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      if (!inRoundedRect(x, y)) {
        // transparent
      } else if (inPolygon(x + 0.5, y + 0.5, bolt)) {
        buf[i] = 0x58; buf[i+1] = 0xa6; buf[i+2] = 0xff; buf[i+3] = 255; // #58a6ff
      } else {
        buf[i] = 0x0d; buf[i+1] = 0x11; buf[i+2] = 0x17; buf[i+3] = 255; // #0d1117
      }
    }
  }
  return buf;
}

const dir = path.join(__dirname, "icons");
if (!fs.existsSync(dir)) fs.mkdirSync(dir);

for (const size of [16, 48, 128]) {
  const file = path.join(dir, `icon${size}.png`);
  fs.writeFileSync(file, makePNG(drawIcon(size), size));
  console.log(`✓ icons/icon${size}.png`);
}
