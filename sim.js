'use strict';
// ============================================================================
//  Apis mellifera colony model — per-bee, per-cell agent simulation
//  Time step: 10 simulated minutes (foraging), hourly (colony), daily (season)
// ============================================================================
const COLS = 80, ROWS = 44, CPS = COLS * ROWS;          // one side of a Langstroth deep ≈ 3,500 cells
const FPB = 10, MAXBOX = 6, SIDES = MAXBOX * FPB * 2, NC = SIDES * CPS;
const ST = { EMPTY: 0, DIRTY: 1, EGG: 2, LARVA: 3, CAPPED: 4, NECTAR: 5, HONEY: 6, POLLEN: 7, QCELL: 8 };
// Development times in hours from egg laying: hatch, capping, emergence
const DEV = [
  { hatch: 72, cap: 216, emerge: 504 },   // worker: 3 d egg, 6 d larva, capped day 9, emerges day 21
  { hatch: 72, cap: 240, emerge: 576 },   // drone : 3 d egg, 7 d larva, capped day 10, emerges day 24
  { hatch: 72, cap: 192, emerge: 384 },   // queen : 3 d egg, 5 d larva, capped day 8, emerges day 16
];
const SUGAR_DENS = 1.59;                       // g/mL of dissolved sugar → cell volume model
const VOL_W = 280, VOL_D = 500;                // µL usable volume of worker / drone cell
const POLLEN_CAP_W = 150, POLLEN_CAP_D = 240;  // mg packed bee-bread per cell
const MAXB = 110000;
// hex neighbourhood offsets (rows are 'odd-r': odd rows shifted right). NBR[parity] = [[dr, dc, dist], ...] within distance 2
const NBR = (() => {
  const out = [[], []];
  for (const p of [0, 1]) {
    const r0 = 4 + p, c0 = 10, q0 = c0 - (r0 - (r0 & 1)) / 2;
    for (let dr = -2; dr <= 2; dr++) for (let dc = -3; dc <= 3; dc++) {
      if (!dr && !dc) continue;
      const r1 = r0 + dr, c1 = c0 + dc, q1 = c1 - (r1 - (r1 & 1)) / 2;
      const dq = q1 - q0, ds = -dq - dr, d = Math.max(Math.abs(dq), Math.abs(dr), Math.abs(ds));
      if (d <= 2) out[p].push([dr, dc, d]);
    }
  }
  return out;
})();
// candidate nest cavities a swarm might choose (Seeley: ideal ≈ 40 L, small entrance near the bottom, several metres up, south-facing)
const SITE_TYPES = ['Hollow oak', 'Hollow beech', 'Hollow ash', 'Old bee box', 'Wall cavity', 'Chimney', 'Barn roof void', 'Hollow willow', 'Church tower', 'Hollow maple', 'Shed floor void', 'Woodpecker-enlarged hollow'];
// seasonal egg-laying drive (mid-month); brood falls steeply after midsummer (Liebefeld data: Aug ≈ half the June peak, Oct ≈ 5%)
const MONTH_LAY = [0.05, 0.18, 0.42, 0.75, 1.0, 0.95, 0.72, 0.45, 0.24, 0.07, 0.01, 0.0];

// Forage plants (temperate ~45°N).  bloom = day-of-year window; nectar/pollen = peak supply to this colony (mg/h)
const FLORA = [
  { name: 'Crocus & snowdrops', s: 40, e: 85, conc: .35, nec: 1080, pol: 13860, col: '#ef7d14', d: .12 },
  { name: 'Hazel catkins', s: 25, e: 75, conc: 0, nec: 0, pol: 18900, col: '#e3cf63' },
  { name: 'Willow', s: 68, e: 112, conc: .33, nec: 16800, pol: 56700, col: '#f0c22c' },
  { name: 'Maple', s: 85, e: 125, conc: .3, nec: 14400, pol: 25200, col: '#c4c062' },
  { name: 'Dandelion meadow', s: 92, e: 150, conc: .4, nec: 31200, pol: 100800, col: '#f08a12' },
  { name: 'Cherry & apple orchard', s: 100, e: 135, conc: .35, nec: 36000, pol: 62999, col: '#e6dcb0' },
  { name: 'Horse chestnut', s: 115, e: 145, conc: .3, nec: 14400, pol: 37800, col: '#b3323a' },
  { name: 'Manuka Patch', s: 160, e: 198, conc: .45, nec: 102000, pol: 6000, col: '#8e8e86' },   // mānuka: 4–6 wk bloom; grey pollen loads, rarely packed
  { name: 'Hawthorn hedges', s: 125, e: 155, conc: .35, nec: 21600, pol: 31499, col: '#d8cc98' },
  { name: 'Black locust trees', s: 138, e: 162, conc: .45, nec: 132000, pol: 12600, col: '#d6c78a' },
  { name: 'Poppies', s: 140, e: 195, conc: 0, nec: 0, pol: 50400, col: '#2b2a38' },
  { name: 'White clover pasture', s: 150, e: 248, conc: .4, nec: 48000, pol: 62999, col: '#8a5a2b' },
  { name: 'Bramble', s: 160, e: 215, conc: .35, nec: 33600, pol: 44100, col: '#b9b8b0' },
  { name: 'Phacelia strip', s: 165, e: 228, conc: .35, nec: 30000, pol: 56700, col: '#3d61b8' },
  { name: 'Linden (lime) trees', s: 172, e: 200, conc: .4, nec: 120000, pol: 31499, col: '#ebe3a6' },
  { name: 'Fireweed', s: 185, e: 245, conc: .35, nec: 33600, pol: 37800, col: '#6b7fa8' },
  { name: 'Sunflower field', s: 195, e: 245, conc: .4, nec: 48000, pol: 94500, col: '#f2b705' },
  { name: 'Goldenrod', s: 222, e: 285, conc: .4, nec: 42000, pol: 75600, col: '#e3b400' },
  { name: 'Asters', s: 240, e: 295, conc: .3, nec: 16800, pol: 50400, col: '#e8c449' },
  { name: 'Ivy', s: 258, e: 318, conc: .45, nec: 45600, pol: 94500, col: '#f5a623' },
];

function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const DEG = Math.PI / 180;

class Hive {
  constructor(opts = {}) {
    this.seed = opts.seed || 12345;
    this.rand = mulberry32(this.seed);
    this.lat = opts.lat || 45;
    this.allowSwarm = opts.allowSwarm !== false;
    this.log = [];
    // ---- cells
    this.st = new Uint8Array(NC); this.caste = new Uint8Array(NC); this.age = new Float32Array(NC);
    this.sugar = new Float32Array(NC); this.water = new Float32Array(NC); this.pol = new Float32Array(NC);
    this.pcol = new Uint8Array(NC); this.droneCell = new Uint8Array(NC); this.drawn = new Uint8Array(NC);
    this.sideStats = new Float32Array(SIDES * 8);
    // ---- bees
    this.alive = new Uint8Array(MAXB); this.btype = new Uint8Array(MAXB); this.bage = new Float32Array(MAXB);
    this.wear = new Float32Array(MAXB); this.frail = new Float32Array(MAXB); this.ftask = new Uint8Array(MAXB); this.fstate = new Uint8Array(MAXB);
    this.patch = new Int16Array(MAXB).fill(-1); this.timer = new Float32Array(MAXB); this.tripMin = new Float32Array(MAXB);
    this.fuel = new Float32Array(MAXB); this.recruit = new Uint8Array(MAXB);
    this.free = []; this.nb = 0;
    this.queenCells = [];
    this.init(opts.startDoy || 59);
  }
  rnd() { return this.rand(); }
  say(msg, kind = '') { this.log.push({ t: this.t, msg, kind }); if (this.log.length > 300) this.log.shift(); }

