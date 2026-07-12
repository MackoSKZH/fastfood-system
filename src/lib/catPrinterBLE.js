// BLE ovládač pre lacné "cat printer" klony (GB01/GB02/MX10/Phomemo M10 a pod.).
// Protokol reverzne inžinierovaný komunitou (napr. github.com/rbaron/catprinter, MIT),
// prenesený sem ako čisté bajtové konštanty potrebné na interoperabilitu.

export const SERVICE_UUIDS = [
  "0000ae30-0000-1000-8000-00805f9b34fb",
  "0000af30-0000-1000-8000-00805f9b34fb",
];
export const TX_CHARACTERISTIC_UUID = "0000ae01-0000-1000-8000-00805f9b34fb";
export const RX_CHARACTERISTIC_UUID = "0000ae02-0000-1000-8000-00805f9b34fb";

export const PRINT_WIDTH = 384;
export const PRINT_ROW_BYTES = PRINT_WIDTH / 8;

const CHUNK_SIZE = 20;
const CHUNK_DELAY_MS = 20;
const READY_TIMEOUT_MS = 15000;

const PRINTER_READY_NOTIFICATION = Uint8Array.of(0x51, 0x78, 0xae, 0x01, 0x01, 0x00, 0x00, 0x00, 0xff);

const u8 = (v) => v & 0xff;
const bytes = (arr) => Uint8Array.from(arr.map(u8));

// eslint-disable-next-line no-multi-spaces
const CHECKSUM_TABLE = bytes([
  0, 7, 14, 9, 28, 27, 18, 21, 56, 63, 54, 49, 36, 35, 42, 45, 112, 119, 126, 121,
  108, 107, 98, 101, 72, 79, 70, 65, 84, 83, 90, 93, -32, -25, -18, -23, -4, -5,
  -14, -11, -40, -33, -42, -47, -60, -61, -54, -51, -112, -105, -98, -103, -116,
  -117, -126, -123, -88, -81, -90, -95, -76, -77, -70, -67, -57, -64, -55, -50,
  -37, -36, -43, -46, -1, -8, -15, -10, -29, -28, -19, -22, -73, -80, -71, -66,
  -85, -84, -91, -94, -113, -120, -127, -122, -109, -108, -99, -102, 39, 32, 41,
  46, 59, 60, 53, 50, 31, 24, 17, 22, 3, 4, 13, 10, 87, 80, 89, 94, 75, 76, 69, 66,
  111, 104, 97, 102, 115, 116, 125, 122, -119, -114, -121, -128, -107, -110, -101,
  -100, -79, -74, -65, -72, -83, -86, -93, -92, -7, -2, -9, -16, -27, -30, -21, -20,
  -63, -58, -49, -56, -35, -38, -45, -44, 105, 110, 103, 96, 117, 114, 123, 124, 81,
  86, 95, 88, 77, 74, 67, 68, 25, 30, 23, 16, 5, 2, 11, 12, 33, 38, 47, 40, 61, 58,
  51, 52, 78, 73, 64, 71, 82, 85, 92, 91, 118, 113, 120, 127, 106, 109, 100, 99, 62,
  57, 48, 55, 34, 37, 44, 43, 6, 1, 8, 15, 26, 29, 20, 19, -82, -87, -96, -89, -78,
  -75, -68, -69, -106, -111, -104, -97, -118, -115, -124, -125, -34, -39, -48, -41,
  -62, -59, -52, -53, -26, -31, -24, -17, -6, -3, -12, -13,
]);

function chkSum(arr, offset, len) {
  let b2 = 0;
  for (let i = offset; i < offset + len; i++) {
    b2 = CHECKSUM_TABLE[(b2 ^ arr[i]) & 0xff];
  }
  return b2;
}

const CMD_GET_DEV_STATE = bytes([81, 120, -93, 0, 1, 0, 0, 0, -1]);
const CMD_SET_QUALITY_200_DPI = bytes([81, 120, -92, 0, 1, 0, 50, -98, -1]);
const CMD_LATTICE_START = bytes([81, 120, -90, 0, 11, 0, -86, 85, 23, 56, 68, 95, 95, 95, 68, 56, 44, -95, -1]);
const CMD_LATTICE_END = bytes([81, 120, -90, 0, 11, 0, -86, 85, 23, 0, 0, 0, 0, 0, 0, 0, 23, 17, -1]);
const CMD_SET_PAPER = bytes([81, 120, -95, 0, 2, 0, 48, 0, -7, -1]);

function cmdFeedPaper(howMuch) {
  const arr = bytes([81, 120, -67, 0, 1, 0, howMuch & 0xff, 0, 0xff]);
  arr[7] = chkSum(arr, 6, 1);
  return arr;
}

function cmdSetEnergy(val) {
  const arr = bytes([81, 120, -81, 0, 2, 0, (val >> 8) & 0xff, val & 0xff, 0, 0xff]);
  arr[8] = chkSum(arr, 6, 2);
  return arr;
}

function cmdApplyEnergy() {
  const arr = bytes([81, 120, -66, 0, 1, 0, 1, 0, 0xff]);
  arr[7] = chkSum(arr, 6, 1);
  return arr;
}

