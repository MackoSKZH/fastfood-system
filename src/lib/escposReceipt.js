// Zostavenie štandardného ESC/POS príkazu na tlač bločku ako rastrového obrázka
// (GS v 0) – MPT-II aj väčšina bežných "receipt" tlačiarní tomuto rozumejú priamo,
// bez potreby appky/tretej strany (na rozdiel od klasického Bluetooth cez telefón,
// kde to musí sprostredkovať RawBT).
const DARK_THRESHOLD = 200;

function concatBytes(chunks) {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

// row: pole 0/1 dĺžky `width` → zbalí do bajtov MSB-first (bit7 = najľavejší bod),
// presne podľa ESC/POS GS v 0 špecifikácie.
function byteEncodeRowMSB(row, widthBytes) {
  const out = new Uint8Array(widthBytes);
  for (let x = 0; x < row.length; x++) {
    if (row[x]) {
      out[x >> 3] |= 1 << (7 - (x % 8));
    }
  }
  return out;
}

export function buildEscPosReceipt(canvas, { cut = false } = {}) {
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  const imageData = ctx.getImageData(0, 0, width, height);
  const widthBytes = Math.ceil(width / 8);

  const raster = new Uint8Array(widthBytes * height);
  for (let y = 0; y < height; y++) {
    const row = new Uint8Array(width);
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const a = imageData.data[idx + 3];
      const luminance = a === 0 ? 255 : (imageData.data[idx] + imageData.data[idx + 1] + imageData.data[idx + 2]) / 3;
      row[x] = luminance < DARK_THRESHOLD ? 1 : 0;
    }
    raster.set(byteEncodeRowMSB(row, widthBytes), y * widthBytes);
  }

  const init = Uint8Array.of(0x1b, 0x40); // ESC @ – inicializácia
  const rasterHeader = Uint8Array.of(
    0x1d, 0x76, 0x30, 0x00, // GS v 0, mode 0 (bez zväčšenia)
    widthBytes & 0xff, (widthBytes >> 8) & 0xff,
    height & 0xff, (height >> 8) & 0xff
  );
  const feed = Uint8Array.of(0x1b, 0x64, 0x03); // ESC d 3 – posun papiera o 3 riadky
  const chunks = [init, rasterHeader, raster, feed];
  if (cut) chunks.push(Uint8Array.of(0x1d, 0x56, 0x42, 0x00)); // GS V 66 0 – čiastočný rez

  return concatBytes(chunks);
}
