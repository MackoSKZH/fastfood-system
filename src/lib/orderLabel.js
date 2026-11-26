export function isQrOrder(order) {
  return order?.zdroj === "qr";
}

export function isKioskOrder(order) {
  return order?.zdroj === "kiosk";
}

export function isTicketOrder(order) {
  return isQrOrder(order) || isKioskOrder(order);
}

export function orderHeadline(order) {
  if (isKioskOrder(order)) return `Kiosk #${order.orderNumber ?? "—"}`;
  if (isQrOrder(order)) return `QR #${order.orderNumber ?? "—"}`;
  return `Pípač #${order.vysielac ?? "—"}`;
}

export function hasPager(order) {
  return !isTicketOrder(order) && order?.vysielac != null && order.vysielac !== "";
}

export function pickupLabel(order) {
  if (isKioskOrder(order)) return "Kiosk";
  if (isQrOrder(order)) return "QR";
  return order?.vysielac ?? "—";
}

export function paymentLogFields(order) {
  const fields = {};
  if (order?.zdroj) fields.zdroj = order.zdroj;
  if (order?.platba) fields.platba = order.platba;
  const zaplatene = Number(order?.zaplatene);
  const vydaj = Number(order?.vydaj);
  if (order?.zaplatene != null && order.zaplatene !== "" && Number.isFinite(zaplatene)) {
    fields.zaplatene = zaplatene;
  }
  if (order?.vydaj != null && order.vydaj !== "" && Number.isFinite(vydaj)) {
    fields.vydaj = vydaj;
  }
  return fields;
}

export function QrVydaj({ order }) {
  if (!isTicketOrder(order)) return null;
  const vydaj = Number(order?.vydaj);
  const dal = Number(order?.zaplatene);
  if (!Number.isFinite(vydaj) || !Number.isFinite(dal)) return null;
  return (
    <div className="qr-staff-pay">
      <div className={`qr-staff-pay__vydaj${vydaj < 0 ? " is-short" : ""}`}>
        Vydať €{vydaj.toFixed(2)}
      </div>
      <div className="qr-staff-pay__detail">
        zákazník dal €{dal.toFixed(2)} · hotovosť pri výdaji
      </div>
    </div>
  );
}
