import { ref, set } from "firebase/database";
import { db } from "../firebase";

export function writeQrStav(session, orderId, stav, orderNumber) {
  if (!session || !orderId) return Promise.resolve();
  const value = { stav };
  if (orderNumber != null && orderNumber !== "") value.orderNumber = orderNumber;
  return set(ref(db, `sessions/${session}/qrStav/${orderId}`), value);
}
