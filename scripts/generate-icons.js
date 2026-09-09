const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// CRC32 implementation
function createCrcTable() {
  const table = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c;
  }
  return table;
}
const crcTable = createCrcTable();

function crc32(buf) {
  let crc = 0 ^ (-1);
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ buf[i]) & 0xFF];
  }
  return (crc ^ (-1)) >>> 0;
}

function makeChunk(type, data) {
  const len = data.length;
  const buf = Buffer.alloc(4 + 4 + len + 4);
  buf.writeUInt32BE(len, 0);
  buf.write(type, 4, 4, 'ascii');
  data.copy(buf, 8);
  const typeAndData = buf.subarray(4, 8 + len);
  buf.writeUInt32BE(crc32(typeAndData), 8 + len);
  return buf;
}

function encodePNG(width, height, rgbaBuffer) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData.writeUInt8(8, 8); // bit depth 8
  ihdrData.writeUInt8(6, 9); // RGBA
  ihdrData.writeUInt8(0, 10); // compression
  ihdrData.writeUInt8(0, 11); // filter
  ihdrData.writeUInt8(0, 12); // interlace
  const ihdrChunk = makeChunk('IHDR', ihdrData);

  // Scanlines with filter byte 0 (None)
  const scanlines = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    const scanlineOffset = y * (1 + width * 4);
    scanlines[scanlineOffset] = 0; // Filter None
    const rowDataOffset = y * width * 4;
    rgbaBuffer.copy(scanlines, scanlineOffset + 1, rowDataOffset, rowDataOffset + width * 4);
  }

  // IDAT (compressed scanlines)
  const compressed = zlib.deflateSync(scanlines, { level: 9 });
  const idatChunk = makeChunk('IDAT', compressed);

  // IEND
  const iendChunk = makeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

// Canvas-like rasterizer
class SimpleCanvas {
  constructor(size) {
    this.size = size;
    this.buffer = Buffer.alloc(size * size * 4); // RGBA
  }

  setPixel(x, y, r, g, b, a = 255) {
    if (x < 0 || x >= this.size || y < 0 || y >= this.size) return;
    const idx = (y * this.size + x) * 4;
    const srcA = a / 255;
    const dstA = this.buffer[idx + 3] / 255;
    const outA = srcA + dstA * (1 - srcA);
    if (outA > 0) {
      this.buffer[idx] = Math.round((r * srcA + this.buffer[idx] * dstA * (1 - srcA)) / outA);
      this.buffer[idx + 1] = Math.round((g * srcA + this.buffer[idx + 1] * dstA * (1 - srcA)) / outA);
      this.buffer[idx + 2] = Math.round((b * srcA + this.buffer[idx + 2] * dstA * (1 - srcA)) / outA);
      this.buffer[idx + 3] = Math.round(outA * 255);
    }
  }

  fillCircle(cx, cy, r, red, green, blue, alpha = 255) {
    const minX = Math.max(0, Math.floor(cx - r - 1));
    const maxX = Math.min(this.size - 1, Math.ceil(cx + r + 1));
    const minY = Math.max(0, Math.floor(cy - r - 1));
    const maxY = Math.min(this.size - 1, Math.ceil(cy + r + 1));

    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist <= r - 0.5) {
          this.setPixel(x, y, red, green, blue, alpha);
        } else if (dist <= r + 0.5) {
          const edgeAlpha = Math.round(alpha * (0.5 - (dist - r)));
          if (edgeAlpha > 0) {
            this.setPixel(x, y, red, green, blue, edgeAlpha);
          }
        }
      }
    }
  }

  fillRoundRect(x, y, w, h, radius, red, green, blue, alpha = 255) {
    const minX = Math.max(0, Math.floor(x));
    const maxX = Math.min(this.size - 1, Math.ceil(x + w));
    const minY = Math.max(0, Math.floor(y));
    const maxY = Math.min(this.size - 1, Math.ceil(y + h));

    for (let py = minY; py <= maxY; py++) {
      for (let px = minX; px <= maxX; px++) {
        const cx = px + 0.5;
        const cy = py + 0.5;

        let inside = false;
        let edgeFactor = 1.0;

        const left = x + radius;
        const right = x + w - radius;
        const top = y + radius;
        const bottom = y + h - radius;

        if (cx >= left && cx <= right && cy >= y && cy <= y + h) {
          inside = true;
        } else if (cy >= top && cy <= bottom && cx >= x && cx <= x + w) {
          inside = true;
        } else {
          let cornerX = cx < left ? left : right;
          let cornerY = cy < top ? top : bottom;
          const dx = cx - cornerX;
          const dy = cy - cornerY;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist <= radius - 0.5) {
            inside = true;
          } else if (dist <= radius + 0.5) {
            inside = true;
            edgeFactor = Math.max(0, Math.min(1, 0.5 - (dist - radius)));
          }
        }

        if (inside && edgeFactor > 0) {
          this.setPixel(px, py, red, green, blue, Math.round(alpha * edgeFactor));
        }
      }
    }
  }

  fillLine(x0, y0, x1, y1, width, red, green, blue, alpha = 255) {
    const length = Math.hypot(x1 - x0, y1 - y0);
    const steps = Math.ceil(length * 2);
    const halfW = width / 2;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = x0 + (x1 - x0) * t;
      const y = y0 + (y1 - y0) * t;
      this.fillCircle(x, y, halfW, red, green, blue, alpha);
    }
  }

  toBuffer() {
    return encodePNG(this.size, this.size, this.buffer);
  }
}

