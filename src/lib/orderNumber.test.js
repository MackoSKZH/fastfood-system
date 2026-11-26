jest.mock("../firebase", () => ({ db: {} }));
jest.mock("firebase/database", () => ({
  ref: jest.fn(),
  get: jest.fn(),
  runTransaction: jest.fn(),
}));

const { applyAllocate, applyRelease, pickFree, ORDER_NUMBER_MAX } = require("./orderNumber");

function release(state, orderNumber) {
  return applyRelease(state, orderNumber) || state;
}

describe("pickFree", () => {
  test("pokračuje za posledným číslom", () => {
    expect(pickFree(26, {})).toBe(27);
    expect(pickFree(99, {})).toBe(100);
  });

  test("po 100 sa vráti na 1", () => {
    expect(pickFree(100, {})).toBe(1);
    expect(pickFree(0, {})).toBe(1);
  });

  test("preskočí obsadené čísla vrátane prechodu cez 100", () => {
    expect(pickFree(26, { 27: 1, 28: 2 })).toBe(29);
    expect(pickFree(99, { 100: 1, 1: 1 })).toBe(2);
    expect(pickFree(100, { 1: 1, 2: 1 })).toBe(3);
  });

  test("keď je obsadených všetkých 100, číslo nevydá", () => {
    const busy = {};
    for (let n = 1; n <= ORDER_NUMBER_MAX; n++) busy[n] = 1;
    expect(pickFree(40, busy)).toBeNull();
    expect(applyAllocate({ n: 40, busy })).toBeNull();
  });
});

describe("rada objednávok", () => {
  test("uvoľnenie zníži počet a až potom sa číslo môže zopakovať", () => {
    let state = { n: 5, busy: { 5: 2 } };
    state = release(state, 5);
    expect(state.busy[5]).toBe(1);
    expect(pickFree(4, state.busy)).not.toBe(5);
    state = release(state, 5);
    expect(state.busy[5]).toBeUndefined();
    expect(pickFree(4, state.busy)).toBe(5);
  });

  test("dve pridelenia za sebou nedostanú to isté živé číslo", () => {
    let state = applyAllocate({ n: 26, busy: { 12: 1 } });
    const first = state.n;
    state = applyAllocate(state);
    expect(state.n).not.toBe(first);
    expect(state.n).not.toBe(12);
    expect(state.busy[first]).toBeGreaterThan(0);
    expect(state.busy[state.n]).toBeGreaterThan(0);
  });

  test("pri 250 objednávkach sa živé čísla nikdy neprekrývajú", () => {
    let state = { n: 0, busy: {} };
    const open = [];
    for (let i = 0; i < 250; i++) {
      if (open.length >= ORDER_NUMBER_MAX) {
        expect(applyAllocate(state)).toBeNull();
        state = release(state, open.shift());
      }
      const next = applyAllocate(state);
      expect(next).not.toBeNull();
      expect(open).not.toContain(next.n);
      state = next;
      open.push(next.n);
      if (open.length > 7 && i % 3 === 0) state = release(state, open.shift());
    }
    expect(new Set(open).size).toBe(open.length);
    open.forEach((n) => expect(Number(state.busy[n]) || 0).toBeGreaterThan(0));
  });
});
