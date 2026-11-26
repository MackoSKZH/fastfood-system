import { get, onValue, ref, runTransaction } from "firebase/database";
import { db } from "../firebase";

export const ORDER_NUMBER_MAX = 100;

export class OrderNumbersFullError extends Error {
  constructor() {
    super("full");
    this.name = "OrderNumbersFullError";
    this.code = "full";
  }
}

export function isOrderNumber(value) {
  return Number.isInteger(value) && value >= 1 && value <= ORDER_NUMBER_MAX;
}

export function pickFree(last, busy) {
  const start = isOrderNumber(last) ? last : 0;
  const taken = busy && typeof busy === "object" ? busy : {};
  for (let step = 1; step <= ORDER_NUMBER_MAX; step++) {
    const n = ((start + step - 1) % ORDER_NUMBER_MAX) + 1;
    if ((Number(taken[String(n)]) || 0) <= 0) return n;
  }
  return null;
}

export function applyAllocate(current) {
  if (!current || typeof current !== "object") return null;
  const issued = pickFree(Number(current.n) || 0, current.busy);
  if (issued == null) return null;
  const busy = { ...(current.busy || {}) };
  const key = String(issued);
  busy[key] = (Number(busy[key]) || 0) + 1;
  return { n: issued, busy };
}

export function applyRelease(current, orderNumber) {
  if (!current || typeof current !== "object") return null;
  const n = Number(orderNumber);
  if (!isOrderNumber(n)) return null;
  const key = String(n);
  const count = Number(current.busy?.[key]) || 0;
  if (count <= 0) return null;
  const busy = { ...(current.busy || {}) };
  if (count <= 1) delete busy[key];
  else busy[key] = count - 1;
  return { n: current.n, busy };
}

function migratedCounter(current, busy) {
  if (current && typeof current === "object") return null;
  if (typeof current === "number") {
    return { n: isOrderNumber(current) ? current : 0, busy };
  }
  if (current == null) return { n: 0, busy };
  return null;
}

function counterRef(sessionCode) {
  return ref(db, `sessions/${sessionCode}/orderCounter`);
}

function watchCounter(sessionCode) {
  const node = counterRef(sessionCode);
  let off = () => {};
  let snap = null;
  const ready = new Promise((resolve, reject) => {
    off = onValue(node, (next) => {
      snap = next;
      resolve();
    }, reject);
  });
  return ready.then(() => ({
    node,
    value: () => snap?.val() ?? null,
    off: () => off(),
  }));
}

function addLive(busy, orderNumber) {
  const n = Number(orderNumber);
  if (!isOrderNumber(n)) return;
  const key = String(n);
  busy[key] = (busy[key] || 0) + 1;
}

async function collectLiveBusy(sessionCode) {
  const [ordersSnap, logSnap, prevzateSnap] = await Promise.all([
    get(ref(db, `sessions/${sessionCode}/objednavky`)),
    get(ref(db, `sessions/${sessionCode}/log`)),
    get(ref(db, `sessions/${sessionCode}/prevzate`)),
  ]);
  const orders = ordersSnap.val() || {};
  const prevzate = prevzateSnap.val() || {};
  const busy = {};
  Object.values(orders).forEach((order) => addLive(busy, order?.orderNumber));
  Object.entries(logSnap.val() || {}).forEach(([id, rec]) => {
    if (prevzate[id]) return;
    if (rec?.objednavkaId && orders[rec.objednavkaId]) return;
    addLive(busy, rec?.orderNumber);
  });
  return busy;
}

async function migrateOrderCounter(sessionCode) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const watched = await watchCounter(sessionCode);
    try {
      const current = watched.value();
      if (current && typeof current === "object") return;

      const busy = await collectLiveBusy(sessionCode);
      const res = await runTransaction(watched.node, (cur) => {
        const next = migratedCounter(cur, busy);
        if (!next) return;
        return next;
      });
      if (res.committed) return;
      const after = res.snapshot?.val();
      if (after && typeof after === "object") return;
    } finally {
      watched.off();
    }
  }
  throw new Error("counter");
}

export async function allocateOrderNumber(sessionCode) {
  for (let attempt = 0; attempt < 4; attempt++) {
    await migrateOrderCounter(sessionCode);
    const watched = await watchCounter(sessionCode);
    try {
      const res = await runTransaction(watched.node, (current) => {
        const next = applyAllocate(current);
        if (!next) return;
        return next;
      });
      if (res.committed) {
        const orderNumber = Number(res.snapshot.val()?.n);
        if (!isOrderNumber(orderNumber)) throw new Error("counter");
        return orderNumber;
      }
      const cur = res.snapshot?.val() ?? watched.value();
      if (cur && typeof cur === "object" && pickFree(Number(cur.n) || 0, cur.busy) == null) {
        throw new OrderNumbersFullError();
      }
    } finally {
      watched.off();
    }
  }
  throw new Error("counter");
}

export async function releaseOrderNumber(sessionCode, orderNumber) {
  const n = Number(orderNumber);
  if (!isOrderNumber(n)) return;
  const watched = await watchCounter(sessionCode);
  try {
    const res = await runTransaction(watched.node, (current) => {
      const next = applyRelease(current, n);
      if (!next) return;
      return next;
    });
    if (res.committed) return;
    const cur = res.snapshot?.val() ?? watched.value();
    if (!cur || typeof cur !== "object" || (Number(cur.busy?.[String(n)]) || 0) <= 0) return;
    await runTransaction(watched.node, (current) => {
      const next = applyRelease(current, n);
      if (!next) return;
      return next;
    });
  } finally {
    watched.off();
  }
}
