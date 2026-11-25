import { buildEscPosReceipt } from "./escposReceipt";

// Tlač priamo cez sériový port (Web Serial API) – funguje len na desktop
// Chrome/Edge. Užitočné na lokálne testovanie s tlačiarňou spárovanou
// klasickým Bluetooth priamo k PC (Windows z nej spraví virtuálny COM port).
// Na Androide Web Serial nie je podporovaný – tam sa použije RawBT (rawbtPrint.js).
let cachedPort = null;

export function isWebSerialSupported() {
  return typeof navigator !== "undefined" && !!navigator.serial;
}

export async function printCanvasViaWebSerial(canvas) {
  if (!isWebSerialSupported()) {
    throw new Error("Web Serial nie je podporovaný (funguje len desktop Chrome/Edge).");
  }
  if (!cachedPort) {
    cachedPort = await navigator.serial.requestPort();
  }
  if (!cachedPort.readable || !cachedPort.writable) {
    await cachedPort.open({ baudRate: 9600 });
  }
  const data = buildEscPosReceipt(canvas);
  const writer = cachedPort.writable.getWriter();
  try {
    await writer.write(data);
  } finally {
    writer.releaseLock();
  }
}
