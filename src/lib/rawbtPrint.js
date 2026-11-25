// Tlač cez appku RawBT (https://rawbt.ru) – nutná obchádzka pre klasické (nie BLE)
// Bluetooth ESC/POS tlačiarne typu MPT-II, ku ktorým sa z prehliadača nedá pripojiť
// priamo (Web Bluetooth API podporuje len BLE). RawBT musí byť na zariadení
// nainštalovaná a v jej vlastných nastaveniach musí byť vybraná/spárovaná tlačiareň.
export function printCanvasViaRawBT(canvas) {
  const dataUrl = canvas.toDataURL("image/png");
  const base64 = dataUrl.split(",")[1];
  window.location.href = `rawbt:data:image/png;base64,${base64}`;
}