function renderIcon(size, isAlert = false) {
  const canvas = new SimpleCanvas(size);
  const s = size / 128; // scale factor

  // 1. Antennas for TV (Bilibili TV mascot style)
  canvas.fillLine(48 * s, 32 * s, 34 * s, 14 * s, 6 * s, 0, 161, 214, 255); // Left antenna #00A1D6
  canvas.fillLine(80 * s, 32 * s, 94 * s, 14 * s, 6 * s, 0, 161, 214, 255); // Right antenna
  canvas.fillCircle(34 * s, 14 * s, 4 * s, 0, 161, 214, 255);
  canvas.fillCircle(94 * s, 14 * s, 4 * s, 0, 161, 214, 255);

  // 2. Main TV Body (Rounded Rectangle in Bilibili Blue/Cyan)
  canvas.fillRoundRect(16 * s, 28 * s, 96 * s, 80 * s, 18 * s, 0, 161, 214, 255); // #00A1D6

  // 3. Inner Screen (White)
  canvas.fillRoundRect(24 * s, 36 * s, 80 * s, 64 * s, 12 * s, 255, 255, 255, 255);

  // 4. TV Stand / Feet
  canvas.fillRoundRect(36 * s, 108 * s, 18 * s, 8 * s, 4 * s, 0, 140, 190, 255);
  canvas.fillRoundRect(74 * s, 108 * s, 18 * s, 8 * s, 4 * s, 0, 140, 190, 255);

  // 5. Cute Bilibili-style Eyes / Play & Record Badge on screen
  // Left eye
  canvas.fillRoundRect(36 * s, 60 * s, 16 * s, 6 * s, 3 * s, 40, 50, 60, 255);
  // Right eye
  canvas.fillRoundRect(76 * s, 60 * s, 16 * s, 6 * s, 3 * s, 40, 50, 60, 255);

  // Center TV cheek dot
  canvas.fillCircle(64 * s, 72 * s, 5 * s, 251, 114, 153, 255); // Bilibili Pink #FB7299 cheek dot

  // Recording symbol (red dot indicator in top-left of screen)
  canvas.fillCircle(34 * s, 46 * s, 4 * s, 235, 50, 85, 255); // Red dot

  // 6. Yellow Alert Indicator if isAlert is true
  if (isAlert) {
    const alertCx = 96 * s;
    const alertCy = 30 * s;
    const alertRadius = 26 * s;

    // Dark border / shadow
    canvas.fillCircle(alertCx, alertCy, alertRadius + 3 * s, 30, 30, 30, 220);
    // Golden Yellow Badge: #FFB800 / #FFC107
    canvas.fillCircle(alertCx, alertCy, alertRadius, 255, 184, 0, 255);
    // Inner bright highlight
    canvas.fillCircle(alertCx, alertCy - 4 * s, alertRadius * 0.75, 255, 215, 50, 255);

    // Black exclamation mark "!" on yellow badge
    canvas.fillRoundRect(alertCx - 3.5 * s, alertCy - 15 * s, 7 * s, 18 * s, 3.5 * s, 20, 20, 20, 255);
    canvas.fillCircle(alertCx, alertCy + 9 * s, 4 * s, 20, 20, 20, 255);
  }

  return canvas.toBuffer();
}

const sizes = [16, 32, 48, 128];
const iconsDir = path.join(__dirname, '..', 'icons');

if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

sizes.forEach(size => {
  const normalPng = renderIcon(size, false);
  const normalPath = path.join(iconsDir, `icon-${size}.png`);
  fs.writeFileSync(normalPath, normalPng);
  console.log(`Generated: ${normalPath} (${size}x${size}, ${normalPng.length} bytes)`);

  const yellowPng = renderIcon(size, true);
  const yellowPath = path.join(iconsDir, `icon-yellow-${size}.png`);
  fs.writeFileSync(yellowPath, yellowPng);
  console.log(`Generated: ${yellowPath} (${size}x${size}, ${yellowPng.length} bytes)`);
});

console.log('All icons generated successfully!');
