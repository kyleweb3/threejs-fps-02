// DUSTLINE — threejs-fps-02 — seeded randomness for dressing and bots.
// One seed always replays the same sequence, which keeps replays and
// headless checks reproducible.

export function mulberry32(initial) {
  let state = initial >>> 0;
  return function random() {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

// A small helper object around one mulberry32 stream.
export function makeRng(seed) {
  let next = mulberry32(seed);
  return {
    random() {
      return next();
    },
    reseed(s) {
      next = mulberry32(s);
    },
    range(min, max) {
      return min + next() * (max - min);
    },
    int(min, max) {
      return Math.floor(next() * (max - min + 1)) + min;
    },
    pick(list) {
      return list[Math.floor(next() * list.length)];
    },
    gauss() {
      return (next() + next() + next() - 1.5) * 1.15;
    },
  };
}
