import { buildEscPosReceipt } from "./escposReceipt";

// Tlač priamo cez sériový port (Web Serial API) – funguje len na desktop
// Chrome/Edge. Užitočné na lokálne testovanie s tlačiarňou spárovanou
// klasickým Bluetooth priamo k PC (Windows z nej spraví virtuálny COM port).
// Na Androide Web Serial nie je podporovaný – tam sa použije RawBT (rawbtPrint.js).
let cachedPort = null;

export function isWebSerialSupported() {
  return typeof navigator !== "undefined" && !!navigator.serial;
}

async function openPort(port) {
  if (!port.readable || !port.writable) {
    await port.open({ baudRate: 9600 });
  }
}

export async function prepareWebSerialPort() {
  if (!isWebSerialSupported()) return false;
  try {
    if (!cachedPort) {
      const ports = await navigator.serial.getPorts();
      cachedPort = ports[0] || null;
    }
    if (!cachedPort) return false;
    await openPort(cachedPort);
    return true;
  } catch (err) {
    console.warn("Sériový port sa nepodarilo otvoriť:", err);
    cachedPort = null;
    return false;
  }
}

export async function requestWebSerialPort() {
  if (!isWebSerialSupported()) {
    throw new Error("Web Serial nie je podporovaný. Na Androide použije kiosk RawBT.");
  }
  const port = await navigator.serial.requestPort();
  if (cachedPort && cachedPort !== port) {
    try { await cachedPort.close(); } catch {}
  }
  cachedPort = port;
  await openPort(cachedPort);
}

export async function printCanvasViaWebSerial(canvas, options = {}) {
  if (!isWebSerialSupported()) {
    throw new Error("Web Serial nie je podporovaný (funguje len desktop Chrome/Edge).");
  }
  if (!cachedPort) {
    const ports = await navigator.serial.getPorts();
    cachedPort = ports[0] || null;
  }
  if (!cachedPort) {
    cachedPort = await navigator.serial.requestPort();
  }
  await openPort(cachedPort);
  const data = buildEscPosReceipt(canvas, { cut: !!options.cut });
  const writer = cachedPort.writable.getWriter();
  try {
    await writer.write(data);
  } finally {
    writer.releaseLock();
  }
}