  // ---------------------------------------------------------------- geometry
  sideOf(i) { return (i / CPS) | 0; }
  boxOf(i) { return (i / (CPS * 20)) | 0; }
  buildOrders() {
    const n = this.nBoxes * 20 * CPS;
    const bk = new Float32Array(n), hk = new Float32Array(n), dk = new Float32Array(n);
    const cx = 39.5, cy = 42, cz = 4.5 * 6.5;
    this.X3 = new Float32Array(n); this.Y3 = new Float32Array(n); this.Z3 = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const side = (i / CPS) | 0, b = (side / 20) | 0, f = ((side % 20) / 2) | 0, s = side & 1;
      const k = i % CPS, r = (k / COLS) | 0, c = k % COLS;
      const yUp = b * ROWS + (ROWS - 1 - r);
      const z = f * 6.5 + (s ? 1.2 : -1.2);
      this.X3[i] = c; this.Y3[i] = yUp; this.Z3[i] = z;
      const dx = c - cx, dy = (yUp - cy) * 1.15, dz = z - cz;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      bk[i] = d + this.hash(i) * 1.5;                           // used only for the initial (post-winter) layout
      hk[i] = -(d + 0.9 * (yUp - cy)) + this.hash(i * 7) * 2;
      dk[i] = b * 10000 + Math.abs(f - 4.5) * 40 + r * 1.0 + Math.abs(c - 39.5) * 0.5 + this.hash(i * 3) * 2;   // comb is drawn from the top bar down, central frames first
    }
    const idx = () => { const a = new Int32Array(n); for (let i = 0; i < n; i++) a[i] = i; return a; };
    this.broodOrder = idx().sort((a, b) => bk[a] - bk[b]);
    this.honeyOrder = idx().sort((a, b) => hk[a] - hk[b]);
    this.drawOrder = idx().sort((a, b) => dk[a] - dk[b]);
    this.nActive = n;
  }
  // fraction of the (up to 18) cells within two cells' distance on the same comb face that hold brood
  broodDensity(i) {
    const side = (i / CPS) | 0, k = i - side * CPS, r = (k / COLS) | 0, c = k - r * COLS, base = side * CPS, st = this.st;
    let n = 0, tot = 0;
    for (const o of NBR[r & 1]) {
      const rr = r + o[0], cc = c + o[1]; if (rr < 0 || rr >= ROWS || cc < 0 || cc >= COLS) continue;
      tot++; const v = st[base + rr * COLS + cc]; if (v === ST.EGG || v === ST.LARVA || v === ST.CAPPED) n++;
    }
    return tot ? n / tot : 0;
  }
  hasBroodNear(i) {
    const side = (i / CPS) | 0, k = i - side * CPS, r = (k / COLS) | 0, c = k - r * COLS, base = side * CPS, st = this.st;
    for (const o of NBR[r & 1]) {
      const rr = r + o[0], cc = c + o[1]; if (rr < 0 || rr >= ROWS || cc < 0 || cc >= COLS) continue;
      const v = st[base + rr * COLS + cc]; if (v === ST.EGG || v === ST.LARVA || v === ST.CAPPED) return true;
    }
    return false;
  }
  // How unsuitable a cell is for worker brood because it is cool: the lowest rows of the bottom box (furthest from
  // the rising heat of the cluster, nearest the cold air at the floor) and the entrance end of those rows. Bees keep
  // worker brood in the warm core; the bottom edge holds drone comb, pollen or stays empty. Colder weather widens it.
  coolPenalty(i) {
    const k = i % CPS, r = (k / COLS) | 0, c = k % COLS, up = ROWS - 1 - r, b = this.boxOf(i);
    const cold = this.Tout < 10 ? 1 : this.Tout < 20 ? 0.92 : 0.85;
    if (b === 0) {
      let p = up < 6 ? Math.min(1, (6 - up) / 4) : 0;                      // bottom ~3 cm of the comb
      if (c < 14 && up < 16) p = Math.max(p, ((16 - up) / 16) * ((14 - c) / 14));   // entrance end
      return Math.min(0.97, p * cold);
    }
    if (b === 1 && up < 2) return 0.25 * cold;                              // bottom edge of the upper box (cluster spans the gap)
    return 0;
  }
  dist3(i, P) { const dx = this.X3[i] - P.x, dy = (this.Y3[i] - P.y) * 1.15, dz = this.Z3[i] - P.z; return Math.sqrt(dx * dx + dy * dy + dz * dz); }
  hash(i) { let x = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b); x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae35); x ^= x >>> 16; return (x >>> 0) / 4294967296; }

  // ---------------------------------------------------------------- bees
  addBee(type, age, wear) {
    let i = this.free.length ? this.free.pop() : (this.nb < MAXB ? this.nb++ : -1);
    if (i < 0) return -1;
    this.alive[i] = 1; this.btype[i] = type; this.bage[i] = age; this.wear[i] = wear;
    // individual variation in robustness: lifespans of bees of the same age and job differ widely, so cohorts die off
    // over weeks rather than on the same day
    { const R = this.rand; this.frail[i] = Math.exp(0.3 * (R() + R() + R() - 1.5) * 2); }
    this.ftask[i] = 0; this.fstate[i] = 0; this.patch[i] = -1; this.timer[i] = 0; this.recruit[i] = 0;
    if (type === 0) this.nWorkers++; else this.nDrones++;
    return i;
  }
  killBee(i) {
    if (!this.alive[i]) return;
    if (this.fstate[i] === 1) this.unflight(i);
    this.alive[i] = 0; this.free.push(i);
    if (this.btype[i] === 0) this.nWorkers--; else this.nDrones--;
    this.deathsToday++;
  }
  unflight(i) {
    const p = this.patch[i], t = this.ftask[i];
    if (t === 4) this.flyScout--; else if (t === 3) this.flyW--; else if (p >= 0) { if (t === 2) this.flyP[p]--; else this.flyN[p]--; }
    this.fstate[i] = 0;
  }

  // ---------------------------------------------------------------- setup
  init(startDoy) {
    const R = () => this.rnd();
    this.t = startDoy * 24 + 7;   // hours since Jan 1, year 1
    this.nBoxes = 2; this.excluder = false;
    this.nWorkers = 0; this.nDrones = 0;
    // comb: drone comb at the lower corners of every frame, all deeps drawn
    for (let i = 0; i < NC; i++) {
      const k = i % CPS, r = (k / COLS) | 0, c = k % COLS;
      const edge = 34 + ((this.hash(i % COLS + 999) * 3) | 0);
      this.droneCell[i] = (r >= edge && (c < 12 + (this.hash(r) * 3 | 0) || c >= 67 - (this.hash(r + 50) * 3 | 0))) ? 1 : 0;
      this.drawn[i] = this.boxOf(i) < 2 ? 1 : 0;
    }
    this.buildOrders();
    this.broodList = new Int32Array(NC); this.foodList = new Int32Array(NC); this.pollenList = new Int32Array(NC); this.dirtyList = new Int32Array(NC);
    this.nBrood = 0; this.nFood = 0; this.nPol = 0; this.nDirty = 0;
    this.nestC = { x: 39.5, y: 42, z: 4.5 * 6.5 };      // brood-nest / cluster centre (moves with the brood)
    this.virgins = []; this.castMode = false; this.casts = 0; this.swarms = []; this.piping = { toot: false, quack: 0 };
    // patches
    this.patches = FLORA.map((f, k) => {
      const dist = f.d || (0.25 + 3.4 * Math.pow(R(), 1.2));
      const az = R() * 360;
      return Object.assign({}, f, { id: k, dist, az, x: Math.sin(az * DEG) * dist, y: -Math.cos(az * DEG) * dist, bloom: 0, nStock: 0, pStock: 0 });
    });
    // candidate nest cavities around the apiary for swarms to find
    this.nestSites = [];
    for (let k = 0; k < 26; k++) {
      const dist = 0.15 + 4.6 * Math.pow(R(), 1.1), az = R() * 360;
      const vol = Math.exp(Math.log(35) + 0.75 * ((R() + R() + R() - 1.5) * 1.4)), ent = Math.exp(Math.log(18) + 0.9 * ((R() + R() + R() - 1.5) * 1.4));
      const height = 0.5 + R() * 11, facing = R() * 360;
      const fv = Math.exp(-Math.pow(Math.log(vol / 40), 2) / (2 * 0.45 * 0.45));
      const fe = Math.exp(-Math.pow(Math.log(ent / 15), 2) / (2 * 0.8 * 0.8));
      const fh = clamp(0.45 + 0.07 * height, 0.45, 1), fs = 0.85 + 0.15 * Math.cos((facing - 180) * DEG);
      const fd = dist < 0.3 ? 0.6 : 1;
      this.nestSites.push({ id: k, name: SITE_TYPES[(R() * SITE_TYPES.length) | 0], dist, az, x: Math.sin(az * DEG) * dist, y: -Math.cos(az * DEG) * dist,
        vol, ent, height, facing, q: clamp(fv * fe * fh * fs * fd, 0, 1), occupied: false });
    }
    const waz = R() * 360;
    this.creek = { name: 'Creek', dist: 0.35, az: waz, x: Math.sin(waz * DEG) * .35, y: -Math.cos(waz * DEG) * .35 };
    const NP = this.patches.length;
    this.flyN = new Int32Array(NP); this.flyP = new Int32Array(NP); this.flyW = 0; this.flyScout = 0; this.flyDrones = 0;
    this.danceN = new Float32Array(NP); this.danceP = new Float32Array(NP);
    this.inPollen = new Float32Array(NP);
    // queen
    this.queen = { present: true, mated: true, ageD: 365, laying: true, virgin: false, vAge: 0, flights: 0, layFrom: 0, droneLayer: false };
    this.queenlessH = 0; this.layingWorkers = false; this.swarmPrep = false; this.swarmEvent = null;
    this.broodOnset = true; this.winterDrive = 0.4;                      // started in late winter
    // buffers & counters
    this.inSugar = 0; this.inWater = 0; this.feeder = 0; this.waterStore = 0; this.fuelSugar = 0; this.eggAcc = 0;
    this.idleDays = 0; this.landN = 0; this.departN = 0; this.landRate = 0; this.departRate = 0; this.onset = 21; this.danceThr = 0.12; this.unloadDelay = 1; this.landingsH = 0; this.storageFull = false;
    this.pollenNeed = 0.5; this.waterNeedF = 0; this.evapFrac = 0.05;
    this.day = Math.floor(this.t / 24); this.anom = 0;
    this.history = []; this.resetDay();
    this.genWeather(this.day % 365);
    // brood: queen has been ramping up since late January
    for (let k = 23; k >= 0; k--) {
      const n = Math.round(Math.max(60, 380 - 13 * k));
      let placed = 0;
      for (let j = 0; j < this.nActive && placed < n; j++) {
        const i = this.broodOrder[j];
        if (this.st[i] !== ST.EMPTY || this.droneCell[i]) continue;
        const a = k * 24 + R() * 24; if (a >= 504) { placed++; continue; }
        this.st[i] = a < 72 ? ST.EGG : a < 216 ? ST.LARVA : ST.CAPPED; this.caste[i] = 0; this.age[i] = a; placed++;
      }
    }
    // stores: ~14 kg honey left after winter (spring build-up burns ~5 kg a month before the first flows), a little bee-bread
    let honey = 14e6;
    for (let j = 0; j < this.nActive && honey > 0; j++) {
      const i = this.honeyOrder[j]; if (!this.drawn[i] || this.st[i] !== ST.EMPTY) continue;
      const m = this.droneCell[i] ? 720 : 402;
      this.st[i] = ST.HONEY; this.sugar[i] = m * .82; this.water[i] = m * .18; honey -= m;
    }
    this.placePollen(-1, 900e3, 0);
    for (let i = 0; i < NC; i++) if (this.st[i] === ST.POLLEN && this.pcol[i] === 0) this.pcol[i] = 1 + (this.hash(i) * 2 | 0);
    // ~11,000 overwintered workers ("winter bees", physiologically worn)
    for (let k = 0; k < 11000; k++) this.addBee(0, 110 + R() * 70, 0.35 + R() * 0.35);
    this.hourly(true);
    // the queen starts on a brood cell in the middle of the nest
    const q0 = this.nBrood ? this.broodList[(this.nBrood / 2) | 0] : this.broodOrder[0];
    this.qpos = { i: q0 }; this.queenSide = this.sideOf(q0);
  }

  // ---------------------------------------------------------------- environment
  get hour() { return this.t % 24; }
  get doy() { return Math.floor(this.t / 24) % 365; }
  get year() { return Math.floor(this.t / 24 / 365) + 1; }
  decl(doy) { return 23.44 * Math.sin(2 * Math.PI * (284 + doy) / 365); }
  dayLength(doy) {
    const x = -Math.tan(this.lat * DEG) * Math.tan(this.decl(doy) * DEG);
    return 2 * Math.acos(clamp(x, -1, 1)) / DEG / 15;
  }
  sunPos(doy, h) {
    const d = this.decl(doy) * DEG, phi = this.lat * DEG, H = 15 * (h - 12) * DEG;
    const el = Math.asin(Math.sin(phi) * Math.sin(d) + Math.cos(phi) * Math.cos(d) * Math.cos(H));
    const A = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(d) * Math.cos(phi));
    return { el: el / DEG, az: (A / DEG + 180 + 360) % 360 };
  }
  genWeather(doy) {
    const R = () => this.rnd(); const g = () => (R() + R() + R() + R() - 2) * 1.73;
    this.anom = 0.72 * this.anom + 2.4 * g();
    const base = 11 - 10.5 * Math.cos(2 * Math.PI * (doy - 18) / 365);
    const pRain = 0.31 + 0.14 * Math.cos(2 * Math.PI * (doy - 15) / 365);
    const rain = R() < pRain;
    this.wx = {
      mean: base + this.anom - (rain ? 1.5 : 0),
      amp: (4 + 3.5 * Math.max(0, Math.sin(2 * Math.PI * (doy - 80) / 365)) + 1) * (rain ? 0.6 : 1),
      rain, rs: R() * 20, rl: 2 + R() * 12, cloud: rain ? 0.9 : R() * 0.7,
    };
  }
  tempAt(h) { return this.wx.mean + this.wx.amp * Math.cos(2 * Math.PI * (h - 15) / 24); }
  updateEnv() {
    const h = this.hour, doy = this.doy;
    this.Tout = this.tempAt(h);
    this.raining = this.wx.rain && h >= this.wx.rs && h < this.wx.rs + this.wx.rl;
    const dl = this.dayLength(doy); this.sunrise = 12 - dl / 2; this.sunset = 12 + dl / 2;
    this.isDay = h > this.sunrise + 0.4 && h < this.sunset - 0.4;
    const sp = this.sunPos(doy, h); this.sunAz = sp.az; this.sunEl = sp.el;
    this.canFly = this.isDay && this.Tout >= 12 && !this.raining;
  }
  updatePatches(dtH) {
    const doy = this.doy, h = this.hour, T = this.Tout;
    const tf = clamp((T - 8) / 10, 0, 1) * (T > 32 ? 0.7 : 1);
    const dn = Math.max(0, Math.sin(Math.PI * (h - 6) / 14));
    const dp = Math.max(0, Math.sin(Math.PI * (h - 6) / 11));
    for (const p of this.patches) {
      let b = 0;
      if (doy >= p.s && doy <= p.e) b = Math.pow(Math.sin(Math.PI * (doy - p.s) / (p.e - p.s)), 0.6);
      if (this.frostKill && p.s < doy) b *= 0.3;
      p.bloom = b;
      const nCap = p.nec * b * 3 + 1, pCap = p.pol * b * 3 + 1;
      p.nCap = nCap; p.pCap = pCap;
      p.nStock = Math.min(nCap, p.nStock + p.nec * b * dn * tf * dtH * (this.raining ? 0 : 1));
      p.pStock = Math.min(pCap, p.pStock + p.pol * b * dp * tf * dtH * (this.raining ? 0 : 1));
      if (this.raining) { p.nStock *= Math.pow(0.85, dtH); p.pStock *= Math.pow(0.8, dtH); }
    }
  }

  // ---------------------------------------------------------------- main loop
  advance(hours, budgetMs = 30) {
    const t0 = (typeof performance !== 'undefined' ? performance : Date).now();
    const dt = 10 / 60; let done = 0;
    while (done < hours - 1e-9) {
      this.tick(dt); done += dt;
      if ((typeof performance !== 'undefined' ? performance : Date).now() - t0 > budgetMs) break;
    }
    return done;
  }
  tick(dt) {
    const prevH = Math.floor(this.t + 1e-6);
    this.t += dt;
    const nowH = Math.floor(this.t + 1e-6);
    this.updateEnv();
    this.updatePatches(dt);
    const l0 = this.landN, d0 = this.departN;
    this.forage(dt * 60);
    // entrance traffic over the last tick (bees per simulated second), for the entrance view
    this.landRate = (this.landN - l0) / (dt * 3600); this.departRate = (this.departN - d0) / (dt * 3600);
    if (nowH !== prevH) {
      const d = Math.floor(nowH / 24);
      if (d !== this.day) this.daily(d);
      this.hourly(false);
    }
  }

  // ---------------------------------------------------------------- foraging (10-min tick)
  forage(dtMin) {
    const NP = this.patches.length;
    const out = this.flyScout + this.flyW + this.flyN.reduce((a, b) => a + b, 0) + this.flyP.reduce((a, b) => a + b, 0);
    if (!this.canFly && out === 0) { this.danceN.fill(0); this.danceP.fill(0); return; }
    const dN = this.danceN, dP = this.danceP;
    let totN = 0, totP = 0; for (let p = 0; p < NP; p++) { totN += dN[p]; totP += dP[p]; }
    const tot = totN + totP;
    const newN = new Float32Array(NP), newP = new Float32Array(NP);
    const pFollow = this.canFly ? Math.min(0.4, tot / (tot + 350)) : 0;
    const pScout = this.canFly ? (tot < 30 ? 0.03 : 0.004) : 0;
    const pWater = this.canFly ? this.waterNeedF * 0.08 : 0;
    const onset = this.onset, R = this.rand;
    for (let i = 0; i < this.nb; i++) {
      if (!this.alive[i] || this.btype[i] !== 0) continue;
      if (this.fstate[i] === 1) {
        this.timer[i] -= dtMin;
        if (this.timer[i] <= 0) this.land(i, newN, newP);
        continue;
      }
      if (this.bage[i] < onset) continue;
      if (this.timer[i] > 0) { this.timer[i] -= dtMin; continue; }
      if (!this.canFly) continue;
      const p = this.patch[i];
      if (p >= 0 && this.ftask[i] !== 4) {
        if (this.ftask[i] === 3 || this.patches[p].bloom > 0.02) { this.startTrip(i); continue; }
        this.patch[i] = -1; this.ftask[i] = 0;
      }
      const r = R();
      if (r < pFollow) {
        let x = R() * tot, chosen = -1, pol = false;
        for (let q = 0; q < NP && chosen < 0; q++) { x -= dN[q]; if (x <= 0) chosen = q; else { x -= dP[q]; if (x <= 0) { chosen = q; pol = true; } } }
        if (chosen < 0) chosen = 0;
        this.patch[i] = chosen; this.ftask[i] = pol ? 2 : 1; this.recruit[i] = 1;
        this.startTrip(i);
      } else if (r < pFollow + pScout) {
        this.ftask[i] = 4; this.patch[i] = -1; this.startTrip(i);
      } else if (r < pFollow + pScout + pWater) {
        this.ftask[i] = 3; this.patch[i] = 0; this.startTrip(i);
      } else this.timer[i] = 10 + R() * 30;   // idle on the comb ("reserve" foragers)
    }
    this.danceN = newN; this.danceP = newP;
  }
  startTrip(i) {
    const R = this.rand, t = this.ftask[i];
    let trip, fuel, dist;
    if (t === 4) { trip = 30 + R() * 60; dist = 1.5; fuel = 3; this.flyScout++; }
    else if (t === 3) { dist = this.creek.dist; trip = dist * 4.8 + 4 + R() * 3; fuel = dist * 1.0; this.flyW++; }
    else {
      const P = this.patches[this.patch[i]]; dist = P.dist;
      const A = t === 2 ? P.pStock / P.pCap : P.nStock / P.nCap;
      const handling = t === 2 ? 10 + 22 * (1 - A) : 16 + 32 * (1 - A);
      trip = dist * 4.8 + handling * (0.8 + R() * 0.4);   // 25 km/h cruising
      if (this.recruit[i]) trip *= 1.3;                     // recruits must search for the site
      fuel = dist * 2 * 0.5 + handling * 0.04;             // ≈0.5 mg sugar per km of flight
      if (t === 2) this.flyP[this.patch[i]]++; else this.flyN[this.patch[i]]++;
    }
    this.fuelSugar += fuel;
    this.fstate[i] = 1; this.timer[i] = trip; this.tripMin[i] = trip; this.fuel[i] = fuel;
    this.wear[i] += this.frail[i] * (dist * 2 + trip * 0.08) / 800;        // ~800 km lifetime flight budget
    this.tripsToday++; this.departN++;
  }
  land(i, newN, newP) {
    const R = this.rand, t = this.ftask[i], p = this.patch[i];
    this.unflight(i);
    // flight hazards: predators, cold-stunning, getting caught in rain
    let risk = 0.003 + (this.Tout < 13 ? 0.01 : 0) + (this.raining ? 0.03 : 0);
    if (R() < risk) { this.killBee(i); this.lostForagers++; return; }
    const trip = this.tripMin[i];
    this.landingsH++; this.landN++;
    let rest = 1 + this.unloadDelay + R() * 3;
    if (t === 4) {   // scout: did she find something?
      let tot = 0; const w = this.patches.map(P => { const v = P.bloom > 0.05 ? P.bloom * (P.nec + P.pol) / Math.pow(P.dist + 0.3, 2) : 0; tot += v; return v; });
      if (tot > 0 && R() < 0.45) {
        let x = R() * tot, q = 0; for (; q < w.length - 1; q++) { x -= w[q]; if (x <= 0) break; }
        const P = this.patches[q];
        const wantPollen = P.pol > 0 && (P.nec === 0 || R() < this.pollenNeed * 0.8);
        this.patch[i] = q; this.ftask[i] = wantPollen ? 2 : 1;
      } else { this.ftask[i] = 0; this.patch[i] = -1; }
      this.timer[i] = rest; return;
    }
    if (t === 3) {   // water
      this.waterStore += 30; this.waterToday += 30;
      if (this.waterNeedF < 0.05 && R() < 0.4) { this.ftask[i] = 0; this.patch[i] = -1; }
      this.timer[i] = rest; return;
    }
    const P = this.patches[p];
    if (this.recruit[i]) { this.recruit[i] = 0; if (R() < 0.25) { this.patch[i] = -1; this.ftask[i] = 0; this.timer[i] = rest; return; } }
    let abandon;
    if (t === 2) {
      // no cell near the brood to pack her loads into: she can't unload, and pollen foragers switch off (Camazine 1993)
      if (this.noPollenRoomUntil && this.t < this.noPollenRoomUntil) {
        if (R() < 0.5) { this.patch[i] = -1; this.ftask[i] = 0; }
        this.timer[i] = rest + 20; return;
      }
      const A = P.pStock / P.pCap;
      let load = 16 * clamp(0.2 + A * 0.95, 0.1, 1); load = Math.min(load, P.pStock); P.pStock -= load;
      this.inPollen[p] += load; this.pollenToday += load;
      const rate = load / trip, needF = 2 * this.pollenNeed;
      const c = clamp((rate * needF - 0.15) * 90, 0, 50); newP[p] += c;
      abandon = 0.02 + 0.5 * clamp((0.15 - rate) / 0.15, 0, 1) + 0.5 * (1 - this.pollenNeed);
    } else {
      if (this.inSugar > 2.5e5) {   // nowhere to unload: receivers refuse, forager gives up
        if (R() < 0.4) { this.patch[i] = -1; this.ftask[i] = 0; }
        this.timer[i] = rest + 20; return;
      }
      const A = P.nStock / P.nCap;
      let load = 40 * clamp(0.2 + A * 0.95, 0.1, 1); let sug = load * P.conc;
      if (sug > P.nStock) { sug = P.nStock; load = sug / Math.max(.05, P.conc); }
      P.nStock -= sug;
      this.inSugar += sug; this.inWater += load - sug; this.nectarToday += load;
      const rate = (sug - this.fuel[i]) / trip;     // net energetic gain, mg sugar / min
      const c = clamp((rate - this.danceThr) * 130, 0, 60); newN[p] += c;
      abandon = 0.015 + 0.55 * clamp((0.1 - rate) / 0.1, 0, 1);
      rest += this.unloadDelay;
    }
    if (R() < abandon) { this.patch[i] = -1; this.ftask[i] = 0; }
    this.timer[i] = rest;
  }

  // ---------------------------------------------------------------- hourly colony processes
  hourly(initial) {
    const R = this.rand, st = this.st, age = this.age;
    this.updateEnv();
    const T = this.Tout;
    // ---------- 1. adult bees: ageing, physiological wear, death, roles
    const onset = this.onset;
    let cleaners = 0, nurses = 0, storers = 0, guards = 0, foragers = 0, young = 0, matureDrones = 0;
    const larvaeRatio = (this.cnt ? this.cnt.larvae : 0) / Math.max(1, this.nWorkers);
    // broodless bees keep their vitellogenin and barely age (winter "diutinus" bees live 6–8 months); nursing brood burns it
    const houseWear = (0.0025 + 0.06 * Math.min(0.3, larvaeRatio)) / 24;
    // behavioural development (bage) tracks brood: without brood to feed, young bees stay in the nurse-like "diutinus"
    // state (Amdam & Omholt 2002; Mattila & Otis 2007), so winter bees are still house bees in spring and join the
    // foraging force gradually as brood rearing picks up — rather than all at once on the first warm day
    const dev = clamp(larvaeRatio / 0.04, 0.15, 1);
    // background mortality; higher in the winter cluster (bees chilled at the mantle, lost on cleansing flights)
    const baseDeath = T < 10 ? 0.0001 : 0.00005;
    const droneFly = !initial && this.hour >= 13 && this.hour < 17 && T >= 19 && !this.raining;
    const evict = this.evictDrones;
    let droneFlying = 0;
    for (let i = 0; i < this.nb; i++) {
      if (!this.alive[i]) continue;
      if (!initial) this.bage[i] += (this.btype[i] === 0 ? dev : 1) / 24;
      const a = this.bage[i];
      if (this.btype[i] === 0) {
        if (!initial) {
          // ageing in the hive depends on workload (brood to feed), not on job title: older bees sitting in a broodless
          // winter cluster age as slowly as any other bee; flights add their own wear on top (see startTrip)
          this.wear[i] += this.frail[i] * (a < onset ? houseWear : 0.0025 / 24);   // only bees still doing house work carry the nursing load
          if (this.wear[i] >= 1 || R() < baseDeath) { this.killBee(i); continue; }
        }
        if (a < onset) {
          const r = a / onset;
          if (r < 0.12) cleaners++; else if (r < 0.55) nurses++; else if (r < 0.85) storers++; else guards++;
          if (a < 12) young++;
        } else foragers++;
      } else {
        if (!initial) {
          this.wear[i] += 1 / 40 / 24;
          if (this.wear[i] >= 1 || (evict && R() < 0.012) || R() < 0.0004) { this.killBee(i); continue; }
          if (droneFly && a >= 12) { droneFlying++; if (R() < 0.012) { this.killBee(i); continue; } }
        }
        if (a >= 12) matureDrones++;
      }
    }
    this.flyDrones = droneFlying;
    const house = cleaners + nurses + storers + guards;
    this.roles = { cleaners, nurses, storers, guards, foragers, young, matureDrones };
    // social inhibition: forager shortage → precocious foraging; surplus → delayed
    const fR = foragers / Math.max(1, this.nWorkers);
    this.onset += (clamp(21 + 40 * (fR - 0.32), 6, 42) - this.onset) * 0.05;

    // ---------- 2. brood & comb pass
    const c = this.cnt = { eggs: 0, larvae: 0, dLarvae: 0, capped: 0, dCapped: 0, dirty: 0, sugar: 0, water: 0, honeySugar: 0, nectarSugar: 0, nectarWater: 0, pollen: 0, emptyDrawn: 0, undrawn: 0, honeyCells: 0, excess: 0, emergedW: 0, emergedD: 0, qEggs: 0 };
    const nurseCap = (nurses + 0.5 * (storers + guards + cleaners) + 0.25 * foragers) * 3;
    const prevL = this.prevLarvae || 1;
    let fed = Math.min(1, nurseCap / prevL);
    // nurses buffer a pollen gap from their own protein reserves for ~1.5 days, then brood is cannibalised
    if (this.pollenTotal !== undefined && this.pollenTotal < 1000 && this.pollenToday < 500) this.noPollenH = (this.noPollenH || 0) + 1; else this.noPollenH = 0;
    if (this.noPollenH > 36) fed *= 0.65;
    if (this.starving) fed *= 0.3;
    this.fedFrac = fed;
    const pLarvaDie = initial ? 0 : 0.025 * Math.pow(1 - fed, 1.5);
    const pEggEat = (!initial && fed < 0.5) ? 0.01 : 0;
    const evap = this.evapFrac, buildersOK = storers + guards > 0;
    const ss = this.sideStats; ss.fill(0);
    const n = this.nActive;
    const BL = this.broodList, FL = this.foodList, PL = this.pollenList, DL = this.dirtyList;
    const FR = this.faceR || (this.faceR = new Float32Array(SIDES)), FC = this.faceC || (this.faceC = new Float32Array(SIDES)); FR.fill(0); FC.fill(0);
    let nB = 0, nF = 0, nP = 0, nD = 0, sx = 0, sy = 0, sz = 0, fx = 0, fy = 0, fz = 0, fw = 0;
    for (let i = 0; i < n; i++) {
      const s = st[i];
      const sd = ((i / CPS) | 0) * 8;
      if (s === ST.EMPTY) { if (this.drawn[i]) { c.emptyDrawn++; ss[sd + 4]++; } else { c.undrawn++; ss[sd + 5]++; } continue; }
      if (s === ST.HONEY) { c.honeySugar += this.sugar[i]; c.sugar += this.sugar[i]; c.honeyCells++; ss[sd + 1]++; FL[nF++] = i;
        if ((i & 7) === 0) { const d = this.dist3(i, this.nestC), w = 1 / (1 + d * d / 100); fx += this.X3[i] * w; fy += this.Y3[i] * w; fz += this.Z3[i] * w; fw += w; } continue; }
      if (s === ST.NECTAR) {
        let w = this.water[i]; const sg = this.sugar[i];
        const ex = w - sg * 0.2195;          // excess over 18 % water
        if (ex > 0 && !initial) { w -= ex * evap; this.water[i] = w; c.excess += ex; }
        const conc = sg / (sg + w);
        const vol = sg / SUGAR_DENS + w, cap = this.droneCell[i] ? VOL_D : VOL_W;
        if (conc >= 0.8 && vol >= cap * 0.8 && buildersOK) { st[i] = ST.HONEY; c.honeySugar += sg; c.honeyCells++; ss[sd + 1]++; }
        else { c.nectarSugar += sg; c.nectarWater += w; ss[sd + 2]++; }
        c.sugar += sg; FL[nF++] = i; continue;
      }
      if (s === ST.POLLEN) { c.pollen += this.pol[i]; ss[sd + 3]++; PL[nP++] = i; continue; }
      if (s === ST.DIRTY) { c.dirty++; ss[sd + 6]++; DL[nD++] = i; continue; }
      if (s === ST.QCELL) continue;
      // brood
      const cs = this.caste[i], D = DEV[cs];
      if (!initial) age[i] += 1;
      const a = age[i];
      ss[sd]++;
      BL[nB++] = i; sx += this.X3[i]; sy += this.Y3[i]; sz += this.Z3[i];
      { const k = i % CPS, side = (i / CPS) | 0; FR[side] += (k / COLS) | 0; FC[side] += k % COLS; }
      if (s === ST.EGG) {
        if (pEggEat && R() < pEggEat) { st[i] = ST.EMPTY; continue; }
        if (a >= D.hatch) st[i] = ST.LARVA;
        c.eggs++;
      } else if (s === ST.LARVA) {
        if (pLarvaDie && R() < pLarvaDie) { st[i] = ST.EMPTY; this.broodDeathsToday++; continue; }
        if (a >= D.cap) st[i] = ST.CAPPED;
        if (cs === 1) c.dLarvae++; else c.larvae++;
      } else if (s === ST.CAPPED) {
        if (a >= D.emerge) {
          st[i] = ST.DIRTY; c.dirty++;
          const wr = -0.15 * R();
          if (cs === 1) { this.addBee(1, 0, wr); c.emergedD++; } else { this.addBee(0, 0, wr); c.emergedW++; }
          continue;
        }
        if (cs === 1) c.dCapped++; else c.capped++;
      }
    }
    this.nBrood = nB; this.nFood = nF; this.nPol = nP; this.nDirty = nD;
    // the nest centre follows the brood; with little brood (winter) the cluster stays where it was
    if (nB > 300) { const k = initial ? 1 : 0.1; this.nestC.x += (sx / nB - this.nestC.x) * k; this.nestC.y += (sy / nB - this.nestC.y) * k; this.nestC.z += (sz / nB - this.nestC.z) * k; }
    else if (fw > 0 && !initial) {   // broodless winter cluster creeps toward (mostly up into) the nearest honey as it eats
      const k = 0.006; this.nestC.x += (fx / fw - this.nestC.x) * k; this.nestC.y += (fy / fw - this.nestC.y) * k; this.nestC.z += (fz / fw - this.nestC.z) * k;
      if (this.excluder) this.nestC.y = Math.min(this.nestC.y, 2 * ROWS - 6);   // the cluster stays with the queen below the excluder
    }
    this.prevLarvae = c.larvae + c.dLarvae * 2.5;
    this.emergedToday += c.emergedW + c.emergedD;
    const brood = c.eggs + c.larvae + c.dLarvae + c.capped + c.dCapped;
    this.broodTotal = brood;
    if (initial) { this.pollenTotal = c.pollen; return; }

    // ---------- 3. nectar ripening capacity (fanning) for next hour
    const evapCap = house * 6 * clamp((T + 10) / 30, 0.3, 1.2);   // mg water/h a colony can drive off
    this.evapFrac = c.excess > 0 ? clamp(evapCap / c.excess, 0, 0.08) : 0.08;

    // ---------- 4. queen
    this.queenHour(c, nurseCap);

    // ---------- 5. receiving & storing incoming food
    if (this.feeder > 0) { const m = Math.min(this.feeder, 1.2e6); this.feeder -= m; this.inSugar += m * .67; this.inWater += m * .33; }
    const unloadCap = (storers + 0.3 * guards + 0.15 * foragers) * 10 + 1;
    this.unloadDelay = 1 + 25 * clamp(this.landingsH / unloadCap - 0.7, 0, 1);   // long waits → tremble dance
    this.landingsH = 0;
    this.relocateNectar();
    this.storeNectar();
    this.storePollen();

    // ---------- 6. consumption
    const clustered = T < 14;
    const homeW = this.nWorkers - this.outCount();
    // a wintering colony burns ~20–25 kg of honey from October to March (Seeley & Visscher 1985): ≈0.3 mg sugar per bee
    // per hour in the cluster at 0 °C, more the colder it gets
    // a cluster loses heat through its surface, so big clusters burn less per bee (Southwick 1985): ∝ N^(-1/3)
    let perBee = clustered ? (0.12 + 0.012 * (15 - T)) * Math.pow(20000 / Math.max(2000, homeW), 1 / 3) : 0.3;
    let sugarNeed = homeW * perBee + this.nDrones * 1.0
      + c.larvae * 0.5 + c.dLarvae * 1.4
      + (brood > 0 && T < 32 ? brood * 0.004 * (34 - T) : 0)
      + this.fuelSugar;
    this.fuelSugar = 0;
    const pollenNeed = c.larvae * 0.9 + c.dLarvae * 2.0 + young * 0.15 * clamp(c.larvae / 2000, 0.1, 1);
    const gotS = this.consumeSugar(sugarNeed);
    const gotP = this.consumePollen(pollenNeed);
    this.sugarUsedToday += gotS; this.pollenUsedToday += gotP;
    const deficit = sugarNeed > 0 ? 1 - gotS / sugarNeed : 0;
    this.starving = deficit > 0.2;
    if (this.starving) {
      for (let i = 0; i < this.nb; i++) if (this.alive[i] && R() < 0.04 * deficit) this.killBee(i);
      if (!this.starveMsg || this.t - this.starveMsg > 72) { this.say('Colony is out of honey — bees are starving.', 'bad'); this.starveMsg = this.t; }
    }
    // ---------- 7. water economy
    const needW = (T > 30 ? homeW * 0.03 * (T - 30) : 0) + (this.nectarToday < 200e3 ? c.larvae * 0.05 : 0);
    const useW = Math.min(this.waterStore, needW); this.waterStore -= useW;
    this.waterStore *= 0.97;
    this.waterNeedF = needW > 0 ? clamp(1 - this.waterStore / (needW * 3), 0, 1) : 0;

    // ---------- 8. cleaning cells & comb building
    let toClean = Math.floor((cleaners + 0.3 * (nurses + storers)) * 1.5);
    for (let t = 0; t < 3 * toClean && toClean > 0 && this.nDirty > 0; t++) {
      const i = this.dirtyList[(R() * this.nDirty) | 0]; if (st[i] === ST.DIRTY) { st[i] = ST.EMPTY; toClean--; }
    }
    const storageFree = c.emptyDrawn / Math.max(1, n - c.undrawn);
    // wax builders draw out new comb during a flow once the box below it is mostly stores (or the hive is nearly full)
    let topFill = 0;
    if (this.nBoxes > 2) {
      let bx = 2; for (; bx < this.nBoxes; bx++) { let u = 0; for (let sd = bx * 20; sd < bx * 20 + 20; sd++) u += ss[sd * 8 + 5]; if (u > 0) break; }
      if (bx < this.nBoxes) { let st2 = 0, dr2 = 0; for (let sd = (bx - 1) * 20; sd < bx * 20; sd++) { const o = sd * 8; st2 += ss[o + 1] + ss[o + 2]; dr2 += ss[o] + ss[o + 1] + ss[o + 2] + ss[o + 3] + ss[o + 4] + ss[o + 6]; } topFill = st2 / Math.max(1, dr2); }
    }
    // (Pratt 1999: building is triggered by a strong nectar intake once the empty storage comb is getting scarce)
    if (c.undrawn > 0 && this.nectar24 > 400e3 && (storageFree < 0.35 || topFill > 0.45 || this.storageFull) && T > 15) {
      let k = Math.floor((storers + guards * 0.5) * 0.05 + R());
      for (let j = 0; j < n && k > 0; j++) {
        const i = this.drawOrder[j];
        if (!this.drawn[i]) { this.drawn[i] = 1; k--; this.consumeSugar(100); this.cellsDrawnToday++; }
      }
    }
    // ---------- 9. thermoregulation: brood the bees cannot cover gets chilled
    if (T < 18) {
      const warmable = homeW * 2.3;
      if (brood > warmable) {
        let kill = Math.ceil((brood - warmable) * 0.15);
        const ids = Array.from(this.broodList.subarray(0, this.nBrood)), P = this.nestC;
        const dd = new Map(ids.map(i => [i, this.dist3(i, P)])); ids.sort((a, b) => dd.get(b) - dd.get(a));
        for (const i of ids) { if (kill <= 0) break; const s = st[i]; if (s === ST.EGG || s === ST.LARVA || s === ST.CAPPED) { st[i] = ST.DIRTY; kill--; this.broodDeathsToday++; this.chilledToday++; } }
      }
    }
    // ---------- 10. pollen demand signal (brood pheromone vs. stored bee-bread)
    // colonies regulate bee-bread stores around ~1 kg (Fewell & Winston 1992; Camazine 1993) and lay down extra in late
    // summer and autumn so brood rearing can restart in late winter before any pollen is flying
    const target = (this.doy >= 200 && this.doy < 300 ? 1100e3 : 700e3) + pollenNeed * 24 * 4;
    this.pollenTotal = c.pollen;
    this.pollenNeed = this.noPollenRoomUntil && this.t < this.noPollenRoomUntil ? 0 : clamp(1 - c.pollen / target, 0, 1);
    // dance threshold rises when unloading is slow or storage is full
    this.danceThr = 0.1 + 0.006 * this.unloadDelay + (this.storageFull ? 0.4 : 0) - (c.sugar < 4e6 ? 0.04 : 0);
  }
  outCount() { return this.flyScout + this.flyW + this.flyN.reduce((a, b) => a + b, 0) + this.flyP.reduce((a, b) => a + b, 0); }

  // Nectar storage (Camazine 1991; Montovan et al. 2013): receivers try up to 6 random cells per load and use one that is
  // empty or already holds nectar. Johnson (2009): the vertical honey/brood split comes from a gravity template —
  // among acceptable cells they favour the highest (and outermost) ones, and top up part-filled cells.
  storeNectar() {
    if (this.inSugar < 1e5) this.storageFull = false;
    if (this.inSugar < 1) return;
    if (this.noRoomUntil && this.t < this.noRoomUntil) { this.storageFull = this.inSugar > 1e5; if (this.inSugar > 3e5) { const f = 3e5 / this.inSugar; this.inSugar *= f; this.inWater *= f; } return; }
    const st = this.st, n = this.nActive, R = this.rand, P = this.nestC;
    let S = this.inSugar, W = this.inWater; const S0 = S;
    const conc = S / (S + W), perMgVol = conc / SUGAR_DENS + (1 - conc);
    const total = S + W, loads = Math.min(6000, Math.ceil(total / 40)), load = total / loads;
    let failed = 0;
    for (let L = 0; L < loads && S > 1; L++) {
      let best = -1, bestScore = -1e9;
      for (let a = 0; a < 6; a++) {
        // half the tries look at cells that already hold nectar (receivers top them up), half at random cells
        const i = (a & 1 && this.nFood) ? this.foodList[(R() * this.nFood) | 0] : (R() * n) | 0, s = st[i];
        if (!this.drawn[i] || (s !== ST.EMPTY && s !== ST.NECTAR)) continue;
        const cap = this.droneCell[i] ? VOL_D : VOL_W;
        if (s === ST.NECTAR && cap - (this.sugar[i] / SUGAR_DENS + this.water[i]) < 15) continue;
        const fill = s === ST.NECTAR ? (this.sugar[i] / SUGAR_DENS + this.water[i]) / cap : 0;
        const score = this.Y3[i] + 0.25 * Math.abs(this.X3[i] - P.x) + 0.25 * Math.abs(this.Z3[i] - P.z) + (s === ST.NECTAR ? 12 + 30 * fill : 0) + R() * 8;
        if (score > bestScore) { bestScore = score; best = i; }
      }
      if (best < 0) { failed++; continue; }
      const i = best, cap = this.droneCell[i] ? VOL_D : VOL_W;
      if (st[i] === ST.EMPTY) { st[i] = ST.NECTAR; this.sugar[i] = 0; this.water[i] = 0; }
      const room = cap - (this.sugar[i] / SUGAR_DENS + this.water[i]);
      const mass = Math.min(room / perMgVol, load, S + W), ds = mass * conc;
      this.sugar[i] += ds; this.water[i] += mass - ds; S -= ds; W -= mass - ds;
    }
    this.storageFull = S > 1e5 && failed > loads * 0.5;
    this.noRoomUntil = (S0 - S) < 1000 ? this.t + 6 : 0;
    if (S > 3e5) { const f = 3e5 / S; S *= f; W *= f; }   // bees can only hold so much in their crops
    if (this.storageFull && (!this.fullMsg || this.t - this.fullMsg > 24 * 5)) { this.say('No room left to store nectar — the hive is honey-bound (a beekeeper would add a super).', 'warn'); this.fullMsg = this.t; }
    this.inSugar = Math.max(0, S); this.inWater = Math.max(0, W);
  }
  // Johnson (2009): nectar dropped into the brood nest is moved out again by house bees (and in spring some honey is
  // uncapped and moved too), which keeps the brood nest open for the queen and builds the honey arch above it.
  relocateNectar() {
    if (this.nFood === 0) return;
    const R = this.rand, st = this.st, spring = this.doy > 50 && this.doy < 170, n = this.nActive, P = this.nestC;
    const tries = Math.min(1500, this.nFood);
    for (let t = 0; t < tries; t++) {
      const i = this.foodList[(R() * this.nFood) | 0], s = st[i];
      if (s !== ST.NECTAR && s !== ST.HONEY) continue;
      const D = this.broodDensity(i);
      const fillI = (this.sugar[i] / SUGAR_DENS + this.water[i]) / (this.droneCell[i] ? VOL_D : VOL_W);
      const thin = s === ST.NECTAR && fillI < 0.6;
      if (D < 0.2 && !(thin && R() < 0.35)) continue;    // brood-nest nectar is moved out; thin leftovers are consolidated
      if (D >= 0.2 && !((s === ST.NECTAR && R() < 0.3) || (s === ST.HONEY && spring && D > 0.35 && R() < 0.04))) continue;
      // carry it to a higher / outer cell away from the brood
      let best = -1, bestScore = -1e9;
      for (let a = 0; a < 8; a++) {
        const j = (D < 0.2 || (a & 1)) && this.nFood ? this.foodList[(R() * this.nFood) | 0] : (R() * n) | 0, sj = st[j];
        if (j === i) continue;
        if (!this.drawn[j] || (sj !== ST.EMPTY && sj !== ST.NECTAR) || this.Y3[j] < this.Y3[i] - 2) continue;
        const cap = this.droneCell[j] ? VOL_D : VOL_W, vol = sj === ST.NECTAR ? this.sugar[j] / SUGAR_DENS + this.water[j] : 0;
        if (cap - vol < this.sugar[i] / SUGAR_DENS + this.water[i]) continue;
        const fillJ = vol / cap;
        if (D < 0.2 && (sj !== ST.NECTAR || fillJ < fillI)) continue;   // consolidating: only into a fuller nectar cell
        const score = (D < 0.2 ? fillJ * 40 - Math.abs(this.Y3[j] - this.Y3[i]) : this.Y3[j] + 0.25 * Math.abs(this.X3[j] - P.x)) + R() * 8;
        if (score > bestScore) { bestScore = score; best = j; }
      }
      if (best < 0) continue;
      if (st[best] === ST.EMPTY) { st[best] = ST.NECTAR; this.sugar[best] = 0; this.water[best] = 0; }
      this.sugar[best] += this.sugar[i]; this.water[best] += this.water[i];
      this.sugar[i] = 0; this.water[i] = 0; st[i] = ST.EMPTY; this.movedToday++;
    }
  }
  // used only to lay out the initial (post-winter) bee-bread
  placePollen(p, amount, start) {
    const st = this.st, ord = this.broodOrder, n = this.nActive;
    for (let j = start; j < n && amount > 1; j++) {
      const i = ord[j], s = st[i];
      if (!this.drawn[i] || this.droneCell[i] || this.boxOf(i) >= 2) continue;
      if (s === ST.EMPTY || (s === ST.POLLEN && this.pol[i] < POLLEN_CAP_W)) {
        if (s === ST.EMPTY) { st[i] = ST.POLLEN; this.pol[i] = 0; }
        const add = Math.min(POLLEN_CAP_W - this.pol[i], amount);
        this.pol[i] += add; amount -= add; if (p >= 0) this.pcol[i] = p + 1;
      }
    }
    return amount;
  }
  // Pollen foragers unload close to the brood (Johnson 2009: queen-based template) — into a part-filled bee-bread
  // cell of the same kind if one is handy, otherwise an empty cell; loads of different colours build up in layers.
  storePollen() {
    if (this.noPollenRoomUntil && this.t < this.noPollenRoomUntil) { for (const v of this.inPollen) this.pollenToday -= v; this.inPollen.fill(0); return; }
    const R = this.rand, st = this.st, n = this.nActive;
    let before = 0; for (let p = 0; p < this.inPollen.length; p++) before += this.inPollen[p];
    if (before < 1) return;
    const chunk = Math.max(16, before / 4000);
    for (let p = 0; p < this.inPollen.length; p++) {
      let fails = 0;
      while (this.inPollen[p] >= 1) {
        let best = -1, bestScore = -1;
        for (let a = 0; a < 6; a++) {
          let i;
          if (this.nBrood > 0 && a < 5) {
            // next to the brood first; if that ring is full of honey, a little further out on the same comb
            const b = this.broodList[(R() * this.nBrood) | 0], side = (b / CPS) | 0, k = b - side * CPS, w = a < 3 ? 4 : 10;
            const r = ((k / COLS) | 0) + ((R() * (2 * w + 1)) | 0) - w, cc = (k % COLS) + ((R() * (2 * w + 1)) | 0) - w;
            if (r < 0 || r >= ROWS || cc < 0 || cc >= COLS) continue;
            i = side * CPS + r * COLS + cc;
          } else i = (R() * n) | 0;
          const s = st[i];
          if (!this.drawn[i] || this.droneCell[i] || (this.excluder && this.boxOf(i) >= 2)) continue;
          let score;
          if (s === ST.POLLEN && this.pol[i] < POLLEN_CAP_W - 1) score = 2 + R();
          else if (s === ST.EMPTY) { if (this.nBrood > 0 && this.broodDensity(i) > 0.7) continue; score = 1 + R(); }   // gaps inside the brood nest are left for the queen
          else continue;
          if (score > bestScore) { bestScore = score; best = i; }
        }
        if (best < 0) { if (++fails > 150) break; continue; }
        if (st[best] === ST.EMPTY) { st[best] = ST.POLLEN; this.pol[best] = 0; }
        const add = Math.min(POLLEN_CAP_W - this.pol[best], this.inPollen[p], chunk);
        this.pol[best] += add; this.inPollen[p] -= add; this.pcol[best] = p + 1;
      }
    }
    let after = 0; for (let p = 0; p < this.inPollen.length; p++) after += this.inPollen[p];
    if (after > before * 0.9) { this.noPollenRoomUntil = this.t + 6; this.pollenToday -= after; this.inPollen.fill(0); }
  }
  // Consumption (Montovan et al. 2013, model 2): a bee picks a stores cell with probability ∝ 1 + D·(k−1), D = brood
  // density within two cells, k = 10 — so stores next to brood are eaten first — and takes one load. In a broodless
  // winter cluster the bees eat from the cells around the cluster.
  takeLoads(list, count, need, chunk, isPollen) {
    const R = this.rand, st = this.st, P = this.nestC;
    let got = 0, guard = 0, misses = 0;
    while (need > 0.01 && count > 0 && guard++ < 200000) {
      let pick = -1;
      for (let a = 0; a < 6; a++) {
        const i = list[(R() * count) | 0], s = st[i];
        if (isPollen ? s !== ST.POLLEN : (s !== ST.HONEY && s !== ST.NECTAR)) continue;
        if (!isPollen && s === ST.HONEY && a < 5 && R() < 0.85) continue;   // prefer cells already opened
        const D = this.broodDensity(i), near = Math.exp(-this.dist3(i, P) / 18);
        if (misses > 15 || R() < (1 + 9 * D) / 10 * (0.08 + 0.92 * near)) { pick = i; break; }
      }
      if (pick < 0) { misses++; continue; }
      misses = 0;
      const i = pick;
      if (isPollen) {
        const m = Math.min(this.pol[i], need, chunk); this.pol[i] -= m; got += m; need -= m;
        if (this.pol[i] < 1) { st[i] = ST.EMPTY; this.pol[i] = 0; }
      } else {
        const sg = this.sugar[i], m = Math.min(sg, need, chunk), f = 1 - m / sg;
        this.sugar[i] = sg - m; this.water[i] *= f; got += m; need -= m;
        if (this.sugar[i] < 2) { st[i] = ST.EMPTY; this.sugar[i] = 0; this.water[i] = 0; }
        else if (st[i] === ST.HONEY) st[i] = ST.NECTAR;   // uncapped once bees open it
      }
    }
    return got;
  }
  consumeSugar(need) {
    let got = 0;
    if (this.inSugar > 0) { const m = Math.min(this.inSugar, need); this.inSugar -= m; this.inWater *= (this.inSugar / (this.inSugar + m) || 0); got += m; need -= m; }
    if (need <= 0.01) return got;
    const chunk = Math.max(25, need / 3000);
    got += this.takeLoads(this.foodList, this.nFood, need, chunk, false);
    return got;
  }
  consumePollen(need) {
    if (need <= 0.01) return 0;
    return this.takeLoads(this.pollenList, this.nPol, need, Math.max(10, need / 3000), true);
  }

  // ---------------------------------------------------------------- queen biology
  queenLayRate() {
    const q = this.queen; if (!q.present || !q.laying) return 0;
    const d = this.doy, m = d / 30.42 - 0.5, i0 = ((Math.floor(m) % 12) + 12) % 12, f = m - Math.floor(m);
    let season = MONTH_LAY[i0] * (1 - f) + MONTH_LAY[(i0 + 1) % 12] * f;
    // late winter (after the solstice, before April): brood rearing only restarts once a warm spell triggers it, then
    // builds up at a pace set by the weather — so mild winters start early and cold ones late
    if (d >= 355 || d < 100) season = Math.min(Math.max(season * 1.8, 0.06), this.winterDrive || 0);
    const yrs = q.ageD / 365;
    let max = 1800 * (yrs > 2 ? Math.max(0.35, 1 - 0.2 * (yrs - 2)) : 1);
    let res = 1;
    if (this.pollenTotal < 80e3 && this.pollenToday < 50e3 && this.doy > 40) res *= 0.4;
    if (this.cnt.sugar < 2e6) res *= 0.4;
    if (this.nectar24 > 1e6) res *= 1.1;
    // in a late-summer dearth the workers feed the queen less and she slows down
    else if (this.doy > 180 && this.nectar24 < 150e3) res *= 0.7;
    return max * season * res * (this.swarmPrep ? 0.35 : 1);
  }
  // ---- the queen's walk (Camazine 1991; Montovan et al. 2013 model 3): she moves cell to cell, biased toward the warm
  // centre of the brood nest, and lays only in empty, polished cells within two cells of existing brood.
  faceTarget(side) {
    const b = (side / 20) | 0, P = this.nestC;
    const tx = 0.5 * P.x + 0.5 * 39.5, ty = 0.5 * P.y + 0.5 * 42;
    let r = ROWS - 1 - (ty - b * ROWS), c = tx;
    const nb = this.sideStats[side * 8];
    if (nb >= 20 && this.faceR) { const w = 0.75; r = w * this.faceR[side] / nb + (1 - w) * r; c = w * this.faceC[side] / nb + (1 - w) * c; }
    return { r: clamp(Math.round(r), 2, ROWS - 3), c: clamp(Math.round(c), 3, COLS - 4) };
  }
  queenChangeFace() {
    const R = this.rand, cur = this.sideOf(this.qpos.i), b = (cur / 20) | 0, f = ((cur % 20) / 2) | 0, sd = cur & 1;
    const cand = [];
    const add = (bb, ff, ss) => { if (bb < 0 || bb >= this.nBoxes || ff < 0 || ff >= FPB) return; if (this.excluder && bb >= 2) return; cand.push((bb * 10 + ff) * 2 + ss); };
    add(b, f, sd ^ 1);                                   // other face of the same comb
    if (sd === 0) add(b, f - 1, 1); else add(b, f + 1, 0); // facing comb across the bee space
    add(b + 1, f, sd); add(b - 1, f, sd);                // through the gap between boxes
    if (R() < 0.25) for (let k = 0; k < 3; k++) add(b, (R() * FPB) | 0, R() < .5 ? 0 : 1);   // occasionally wanders further
    let tot = 0; const w = cand.map(side => {
      const o = side * 8, ss = this.sideStats, ff = ((side % 20) / 2) | 0;
      const v = (ss[o] + 40) * (ss[o + 4] + ss[o + 6] * 0.3 + 5) * Math.exp(-Math.abs(ff - (this.nestC.z / 6.5)) / 2.5);
      tot += v; return v; });
    let x = R() * tot, k = 0; for (; k < cand.length - 1; k++) { x -= w[k]; if (x <= 0) break; }
    const side = cand[k], t = this.faceTarget(side);
    this.qpos.i = side * CPS + clamp(t.r + ((R() * 9) | 0) - 4, 0, ROWS - 1) * COLS + clamp(t.c + ((R() * 13) | 0) - 6, 0, COLS - 1);
    for (let tries = 0; tries < 60 && this.nBrood > 0; tries++) { const b = this.broodList[(R() * this.nBrood) | 0]; if (((b / CPS) | 0) === side) { this.qpos.i = b; break; } }
  }
  layEggs(want, nd, allDrone) {
    const R = this.rand, st = this.st;
    let nw = want - nd, laid = 0, fails = 0;
    const steps = 80 + want * 6;
    let i = this.qpos.i;
    for (let s = 0; s < steps && (nw > 0 || nd > 0); s++) {
      const side = (i / CPS) | 0, k = i - side * CPS, r = (k / COLS) | 0, c = k - r * COLS;
      // step to a neighbouring cell: random direction, increasingly biased toward the nest centre near the edges
      const t = this.faceTarget(side), dist = Math.hypot(t.r - r, t.c - c), nearBrood = this.hasBroodNear(i);
      const bias = nearBrood ? clamp(dist / 40, 0.05, 0.35) : clamp(0.35 + dist / 30, 0.35, 0.85);
      const nb = NBR[r & 1].filter(o => o[2] === 1 && r + o[0] >= 0 && r + o[0] < ROWS && c + o[1] >= 0 && c + o[1] < COLS);
      // she antennates the cells around her and lays in a suitable one if she finds it
      let laidHere = false;
      const start = (R() * nb.length) | 0;
      for (let q = 0; q < nb.length && !laidHere; q++) {
        const o2 = nb[(start + q) % nb.length], j = side * CPS + (r + o2[0]) * COLS + (c + o2[1]);
        if (st[j] !== ST.EMPTY || !this.drawn[j] || (this.excluder && this.boxOf(j) >= 2)) continue;
        if (!(this.nBrood < 50 || this.sideStats[side * 8] < 20 || this.hasBroodNear(j))) continue;
        if (this.droneCell[j] || allDrone) { if (nd > 0) { st[j] = ST.EGG; this.caste[j] = 1; this.age[j] = 0; nd--; laid++; laidHere = true; i = j; } }
        else if (nw > 0 && R() >= this.coolPenalty(j)) { st[j] = ST.EGG; this.caste[j] = 0; this.age[j] = 0; nw--; laid++; laidHere = true; i = j; }
      }
      if (laidHere) { fails = 0; continue; }
      // otherwise step on: random direction, drifting toward the brood when she is away from it
      let o;
      if (R() < bias) { let bd = 1e9; for (const q of nb) { const d = Math.hypot(t.r - (r + q[0]), t.c - (c + q[1])); if (d < bd) { bd = d; o = q; } } }
      else o = nb[(R() * nb.length) | 0];
      i = side * CPS + (r + o[0]) * COLS + (c + o[1]);
      if (++fails > 70) { this.qpos.i = i; this.queenChangeFace(); i = this.qpos.i; fails = 0; }
    }
    // if her walk ran out before she found enough cells, she keeps searching the rim of the brood nest — a queen with
    // empty comb next to her brood lays to her full potential (her walk is a model of where she lays, not a limit on it)
    for (let t = 0; t < 600 && nw > 0 && this.nBrood > 0; t++) {
      const b = this.broodList[(R() * this.nBrood) | 0], side = (b / CPS) | 0, k = b - side * CPS;
      const rr = (k / COLS) | 0, o = NBR[rr & 1][(R() * NBR[rr & 1].length) | 0], r2 = rr + o[0], c2 = (k % COLS) + o[1];
      if (r2 < 0 || r2 >= ROWS || c2 < 0 || c2 >= COLS) continue;
      const j = side * CPS + r2 * COLS + c2;
      if (st[j] !== ST.EMPTY || !this.drawn[j] || this.droneCell[j] || (this.excluder && this.boxOf(j) >= 2) || R() < this.coolPenalty(j)) continue;
      st[j] = ST.EGG; this.caste[j] = 0; this.age[j] = 0; nw--; laid++;
    }
    // drone eggs: she seeks out drone comb at the edge of the brood nest
    for (let t = 0; t < 400 && nd > 0 && !allDrone && this.nBrood > 0; t++) {
      const b = this.broodList[(R() * this.nBrood) | 0], side = (b / CPS) | 0, k = b - side * CPS;
      const r = ((k / COLS) | 0) + ((R() * 13) | 0) - 6, cc = (k % COLS) + ((R() * 13) | 0) - 6;
      if (r < 0 || r >= ROWS || cc < 0 || cc >= COLS) continue;
      const j = side * CPS + r * COLS + cc;
      if (this.droneCell[j] && st[j] === ST.EMPTY && this.drawn[j]) { st[j] = ST.EGG; this.caste[j] = 1; this.age[j] = 0; nd--; laid++; }
    }
    this.qpos.i = i; this.queenSide = this.sideOf(i);
    return laid;
  }
  queenHour(c, nurseCap) {
    const q = this.queen, R = this.rand, st = this.st, n = this.nActive;
    // -- egg laying
    let rate = this.queenLayRate();
    if (rate > 0) {
      const nurseF = clamp(nurseCap * 1.4 / (c.eggs + c.larvae + c.dLarvae + 1), 0.15, 1);
      rate *= nurseF;
      this.eggAcc += rate / 24;
      let want = Math.floor(this.eggAcc); this.eggAcc -= want;
      const droneOK = (this.doy >= 90 && this.doy <= 200 && this.nWorkers > 8000 && c.sugar > 4e6) || q.droneLayer;
      const nd = q.droneLayer ? want : (droneOK ? Math.round(want * 0.05) : 0);
      const laid = this.layEggs(want, nd, !!q.droneLayer);
      this.wantToday += want; this.laidToday += laid;
    } else if (this.layingWorkers && !q.present) {
      // laying workers: scattered drone eggs in worker cells
      let k = 4 + (R() * 4 | 0);
      for (let t = 0; t < 200 && k > 0; t++) { const i = (R() * Math.min(n, 40 * CPS)) | 0; if (st[i] === ST.EMPTY && this.drawn[i]) { st[i] = ST.EGG; this.caste[i] = 1; this.age[i] = 0; k--; this.laidToday++; } }
    }
    this.queenCellHour();
    const Q = this.queen;
    // -- prime swarm: the old queen leaves once the first queen cells are capped, on a fine late morning
    if (this.swarmPrep && Q.present && Q.mated && this.queenCells.some(x => x.age >= 192 && x.state !== 'killed') && this.hour >= 10 && this.hour <= 15 && this.Tout >= 16 && !this.raining) this.issueSwarm('prime');
    // -- virgin queens: maturation, mating flights (afternoons, ≥ 20 °C)
    if (Q.present && Q.virgin) this.mateStep(Q, true);
    for (let k = this.virgins.length - 1; k >= 0; k--) this.mateStep(this.virgins[k], false, k);
    if (Q.present && !Q.laying && Q.layFrom && this.t >= Q.layFrom) { Q.laying = true; this.say(Q.droneLayer ? 'Drone-laying queen has begun laying.' : 'The new queen has started laying eggs!', Q.droneLayer ? 'bad' : 'good'); }
    if (Q.present) {
      Q.ageD += 1 / 24;
      if (R() < (Q.ageD > 4 * 365 ? 0.002 : 0.000004)) { this.queen = { present: false }; this.say('The queen has died.', 'bad'); }
    }
    // -- queenless: emergency queen rearing from young worker larvae (drawn out on the comb face)
    if (!this.queen.present && this.queenCells.filter(x => x.state !== 'killed' && x.state !== 'emerged').length === 0 && this.virgins.length === 0) {
      let made = 0;
      for (let t = 0; t < 4000 && made < 4 && this.nBrood > 0; t++) {
        const i = this.broodList[(R() * this.nBrood) | 0];
        if (st[i] === ST.LARVA && this.caste[i] === 0 && this.age[i] < 120) { st[i] = ST.QCELL; this.queenCells.push({ idx: i, age: this.age[i], kind: 'emergency', state: 'open' }); made++; }
      }
      if (made) this.say(`Queenless: workers are drawing ${made} emergency queen cells out from young worker larvae on the comb face.`, 'warn');
      else {
        this.queenlessH++;
        if (!this.layingWorkers && this.queenlessH > 24 * 21 && c.eggs + c.larvae + c.capped === 0) { this.layingWorkers = true; this.say('Hopelessly queenless — laying workers have developed (drone eggs only).', 'bad'); }
      }
    } else if (this.queen.present) { this.queenlessH = 0; if (this.queen.mated) this.layingWorkers = false; }
    this.swarmHour();
  }
  mateStep(V, reigning, idx) {
    const R = this.rand;
    V.vAge += 1 / 24;
    if (V.vAge > 5 && this.hour >= 13 && this.hour <= 16 && this.Tout >= 20 && !this.raining && R() < 0.3) {
      if (R() < 0.06) {
        if (reigning) this.queen = { present: false }; else this.virgins.splice(idx, 1);
        this.say('A virgin queen was lost on her mating flight (birds, wrong hive on return…).', 'bad'); return;
      }
      V.flights++; this.say(`Virgin queen returned from mating flight ${V.flights} — mated with ~${8 + (R() * 10 | 0)} drones at a drone congregation area.`, 'info');
      if (V.flights >= 2 || R() < 0.3) {
        V.virgin = false; V.mated = true; V.layFrom = this.t + 60 + R() * 24;
        if (!reigning) {   // supersedure: the daughter takes over; the old mother queen disappears
          const days = Math.round(V.vAge);
          this.virgins.splice(idx, 1);
          this.queen = { present: true, mated: true, virgin: false, ageD: V.vAge, laying: false, layFrom: V.layFrom, droneLayer: false, vAge: V.vAge, flights: V.flights };
          this.say(`Supersedure complete: mother and daughter queens coexisted for ${days} days; the old queen is gone and her daughter will start laying soon.`, 'good');
        }
      }
    }
    if (V.virgin && V.vAge > 26) {
      if (reigning) { V.virgin = false; V.droneLayer = true; V.layFrom = this.t; this.say('The queen failed to mate — she is laying only drone eggs.', 'bad'); }
      else { this.virgins.splice(idx, 1); this.say('The unmated daughter queen disappeared; the old queen carries on.', 'info'); }
    }
  }
  // ---- queen cells: development, emergence, rival-killing, piping and afterswarms
  qcState(qc) { return qc.state === 'killed' || qc.state === 'emerged' || qc.state === 'held' ? qc.state : qc.age < 0 ? 'cup' : qc.age < 192 ? 'open' : 'capped'; }
  newVirgin() { return { present: true, mated: false, virgin: true, vAge: 0, flights: 0, ageD: 0, laying: false, layFrom: 0, droneLayer: false }; }
  queenCellHour() {
    const R = this.rand, q = this.queen;
    const freeVirgin = () => (this.queen.present && this.queen.virgin) || this.virgins.length > 0;
    for (let k = this.queenCells.length - 1; k >= 0; k--) {
      const qc = this.queenCells[k];
      if (qc.state === 'killed' || qc.state === 'emerged') { qc.tear -= 1; if (qc.tear <= 0) this.removeQC(k); continue; }   // workers tear the remains down
      if (qc.age < 0) { if (q.present && q.laying && !q.virgin) qc.age += 1; else if (!freeVirgin() && !this.swarmPrep) { this.removeQC(k); } continue; }
      qc.age += 1; qc.state = this.qcState(qc);
      if (qc.age >= 384 && qc.state !== 'held') {
        // in swarm mode the workers keep later queens confined (feeding them through a slit) while one virgin is free
        if (this.castMode && freeVirgin()) { qc.state = 'held'; continue; }
        this.emergeQueen(qc);
      }
      if (qc.state === 'held' && qc.age > 384 + 24 * 6) this.emergeQueen(qc);   // she eventually gets out regardless
    }
    // piping: a free virgin "toots"; queens still in their cells answer by "quacking"
    const mature = this.queenCells.filter(x => (x.state === 'capped' && x.age >= 330) || x.state === 'held');
    const toot = freeVirgin() && mature.length > 0;
    if (toot && !this.piping.toot) this.say('Queen piping: the free virgin queen is "tooting"; the queens still sealed in their cells answer by "quacking".', 'info');
    this.piping = { toot, quack: toot ? mature.length : 0 };
    // a free virgin hunts down her rivals — unless the workers are guarding the cells for afterswarms
    if (freeVirgin() && !this.castMode) {
      const rivals = this.queenCells.filter(x => x.state !== 'killed' && x.state !== 'emerged').sort((a, b) => b.age - a.age);   // most mature first
      let kills = 1 + (R() < 0.6 ? 1 : 0);
      for (const qc of rivals) {
        if (kills-- <= 0) break;
        qc.state = 'killed'; qc.tear = 6 + R() * 18; this.queenSide = this.sideOf(qc.idx);
        if (!this.killMsg || this.t - this.killMsg > 72) { this.say('The virgin queen is hunting her rivals: she chews a hole in the side of each queen cell and stings the queen inside, the ones closest to emerging first. Workers then tear the cells down.', 'warn'); this.killMsg = this.t; }
      }
    }
  }
  emergeQueen(qc) {
    const R = this.rand;
    qc.state = 'emerged'; qc.tear = 24 * (2 + R() * 6);   // the empty cell, its tip opened like a hinged lid, lingers a few days
    const v = this.newVirgin();
    if (!this.queen.present) { this.queen = v; this.say('A virgin queen chewed around the tip of her cell and emerged.', 'good'); }
    else if (this.queen.virgin) {
      // two free virgins: they fight with their (smooth, reusable) stings until one is dead
      if (R() < 0.5) this.queen = v;
      this.say('Two virgin queens met on the comb and fought — only one survived.', 'warn');
    } else if (this.virgins.length) { this.say('A second daughter queen emerged and was killed by her sister.', 'warn'); }
    else { this.virgins.push(v); this.say('A daughter queen emerged alongside the old queen (supersedure) — they may coexist for a while.', 'info'); }
    this.queenSide = this.sideOf(qc.idx);
  }
  removeQC(k) { const qc = this.queenCells[k]; if (this.st[qc.idx] === ST.QCELL) this.st[qc.idx] = ST.DIRTY; this.queenCells.splice(k, 1); }
  // swarm cells go along the bottom (and lower sides) of the brood combs, often in groups; with two deeps, along the
  // bottom of the upper box in the middle of the brood nest
  startSwarmCells() {
    const R = this.rand, ss = this.sideStats;
    const upperBrood = (() => { let a = 0; for (let s = 20; s < 40; s++) a += ss[s * 8]; return a; })();
    const box = upperBrood > 1500 ? 1 : 0;
    const faces = []; for (let f = 0; f < FPB; f++) for (let sd = 0; sd < 2; sd++) { const side = (box * 10 + f) * 2 + sd; if (ss[side * 8] > 150) faces.push(side); }
    if (!faces.length) faces.push((box * 10 + 4) * 2);
    const groups = 3 + (R() * 4 | 0);
    for (let g = 0; g < groups; g++) {
      const side = faces[(R() * faces.length) | 0], alongSide = R() < 0.25;
      const n = 1 + (R() * 3 | 0), c0 = 12 + (R() * 56 | 0), r0 = 24 + (R() * 14 | 0), left = R() < 0.5;
      for (let m = 0; m < n; m++) {
        const r = alongSide ? clamp(r0 + m * 3, 0, ROWS - 1) : ROWS - 1 - (R() < 0.3 ? 1 : 0);
        const cc = alongSide ? (left ? 0 : COLS - 1) : clamp(c0 + m * 3, 0, COLS - 1);
        const i = side * CPS + r * COLS + cc;
        if (this.st[i] === ST.QCELL) continue;
        this.st[i] = ST.QCELL; this.queenCells.push({ idx: i, age: -Math.floor(R() * 72) - 1, kind: 'swarm', state: 'cup', edge: alongSide ? (left ? 'left' : 'right') : 'bottom' });
      }
    }
    this.swarmPrep = true;
    this.say(`Swarm preparations: workers have built ${this.queenCells.length} queen cups along the bottom edges of the brood combs; the queen is laying in them and slimming down for flight.`, 'warn');
  }
  issueSwarm(kind) {
    const R = this.rand; let left = 0, dr = 0;
    const frac = kind === 'prime' ? 0.55 : 0.3;
    for (let i = 0; i < this.nb; i++) {
      if (!this.alive[i]) continue;
      if (this.btype[i] === 0) { if (this.fstate[i] === 1) continue; if (R() < (this.bage[i] < this.onset ? frac * 1.12 : frac * 0.82)) { this.killBee(i); this.deathsToday--; left++; } }
      else if (R() < (kind === 'prime' ? 0.3 : 0.15)) { this.killBee(i); this.deathsToday--; dr++; }
    }
    this.consumeSugar(left * 30);
    const queenKind = kind === 'prime' ? 'old mated queen' : 'virgin queen';
    this.queen = { present: false };
    if (kind === 'prime') {
      this.swarmPrep = false;
      const intact = this.queenCells.filter(x => x.state !== 'killed' && x.state !== 'emerged' && x.age >= 0).length;
      this.castMode = this.allowSwarm && this.nWorkers > 9000 && intact >= 2 && R() < 0.65;
      this.casts = 0;
    } else this.casts++;
    const sw = { id: this.swarms.length + 1, kind, n: left, drones: dr, queen: queenKind, t0: this.t, phase: 'bivouac', hours: 0,
      bx: (R() - 0.5) * 0.12, by: (R() - 0.5) * 0.12, scouts: clamp(Math.round(left * 0.05), 40, 700), cohorts: [], retired: 0, quorumN: 15 + (R() * 15 | 0), site: -1, prog: 0, found: {} };
    this.swarms.push(sw); this.swarmEvent = { t: this.t, n: left, kind };
    this.say(kind === 'prime'
      ? `🐝 PRIME SWARM! The old queen left with ~${left.toLocaleString()} workers and ${dr} drones, each carrying ~35 mg of honey. They are clustering on a branch nearby.`
      : `🐝 AFTERSWARM (cast) #${this.casts}: a virgin queen left with ~${left.toLocaleString()} workers. The workers release the next queen.`, 'swarm');
    if (kind === 'cast') {
      // release the next confined queen
      const held = this.queenCells.filter(x => x.state === 'held').sort((a, b) => b.age - a.age);
      if (held.length) this.emergeQueen(held[0]);
      if (this.casts >= 2 || this.nWorkers < 11000 || R() < 0.65) this.castMode = false;
    }
  }
  // ---- swarm house-hunting (Seeley): ~5 % of the swarm scout for cavities; dancing for a site fades by ~15 circuits
  // with each return ("expiration of dissent"); when ~15–30 scouts are at one site at once (quorum) they pipe, the
  // swarm warms up and flies there.
  swarmHour() {
    const R = this.rand, Q = this.queen;
    // afterswarm: a free virgin leaves with a cast after a day or two of piping
    if (this.castMode && Q.present && Q.virgin && Q.vAge > 1 && this.hour >= 10 && this.hour <= 16 && this.Tout >= 15 && !this.raining && R() < 0.2) this.issueSwarm('cast');
    if (this.castMode && (!this.allowSwarm || this.nWorkers < 9000 || !this.queenCells.some(x => x.state !== 'killed' && x.state !== 'emerged'))) this.castMode = false;
    const good = this.isDay && this.Tout >= 13 && !this.raining;
    for (const sw of this.swarms) {
      if (sw.phase === 'settled' || sw.phase === 'failed') continue;
      sw.hours += 1;
      if (sw.phase === 'flying') { sw.prog += 1 / Math.max(0.5, this.nestSites[sw.site].dist / 6); if (sw.prog >= 1) { sw.phase = 'settled'; const S = this.nestSites[sw.site]; S.occupied = true;
        this.say(`Swarm #${sw.id} moved into its new home: ${S.name.toLowerCase()} ${S.dist.toFixed(1)} km ${this.compass(S.az)} (${S.vol.toFixed(0)} L cavity, ${S.ent.toFixed(0)} cm² entrance, ${S.height.toFixed(0)} m up).`, 'good'); } continue; }
      if (sw.phase === 'liftoff') { sw.prog += 1; if (sw.prog >= 1) { sw.phase = 'flying'; sw.prog = 0; } continue; }
      if (!good) continue;
      for (let tk = 0; tk < 6; tk++) {   // six 10-minute rounds per hour
        const active = sw.cohorts.reduce((a, c) => a + c.n, 0);
        const u = Math.max(0, sw.scouts - active - sw.retired);
        // discovery by searching scouts (nearer cavities are found more often)
        const avail = this.nestSites.filter(S => !S.occupied);
        const found = (R() < u * 0.0003) ? 1 : 0;      // a lone scout occasionally discovers a cavity
        if (found > 0 && avail.length) {
          let tot = 0; const w = avail.map(S => { const v = 1 / Math.pow(S.dist + 0.4, 1.4); tot += v; return v; });
          let x = R() * tot, k = 0; for (; k < w.length - 1; k++) { x -= w[k]; if (x <= 0) break; }
          const S = avail[k], circ = 100 * S.q + (R() - 0.5) * 20;
          if (circ > 12) { sw.cohorts.push({ site: S.id, n: found, circ }); sw.found[S.id] = true; }
        }
        // recruitment by dances, in proportion to each site's share of dance circuits
        const dance = {}; let dTot = 0;
        for (const c of sw.cohorts) { const v = c.n * Math.max(0, c.circ); dance[c.site] = (dance[c.site] || 0) + v; dTot += v; }
        const rec = u * Math.min(0.08, dTot / (dTot + 400000));
        if (rec > 0 && dTot > 0) for (const id in dance) { const S = this.nestSites[id]; const n = rec * dance[id] / dTot; sw.cohorts.push({ site: +id, n, circ: 100 * S.q + (R() - 0.5) * 20 }); }
        // dance decay: each round trip reduces the circuits; scouts who stop dancing retire
        for (const c of sw.cohorts) c.circ -= 15 / 6;      // ~one return trip (and 15 fewer circuits) per hour
        const keep = []; for (const c of sw.cohorts) { if (c.circ > 0) keep.push(c); else sw.retired += c.n; } sw.cohorts = keep;
        // quorum: scouts present at a site at the same time
        const at = {}; for (const c of sw.cohorts) at[c.site] = (at[c.site] || 0) + c.n * 0.5;
        sw.support = at;
        for (const id in at) if (at[id] >= sw.quorumN) { sw.site = +id; break; }
        if (sw.site >= 0) break;
      }
      if (sw.site < 0 && sw.hours > 80) {   // honey running out: go to the best-supported site, or give up
        const best = Object.entries(sw.support || {}).sort((a, b) => b[1] - a[1])[0];
        if (best) sw.site = +best[0]; else { sw.phase = 'failed'; this.say(`Swarm #${sw.id} failed to agree on a home and built comb in the open — it is unlikely to survive.`, 'bad'); continue; }
      }
      if (sw.site >= 0 && sw.phase === 'bivouac') {
        const S = this.nestSites[sw.site]; sw.phase = 'liftoff'; sw.prog = 0;
        this.say(`Swarm #${sw.id} reached a quorum (${sw.quorumN}+ scouts at one site) after ${sw.hours} h: scouts are piping and the swarm is lifting off for the ${S.name.toLowerCase()} ${S.dist.toFixed(1)} km ${this.compass(S.az)}.`, 'swarm');
      }
    }
  }
  compass(az) { return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(az / 45) % 8]; }

  // ---------------------------------------------------------------- daily
  resetDay() {
    // site fidelity fades: after several days without flying, foragers no longer return to their old patch and the
    // foraging force has to be rebuilt by scouts and dances (true after winter or a long spell of bad weather)
    if (this.tripsToday === 0) { if (++this.idleDays === 5) for (let i = 0; i < this.nb; i++) if (this.ftask[i] !== 4) { this.patch[i] = -1; this.ftask[i] = 0; } }
    else this.idleDays = 0;
    this.nectarToday = 0; this.pollenToday = 0; this.waterToday = 0; this.tripsToday = 0; this.laidToday = 0; this.wantToday = 0;
    this.deathsToday = 0; this.lostForagers = 0; this.broodDeathsToday = 0; this.emergedToday = 0; this.sugarUsedToday = 0; this.pollenUsedToday = 0;
    this.chilledToday = 0; this.cellsDrawnToday = 0; this.movedToday = 0;
  }
  daily(d) {
    const c = this.cnt || {};
    this.nectar24 = this.nectarToday;
    const rec = {
      day: this.day, doy: this.day % 365, workers: this.nWorkers, drones: this.nDrones,
      brood: this.broodTotal || 0, honey: (c.honeySugar || 0) / 0.82 / 1e6, nectar: ((c.nectarSugar || 0) + (c.nectarWater || 0)) / 1e6,
      sugarKg: (c.sugar || 0) / 1e6, pollen: (c.pollen || 0) / 1e6, nectarIn: this.nectarToday / 1e6, pollenIn: this.pollenToday / 1e3,
      laid: this.laidToday, deaths: this.deathsToday, trips: this.tripsToday, temp: this.wx ? this.wx.mean : 0,
      chilled: this.chilledToday, emerged: this.emergedToday, weight: this.hiveWeight(),
    };
    this.history.push(rec); if (this.history.length > 800) this.history.shift();
    this.lastDay = rec;
    // daily congestion memory for swarm impulse
    this.congest = (this.congest || []).concat(this.wantToday > 50 ? this.laidToday / this.wantToday : 1).slice(-3);
    this.resetDay();
    this.day = d;
    const doy = d % 365;
    if (doy === 0) this.say(`Happy new year — year ${this.year} begins.`, 'info');
    this.genWeather(doy);
    this.frostKill = false;
    this.winterBrood(doy);
    // drone eviction at the end of the season / dearth
    const wasEvict = this.evictDrones;
    this.evictDrones = (doy > 228 && (this.nectar24 < 150e3 || doy > 258)) || doy > 290 || doy < 60 || (this.cnt && this.cnt.sugar < 3e6) || (this.queen.present === false && false);
    if (this.queen.present === false || this.queen.virgin || this.virgins.length) this.evictDrones = false;
    if (this.evictDrones && !wasEvict && this.nDrones > 50) this.say('Workers are evicting the drones from the hive.', 'info');
    if (doy === 172) this.say('Summer solstice — the colony is near peak population.', 'info');
    // autumn check: a colony needs ~20 kg of honey to see it through to spring
    if ((doy === 258 || doy === 288) && this.cnt) { const hk = this.cnt.sugar / 0.82 / 1e6; if (hk < 20) this.say(`Winter stores look light (${hk.toFixed(0)} kg of honey; a colony needs ~20 kg) — a beekeeper would feed syrup now.`, 'keeper'); }
    if (doy === 102 && this.nBoxes <= 2) this.say('The spring nectar flow is starting — a beekeeper would add a honey super now, or the brood nest will fill with honey.', 'keeper');
    // swarm impulse check
    const Q = this.queen;
    const congested = this.congest.length >= 3 && Math.max(...this.congest) < 0.85;
    // crowding dilutes queen pheromone (queen mandibular pheromone reaches fewer workers)
    const drawnCells = this.nActive - (this.cnt ? this.cnt.undrawn : 0);
    this.crowding = this.nWorkers / (drawnCells * 0.22);
    const youngSurplus = this.roles ? this.roles.nurses / Math.max(1, this.cnt.larvae) : 0;
    const pressure = Math.max(congested ? 1 : 0, this.storageFull ? 1 : 0, clamp((this.crowding - 0.8) / 0.4, 0, 1) * clamp(youngSurplus, 0, 1.2));
    this.swarmPressure = pressure;
    if (!this.swarmPrep && Q.present && Q.mated && Q.laying && this.queenCells.length === 0 && !this.virgins.length && doy >= 100 && doy <= 185 && this.nWorkers > 17000 && pressure > 0.2) {
      if (this.allowSwarm) { if (this.rand() < 0.3 * pressure) this.startSwarmCells(); }
      else if (!this.suppMsg || this.t - this.suppMsg > 24 * 10) { this.say('Swarm impulse detected — beekeeper removed the queen cups (swarming disabled).', 'info'); this.suppMsg = this.t; }
    }
    // supersedure of an aging/failing queen
    if (Q.present && Q.mated && Q.ageD > 2.6 * 365 && doy > 100 && doy < 240 && this.queenCells.length === 0 && !this.virgins.length && this.rand() < 0.02) {
      let made = 0;
      for (let t = 0; t < 4000 && made < 2 && this.nBrood > 0; t++) { const i = this.broodList[(this.rand() * this.nBrood) | 0]; if (this.st[i] === ST.LARVA && this.caste[i] === 0 && this.age[i] < 110 && this.broodDensity(i) < 0.75) { this.st[i] = ST.QCELL; this.queenCells.push({ idx: i, age: this.age[i], kind: 'supersedure', state: 'open' }); made++; } }
      if (made) this.say('Workers are raising supersedure cells to replace the aging queen.', 'warn');
    }
    if (doy > 270 && this.wx.mean < 8 && this.clusterYear !== this.year) { this.say('Cold weather — bees are forming a winter cluster.', 'info'); this.clusterYear = this.year; }
    if (this.nWorkers < 300 && !this.deadMsg) { this.deadMsg = true; this.say('The colony has collapsed.', 'bad'); }
  }

  // ---- what a hive scale would read (kg): woodenware + wax comb + bees + brood + stores
  hiveWeight() {
    const c = this.cnt || {}, drawnFrac = 1 - (c.undrawn || 0) / Math.max(1, this.nActive);
    const wood = 7 + 5.5 * this.nBoxes;                          // floor, inner cover & roof ≈ 7 kg; each box of 10 frames ≈ 5.5 kg
    const wax = 1.0 * this.nBoxes * drawnFrac;                     // ~100 g of wax per drawn deep frame
    const bees = (this.nWorkers * 0.11 + this.nDrones * 0.23) / 1000;
    const brood = (this.broodTotal || 0) * 0.12 / 1000;
    const stores = (c.honeySugar || 0) / 0.82 / 1e6 + ((c.nectarSugar || 0) + (c.nectarWater || 0)) / 1e6 + (c.pollen || 0) / 1e6;
    return wood + wax + bees + brood + stores;
  }

  // ---- winter brood onset: warm spells after the solstice trigger it; cold snaps hold it back
  winterBrood(doy) {
    const T = this.wx.mean;
    this.warm3 = ((this.warm3 ?? T) * 2 + T) / 3;                    // ~3-day running mean temperature
    if (doy >= 250 && doy < 355) { this.winterDrive = 0; this.broodOnset = false; return; }
    if (doy < 100 || doy >= 355) {
      // Nürnberger et al. 2018: onset is mainly temperature-driven but modulated by day length and an internal clock —
      // so the warmth needed falls as the days lengthen after the solstice (mild ~5 °C at first, below freezing by February)
      const since = doy >= 355 ? doy - 355 : doy + 10, need = 5 - 0.22 * since;
      if (!this.broodOnset && this.warm3 >= need) {
        this.broodOnset = true; this.winterDrive = 0.02;
        this.say(`A mild spell (${this.warm3.toFixed(0)} °C) has triggered the queen to start laying again — brood rearing resumes for spring.`, 'info');
      }
      if (this.broodOnset) {
        if (this.warm3 < -2) this.winterDrive *= 0.8;                    // hard cold: the cluster contracts, laying slows
        else this.winterDrive = Math.min(1, this.winterDrive + 0.004 + 0.0025 * Math.max(0, this.warm3));
      }
    } else this.winterDrive = 1;
  }

  // ---------------------------------------------------------------- beekeeper actions
  addSuper() {
    if (this.nBoxes >= MAXBOX) return 'The hive already has the maximum of ' + (MAXBOX - 2) + ' supers.';
    const b = this.nBoxes, drawn = this.drawn[b * 20 * CPS] === 1;
    this.nBoxes++; this.excluder = true; this.buildOrders();
    // fresh frame summaries for the new box so it shows straight away
    for (let sd = b * 20; sd < b * 20 + 20; sd++) { const o = sd * 8; for (let q = 0; q < 8; q++) this.sideStats[o + q] = 0;
      for (let i = sd * CPS; i < (sd + 1) * CPS; i++) { if (!this.drawn[i]) this.sideStats[o + 5]++; else this.sideStats[o + 4]++; } }
    this.say(`Beekeeper added honey super ${b - 1} (${drawn ? 'drawn comb from storage' : 'foundation'}${b === 2 ? ', above a queen excluder' : ''}).`, 'keeper'); return 'ok';
  }
  removeSuper() {
    if (this.nBoxes <= 2) return 'No supers to remove.';
    const b = this.nBoxes - 1, lo = b * 20 * CPS, hi = lo + 20 * CPS;
    let honey = 0, nectar = 0;
    for (let i = lo; i < hi; i++) {
      const s = this.st[i];
      if (s === ST.HONEY) honey += this.sugar[i] / 0.82; else if (s === ST.NECTAR) nectar += this.sugar[i] + this.water[i];
      this.st[i] = ST.EMPTY; this.sugar[i] = 0; this.water[i] = 0; this.pol[i] = 0;   // drawn comb is kept for next time
    }
    this.nBoxes--; if (this.nBoxes <= 2) this.excluder = false; this.buildOrders();
    this.totalHarvest = (this.totalHarvest || 0) + honey;
    this.say(`Beekeeper took off super ${b - 1}: ${(honey / 1e6).toFixed(1)} kg of capped honey extracted` + (nectar > 1e5 ? `, ${(nectar / 1e6).toFixed(1)} kg of unripe nectar lost (too wet to keep — it would ferment)` : '') + '. The drawn comb goes into storage.', 'keeper');
    return 'ok';
  }
  harvest() {
    let got = 0; const n = this.nActive;
    const total = () => { let s = 0; for (let i = 0; i < n; i++) if (this.st[i] === ST.HONEY || this.st[i] === ST.NECTAR) s += this.sugar[i]; return s / 0.82; };
    let keep = 20e6, have = total();
    for (let box = this.nBoxes - 1; box >= 1; box--) {
      for (let i = box * 20 * CPS; i < (box + 1) * 20 * CPS && i < n; i++) {
        if (this.st[i] !== ST.HONEY) continue;
        const m = this.sugar[i] / 0.82;
        if (have - m < keep) continue;   // always leave the bees enough for winter
        got += m; have -= m; this.st[i] = ST.EMPTY; this.sugar[i] = 0; this.water[i] = 0;
      }
    }
    this.say(got > 0 ? `Beekeeper harvested ${(got / 1e6).toFixed(1)} kg of capped honey (leaving ≥ 20 kg for the bees).` : 'Nothing to harvest — not enough capped surplus honey.', 'keeper');
    this.totalHarvest = (this.totalHarvest || 0) + got;
    return got;
  }
  feed() { this.feeder += 5e6; this.say('Beekeeper gave 5 kg of 2:1 sugar syrup.', 'keeper'); }
  introduceQueen() {
    if (this.queen.present) return;
    for (let m = this.queenCells.length - 1; m >= 0; m--) this.removeQC(m);
    this.queen = { present: true, mated: true, virgin: false, ageD: 180, laying: false, layFrom: this.t + 72, droneLayer: false };
    this.virgins = []; this.castMode = false;
    this.layingWorkers = false; this.say('Beekeeper introduced a mated queen in a cage; she should be released and laying in ~3 days.', 'keeper');
  }
}
if (typeof module !== 'undefined') module.exports = { Hive, ST, COLS, ROWS, CPS, FPB, SIDES, NC, DEV, FLORA };