// row: Uint8Array/pole dĺžky PRINT_WIDTH, hodnoty 0/1 (1 = čierny bod).
function byteEncodeRow(row) {
  const out = new Uint8Array(PRINT_ROW_BYTES);
  for (let chunkStart = 0; chunkStart < row.length; chunkStart += 8) {
    let byte = 0;
    for (let bitIndex = 0; bitIndex < 8; bitIndex++) {
      if (row[chunkStart + bitIndex]) byte |= 1 << bitIndex;
    }
    out[chunkStart / 8] = byte;
  }
  return out;
}

function cmdPrintRow(row) {
  const encoded = byteEncodeRow(row);
  const arr = new Uint8Array(6 + encoded.length + 2);
  arr.set(bytes([81, 120, -94, 0, encoded.length, 0]), 0);
  arr.set(encoded, 6);
  arr[arr.length - 1] = 0xff;
  arr[arr.length - 2] = chkSum(arr, 6, encoded.length);
  return arr;
}

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

// rows: pole riadkov (každý PRINT_WIDTH hodnôt 0/1), zostaví celú tlačovú sekvenciu.
export function buildPrintImageCommand(rows, energy = 0xffff) {
  const chunks = [
    CMD_GET_DEV_STATE,
    CMD_SET_QUALITY_200_DPI,
    cmdSetEnergy(energy),
    cmdApplyEnergy(),
    CMD_LATTICE_START,
    ...rows.map(cmdPrintRow),
    cmdFeedPaper(25),
    CMD_SET_PAPER,
    CMD_SET_PAPER,
    CMD_SET_PAPER,
    CMD_LATTICE_END,
    CMD_GET_DEV_STATE,
  ];
  return concatBytes(chunks);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function bytesEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export class CatPrinter {
  constructor() {
    this.device = null;
    this.txChar = null;
    this.rxChar = null;
    this._readyResolve = null;
    this._onNotify = this._onNotify.bind(this);
    this._onDisconnected = this._onDisconnected.bind(this);
  }

  isSupported() {
    return typeof navigator !== "undefined" && !!navigator.bluetooth;
  }

  isConnected() {
    return !!(this.device && this.device.gatt && this.device.gatt.connected && this.txChar);
  }

  _onNotify(event) {
    const value = event.target.value;
    const arr = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    if (bytesEqual(arr, PRINTER_READY_NOTIFICATION) && this._readyResolve) {
      this._readyResolve();
      this._readyResolve = null;
    }
  }

  _onDisconnected() {
    this.txChar = null;
    this.rxChar = null;
  }

  async _setupGatt() {
    const server = await this.device.gatt.connect();
    let service = null;
    for (const uuid of SERVICE_UUIDS) {
      try {
        service = await server.getPrimaryService(uuid);
        break;
      } catch {
        // skús ďalší možný UUID
      }
    }
    if (!service) {
      throw new Error("Služba tlačiarne nenájdená – tlačiareň asi používa iný protokol.");
    }
    this.txChar = await service.getCharacteristic(TX_CHARACTERISTIC_UUID);
    this.rxChar = await service.getCharacteristic(RX_CHARACTERISTIC_UUID);
    await this.rxChar.startNotifications();
    this.rxChar.addEventListener("characteristicvaluechanged", this._onNotify);
    this.device.addEventListener("gattserverdisconnected", this._onDisconnected);
  }

  async connect() {
    if (!this.isSupported()) {
      throw new Error("Tento prehliadač nepodporuje Web Bluetooth (funguje len Chrome na Androide).");
    }
    this.device = await navigator.bluetooth.requestDevice({
      filters: SERVICE_UUIDS.map((uuid) => ({ services: [uuid] })),
      optionalServices: SERVICE_UUIDS,
    });
    await this._setupGatt();
  }

  async ensureConnected() {
    if (!this.device) {
      await this.connect();
      return;
    }
    if (!this.device.gatt.connected || !this.txChar) {
      await this._setupGatt();
    }
  }

  async printBitmap(rows) {
    await this.ensureConnected();
    const data = buildPrintImageCommand(rows);

    const readyPromise = new Promise((resolve, reject) => {
      this._readyResolve = resolve;
      setTimeout(() => {
        if (this._readyResolve) {
          this._readyResolve = null;
          reject(new Error("Tlačiareň neodpovedala včas – skontroluj, či je zapnutá a v dosahu."));
        }
      }, READY_TIMEOUT_MS);
    });

    for (let i = 0; i < data.length; i += CHUNK_SIZE) {
      const chunk = data.subarray(i, i + CHUNK_SIZE);
      if (this.txChar.writeValueWithoutResponse) {
        await this.txChar.writeValueWithoutResponse(chunk);
      } else {
        await this.txChar.writeValue(chunk);
      }
      await sleep(CHUNK_DELAY_MS);
    }

    await readyPromise;
  }

  disconnect() {
    if (this.device && this.device.gatt && this.device.gatt.connected) {
      this.device.gatt.disconnect();
    }
    this.device = null;
    this.txChar = null;
    this.rxChar = null;
  }
}

let sharedPrinter = null;
export function getPrinter() {
  if (!sharedPrinter) sharedPrinter = new CatPrinter();
  return sharedPrinter;
}
