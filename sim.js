'use strict';
// ============================================================================
//  Apis mellifera colony model — per-bee, per-cell agent simulation
//  Time step: 10 simulated minutes (foraging), hourly (colony), daily (season)
// ============================================================================
const COLS = 80, ROWS = 44, CPS = COLS * ROWS;          // one side of a Langstroth deep ≈ 3,500 cells
const FPB = 10, MAXBOX = 3, SIDES = MAXBOX * FPB * 2, NC = SIDES * CPS;
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
const MONTH_LAY = [0.05, 0.18, 0.42, 0.75, 1.0, 0.95, 0.78, 0.55, 0.33, 0.12, 0.01, 0.0]; // seasonal egg-laying drive (mid-month)

// Forage plants (temperate ~45°N).  bloom = day-of-year window; nectar/pollen = peak supply to this colony (mg/h)
const FLORA = [
  { name: 'Crocus & snowdrops', s: 40, e: 85, conc: .35, nec: 1440, pol: 9900, col: '#ef7d14', d: .12 },
  { name: 'Hazel catkins', s: 25, e: 75, conc: 0, nec: 0, pol: 13500, col: '#e3cf63' },
  { name: 'Willow', s: 68, e: 112, conc: .33, nec: 22400, pol: 40500, col: '#f0c22c' },
  { name: 'Maple', s: 85, e: 125, conc: .3, nec: 19200, pol: 18000, col: '#c4c062' },
  { name: 'Dandelion meadow', s: 92, e: 150, conc: .4, nec: 41600, pol: 72000, col: '#f08a12' },
  { name: 'Cherry & apple orchard', s: 100, e: 135, conc: .35, nec: 48000, pol: 45000, col: '#e6dcb0' },
  { name: 'Horse chestnut', s: 115, e: 145, conc: .3, nec: 19200, pol: 27000, col: '#b3323a' },
  { name: 'Oilseed rape field', s: 108, e: 145, conc: .45, nec: 136000, pol: 67500, col: '#f5d000' },
  { name: 'Hawthorn hedges', s: 125, e: 155, conc: .35, nec: 28800, pol: 22500, col: '#d8cc98' },
  { name: 'Black locust trees', s: 138, e: 162, conc: .45, nec: 176000, pol: 9000, col: '#d6c78a' },
  { name: 'Poppies', s: 140, e: 195, conc: 0, nec: 0, pol: 36000, col: '#2b2a38' },
  { name: 'White clover pasture', s: 150, e: 248, conc: .4, nec: 64000, pol: 45000, col: '#8a5a2b' },
  { name: 'Bramble', s: 160, e: 215, conc: .35, nec: 44800, pol: 31500, col: '#b9b8b0' },
  { name: 'Phacelia strip', s: 165, e: 228, conc: .35, nec: 40000, pol: 40500, col: '#3d61b8' },
  { name: 'Linden (lime) trees', s: 172, e: 200, conc: .4, nec: 160000, pol: 22500, col: '#ebe3a6' },
  { name: 'Fireweed', s: 185, e: 245, conc: .35, nec: 44800, pol: 27000, col: '#6b7fa8' },
  { name: 'Sunflower field', s: 195, e: 245, conc: .4, nec: 64000, pol: 67500, col: '#f2b705' },
  { name: 'Goldenrod', s: 222, e: 285, conc: .4, nec: 56000, pol: 54000, col: '#e3b400' },
  { name: 'Asters', s: 240, e: 295, conc: .3, nec: 22400, pol: 36000, col: '#e8c449' },
  { name: 'Ivy', s: 258, e: 318, conc: .45, nec: 60800, pol: 67500, col: '#f5a623' },
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
    this.wear = new Float32Array(MAXB); this.ftask = new Uint8Array(MAXB); this.fstate = new Uint8Array(MAXB);
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
    const bk = new Float32Array(n), hk = new Float32Array(n);
    const cx = 39.5, cy = 42, cz = 4.5 * 6.5;
    for (let i = 0; i < n; i++) {
      const side = (i / CPS) | 0, b = (side / 20) | 0, f = ((side % 20) / 2) | 0, s = side & 1;
      const k = i % CPS, r = (k / COLS) | 0, c = k % COLS;
      const yUp = b * ROWS + (ROWS - 1 - r);
      const z = f * 6.5 + (s ? 1.2 : -1.2);
      const dx = c - cx, dy = (yUp - cy) * 1.15, dz = z - cz;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      bk[i] = d + this.hash(i) * 1.5;                // brood nest: nearest to centre first
      hk[i] = -(d + 0.9 * (yUp - cy)) + this.hash(i * 7) * 2; // honey: highest/outermost first
    }
    const idx = () => { const a = new Int32Array(n); for (let i = 0; i < n; i++) a[i] = i; return a; };
    this.broodOrder = idx().sort((a, b) => bk[a] - bk[b]);
    this.honeyOrder = idx().sort((a, b) => hk[a] - hk[b]);
    this.nActive = n;
  }
  hash(i) { let x = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b); x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae35); x ^= x >>> 16; return (x >>> 0) / 4294967296; }

  // ---------------------------------------------------------------- bees
  addBee(type, age, wear) {
    let i = this.free.length ? this.free.pop() : (this.nb < MAXB ? this.nb++ : -1);
    if (i < 0) return -1;
    this.alive[i] = 1; this.btype[i] = type; this.bage[i] = age; this.wear[i] = wear;
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
    // patches
    this.patches = FLORA.map((f, k) => {
      const dist = f.d || (0.25 + 3.4 * Math.pow(R(), 1.2));
      const az = R() * 360;
      return Object.assign({}, f, { id: k, dist, az, x: Math.sin(az * DEG) * dist, y: -Math.cos(az * DEG) * dist, bloom: 0, nStock: 0, pStock: 0 });
    });
    const waz = R() * 360;
    this.creek = { name: 'Creek', dist: 0.35, az: waz, x: Math.sin(waz * DEG) * .35, y: -Math.cos(waz * DEG) * .35 };
    const NP = this.patches.length;
    this.flyN = new Int32Array(NP); this.flyP = new Int32Array(NP); this.flyW = 0; this.flyScout = 0; this.flyDrones = 0;
    this.danceN = new Float32Array(NP); this.danceP = new Float32Array(NP);
    this.inPollen = new Float32Array(NP);
    // queen
    this.queen = { present: true, mated: true, ageD: 365, laying: true, virgin: false, vAge: 0, flights: 0, layFrom: 0, droneLayer: false };
    this.queenlessH = 0; this.layingWorkers = false; this.swarmPrep = false; this.swarmEvent = null;
    // buffers & counters
    this.inSugar = 0; this.inWater = 0; this.feeder = 0; this.waterStore = 0; this.fuelSugar = 0; this.eggAcc = 0;
    this.onset = 21; this.danceThr = 0.12; this.unloadDelay = 1; this.landingsH = 0; this.storageFull = false;
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
    // stores: ~10 kg honey left after winter, a little bee-bread
    let honey = 10e6;
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
    this.forage(dt * 60);
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
    this.wear[i] += (dist * 2 + trip * 0.08) / 800;        // ~800 km lifetime flight budget
    this.tripsToday++;
  }
  land(i, newN, newP) {
    const R = this.rand, t = this.ftask[i], p = this.patch[i];
    this.unflight(i);
    // flight hazards: predators, cold-stunning, getting caught in rain
    let risk = 0.003 + (this.Tout < 13 ? 0.01 : 0) + (this.raining ? 0.03 : 0);
    if (R() < risk) { this.killBee(i); this.lostForagers++; return; }
    const trip = this.tripMin[i];
    this.landingsH++;
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
    const houseWear = (0.0065 + 0.05 * Math.min(0.3, larvaeRatio)) / 24;   // nursing load shortens life (vitellogenin)
    const droneFly = !initial && this.hour >= 13 && this.hour < 17 && T >= 19 && !this.raining;
    const evict = this.evictDrones;
    let droneFlying = 0;
    for (let i = 0; i < this.nb; i++) {
      if (!this.alive[i]) continue;
      if (!initial) this.bage[i] += 1 / 24;
      const a = this.bage[i];
      if (this.btype[i] === 0) {
        if (!initial) {
          this.wear[i] += a < onset ? houseWear : 0.01 / 24;
          if (this.wear[i] >= 1 || R() < 0.00005) { this.killBee(i); continue; }
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
    for (let i = 0; i < n; i++) {
      const s = st[i];
      const sd = ((i / CPS) | 0) * 8;
      if (s === ST.EMPTY) { if (this.drawn[i]) { c.emptyDrawn++; ss[sd + 4]++; } else { c.undrawn++; ss[sd + 5]++; } continue; }
      if (s === ST.HONEY) { c.honeySugar += this.sugar[i]; c.sugar += this.sugar[i]; c.honeyCells++; ss[sd + 1]++; continue; }
      if (s === ST.NECTAR) {
        let w = this.water[i]; const sg = this.sugar[i];
        const ex = w - sg * 0.2195;          // excess over 18 % water
        if (ex > 0 && !initial) { w -= ex * evap; this.water[i] = w; c.excess += ex; }
        const conc = sg / (sg + w);
        const vol = sg / SUGAR_DENS + w, cap = this.droneCell[i] ? VOL_D : VOL_W;
        if (conc >= 0.8 && vol >= cap * 0.8 && buildersOK) { st[i] = ST.HONEY; c.honeySugar += sg; c.honeyCells++; ss[sd + 1]++; }
        else { c.nectarSugar += sg; c.nectarWater += w; ss[sd + 2]++; }
        c.sugar += sg; continue;
      }
      if (s === ST.POLLEN) { c.pollen += this.pol[i]; ss[sd + 3]++; continue; }
      if (s === ST.DIRTY) { c.dirty++; ss[sd + 6]++; continue; }
      if (s === ST.QCELL) continue;
      // brood
      const cs = this.caste[i], D = DEV[cs];
      if (!initial) age[i] += 1;
      const a = age[i];
      ss[sd]++;
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
    this.storeNectar();
    this.storePollen();

    // ---------- 6. consumption
    const clustered = T < 14;
    const homeW = this.nWorkers - this.outCount();
    let perBee = clustered ? 0.06 + 0.006 * (15 - T) : 0.3;
    let sugarNeed = homeW * perBee + this.nDrones * 1.0
      + c.larvae * 0.5 + c.dLarvae * 1.4
      + (brood > 0 && T < 32 ? brood * 0.004 * (34 - T) : 0)
      + this.fuelSugar;
    this.fuelSugar = 0;
    const pollenNeed = c.larvae * 0.9 + c.dLarvae * 2.0 + young * 0.15;
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
    if (c.dirty > 0 && toClean > 0) {
      for (let j = 0; j < n && toClean > 0; j++) { const i = this.broodOrder[j]; if (st[i] === ST.DIRTY) { st[i] = ST.EMPTY; toClean--; } }
    }
    const storageFree = c.emptyDrawn / Math.max(1, n - c.undrawn);
    if (c.undrawn > 0 && this.nectar24 > 400e3 && storageFree < 0.2 && T > 15) {
      let k = Math.floor((storers + guards * 0.5) * 0.05 + R());
      for (let j = 0; j < n && k > 0; j++) {
        const i = this.broodOrder[j];
        if (!this.drawn[i]) { this.drawn[i] = 1; k--; this.consumeSugar(100); this.cellsDrawnToday++; }
      }
    }
    // ---------- 9. thermoregulation: brood the bees cannot cover gets chilled
    if (T < 18) {
      const warmable = homeW * 2.3;
      if (brood > warmable) {
        let kill = Math.ceil((brood - warmable) * 0.15);
        for (let j = n - 1; j >= 0 && kill > 0; j--) {
          const i = this.broodOrder[j], s = st[i];
          if (s === ST.EGG || s === ST.LARVA || s === ST.CAPPED) { st[i] = ST.DIRTY; kill--; this.broodDeathsToday++; this.chilledToday++; }
        }
      }
    }
    // ---------- 10. pollen demand signal (brood pheromone vs. stored bee-bread)
    const target = 250e3 + pollenNeed * 24 * 4;
    this.pollenTotal = c.pollen;
    this.pollenNeed = clamp(1 - c.pollen / target, 0, 1);
    // dance threshold rises when unloading is slow or storage is full
    this.danceThr = 0.1 + 0.006 * this.unloadDelay + (this.storageFull ? 0.4 : 0) - (c.sugar < 4e6 ? 0.04 : 0);
  }
  outCount() { return this.flyScout + this.flyW + this.flyN.reduce((a, b) => a + b, 0) + this.flyP.reduce((a, b) => a + b, 0); }

  storeNectar() {
    if (this.inSugar < 1e5) this.storageFull = false;
    if (this.inSugar < 1) return;
    if (this.noRoomUntil && this.t < this.noRoomUntil) { this.storageFull = this.inSugar > 1e5; if (this.inSugar > 3e5) { const f = 3e5 / this.inSugar; this.inSugar *= f; this.inWater *= f; } return; }
    const st = this.st, ord = this.honeyOrder, n = this.nActive;
    const S0 = this.inSugar;
    let S = this.inSugar, W = this.inWater;
    const conc = S / (S + W);
    const perMgVol = conc / SUGAR_DENS + (1 - conc);
    for (let j = 0; j < n && S > 1; j++) {
      const i = ord[j], s = st[i];
      if (!this.drawn[i] || (s !== ST.EMPTY && s !== ST.NECTAR)) continue;
      const cap = this.droneCell[i] ? VOL_D : VOL_W;
      const vol = s === ST.NECTAR ? this.sugar[i] / SUGAR_DENS + this.water[i] : 0;
      const room = cap - vol; if (room < 15) continue;
      const mass = Math.min(room / perMgVol, (S + W));
      const ds = mass * conc, dw = mass - ds;
      if (s === ST.EMPTY) { st[i] = ST.NECTAR; this.sugar[i] = 0; this.water[i] = 0; }
      this.sugar[i] += ds; this.water[i] += dw; S -= ds; W -= dw;
    }
    this.storageFull = S > 1e5;
    this.noRoomUntil = (S0 - S) < 1000 ? this.t + 6 : 0;
    if (S > 3e5) { const f = 3e5 / S; S *= f; W *= f; }   // bees can only hold so much in their crops
    if (this.storageFull && (!this.fullMsg || this.t - this.fullMsg > 24 * 5)) { this.say('No room left to store nectar — the hive is honey-bound (a beekeeper would add a super).', 'warn'); this.fullMsg = this.t; }
    this.inSugar = Math.max(0, S); this.inWater = Math.max(0, W);
  }
  placePollen(p, amount, start) {
    const st = this.st, ord = this.broodOrder, n = this.nActive;
    for (let j = start; j < n && amount > 1; j++) {
      const i = ord[j], s = st[i];
      if (!this.drawn[i] || this.droneCell[i] || this.boxOf(i) === 2) continue;
      if (s === ST.EMPTY || (s === ST.POLLEN && this.pol[i] < POLLEN_CAP_W)) {
        if (s === ST.EMPTY) { st[i] = ST.POLLEN; this.pol[i] = 0; }
        const add = Math.min(POLLEN_CAP_W - this.pol[i], amount);
        this.pol[i] += add; amount -= add; if (p >= 0) this.pcol[i] = p + 1;
      }
    }
    return amount;
  }
  storePollen() {
    if (this.noPollenRoomUntil && this.t < this.noPollenRoomUntil) { this.inPollen.fill(0); return; }
    let before = 0; for (let p = 0; p < this.inPollen.length; p++) before += this.inPollen[p];
    if (before < 1) return;
    const start = Math.min(this.nActive - 1, Math.floor((this.broodTotal || 0) * 1.08) + 300);
    for (let p = 0; p < this.inPollen.length; p++) {
      if (this.inPollen[p] < 1) continue;
      this.inPollen[p] = this.placePollen(p, this.inPollen[p], start);
      if (this.inPollen[p] > 0) this.inPollen[p] = this.placePollen(p, this.inPollen[p], 0);
    }
    let after = 0; for (let p = 0; p < this.inPollen.length; p++) after += this.inPollen[p];
    if (after > before * 0.9) { this.noPollenRoomUntil = this.t + 6; this.inPollen.fill(0); }
  }
  consumeSugar(need) {
    let got = 0;
    if (this.inSugar > 0) { const m = Math.min(this.inSugar, need); this.inSugar -= m; this.inWater *= (this.inSugar / (this.inSugar + m) || 0); got += m; need -= m; }
    const st = this.st, ord = this.broodOrder, n = this.nActive;
    for (let j = 0; j < n && need > 0.01; j++) {
      const i = ord[j], s = st[i];
      if (s !== ST.HONEY && s !== ST.NECTAR) continue;
      const sg = this.sugar[i], m = Math.min(sg, need);
      const f = 1 - m / sg;
      this.sugar[i] = sg - m; this.water[i] *= f; got += m; need -= m;
      if (this.sugar[i] < 2) { st[i] = ST.EMPTY; this.sugar[i] = 0; this.water[i] = 0; }
      else if (s === ST.HONEY) st[i] = ST.NECTAR;   // uncapped once bees open it
    }
    return got;
  }
  consumePollen(need) {
    let got = 0; const st = this.st, ord = this.broodOrder, n = this.nActive;
    for (let j = 0; j < n && need > 0.01; j++) {
      const i = ord[j]; if (st[i] !== ST.POLLEN) continue;
      const m = Math.min(this.pol[i], need); this.pol[i] -= m; got += m; need -= m;
      if (this.pol[i] < 1) { st[i] = ST.EMPTY; this.pol[i] = 0; }
    }
    return got;
  }

  // ---------------------------------------------------------------- queen biology
  queenLayRate() {
    const q = this.queen; if (!q.present || !q.laying) return 0;
    const d = this.doy, m = d / 30.42 - 0.5, i0 = ((Math.floor(m) % 12) + 12) % 12, f = m - Math.floor(m);
    let season = MONTH_LAY[i0] * (1 - f) + MONTH_LAY[(i0 + 1) % 12] * f;
    const yrs = q.ageD / 365;
    let max = 1800 * (yrs > 2 ? Math.max(0.35, 1 - 0.2 * (yrs - 2)) : 1);
    let res = 1;
    if (this.pollenTotal < 80e3 && this.pollenToday < 50e3 && this.doy > 40) res *= 0.4;
    if (this.cnt.sugar < 2e6) res *= 0.4;
    if (this.nectar24 > 1e6) res *= 1.1;
    return max * season * res * (this.swarmPrep ? 0.35 : 1);
  }
  queenHour(c, nurseCap) {
    const q = this.queen, R = this.rand, st = this.st, n = this.nActive;
    // -- egg laying
    let rate = this.queenLayRate();
    if (this.layingWorkers && !q.present) rate = 120;
    if (rate > 0) {
      const nurseF = clamp(nurseCap * 1.4 / (c.eggs + c.larvae + c.dLarvae + 1), 0.15, 1);
      rate *= nurseF;
      this.eggAcc += rate / 24;
      let want = Math.floor(this.eggAcc); this.eggAcc -= want;
      const droneOK = (this.doy >= 90 && this.doy <= 200 && this.nWorkers > 8000 && c.sugar > 4e6) || q.droneLayer || (this.layingWorkers && !q.present);
      let nd = q.droneLayer || (this.layingWorkers && !q.present) ? want : (droneOK ? Math.round(want * 0.05) : 0);
      let nw = want - nd;
      const allDrone = nd === want;
      let laid = 0, last = -1, j;
      for (j = 0; j < n && (nw > 0 || nd > 0); j++) {
        const i = this.broodOrder[j];
        if (st[i] !== ST.EMPTY || !this.drawn[i]) continue;
        if (this.excluder && this.boxOf(i) === 2) continue;
        if (this.droneCell[i]) { if (nd > 0) { st[i] = ST.EGG; this.caste[i] = 1; this.age[i] = 0; nd--; laid++; last = i; } continue; }
        if (allDrone) { if (nd > 0) { st[i] = ST.EGG; this.caste[i] = 1; this.age[i] = 0; nd--; laid++; last = i; } continue; }
        if (nw > 0) { st[i] = ST.EGG; this.caste[i] = 0; this.age[i] = 0; nw--; laid++; last = i; }
      }
      this.wantToday += want; this.laidToday += laid;
      if (last >= 0) this.queenSide = this.sideOf(last);
    }
    // -- queen cells
    for (let k = this.queenCells.length - 1; k >= 0; k--) {
      const qc = this.queenCells[k];
      if (qc.age < 0) { if (q.present && q.laying) qc.age += 1; else { this.removeQC(k); continue; } }
      else qc.age += 1;
      if (qc.age >= 384) {
        this.removeQC(k);
        if (!q.virgin && !(q.present && q.mated && qc.kind !== 'supersedure')) {
          if (q.present && qc.kind === 'supersedure') this.say('The old queen has been superseded.', 'info');
          this.queen = { present: true, mated: false, virgin: true, vAge: 0, flights: 0, ageD: 0, laying: false, layFrom: 0, droneLayer: false };
          this.say('A virgin queen emerged and is destroying rival queen cells.', 'good');
          for (let m = this.queenCells.length - 1; m >= 0; m--) this.removeQC(m);
          break;
        }
      }
    }
    const Q = this.queen;
    // -- swarm issue
    if (this.swarmPrep && Q.present && Q.mated && this.queenCells.some(x => x.age >= 200) && this.hour >= 10 && this.hour <= 15 && this.Tout >= 16 && !this.raining) this.issueSwarm();
    // -- virgin queen maturation & mating flights (afternoons, ≥ 20 °C)
    if (Q.virgin) {
      Q.vAge += 1 / 24;
      if (Q.vAge > 5 && this.hour >= 13 && this.hour <= 16 && this.Tout >= 20 && !this.raining && R() < 0.3) {
        if (R() < 0.06) { this.queen = { present: false }; this.say('The virgin queen was lost on her mating flight.', 'bad'); }
        else {
          Q.flights++; this.say(`Virgin queen returned from mating flight ${Q.flights} (mated with ~${8 + (R() * 10 | 0)} drones).`, 'info');
          if (Q.flights >= 2 || R() < 0.3) { Q.virgin = false; Q.mated = true; Q.layFrom = this.t + 60 + R() * 24; }
        }
      }
      if (Q.virgin && Q.vAge > 26) { Q.virgin = false; Q.droneLayer = true; Q.layFrom = this.t; this.say('The queen failed to mate — she is laying only drone eggs.', 'bad'); }
    }
    if (Q.present && !Q.laying && Q.layFrom && this.t >= Q.layFrom) { Q.laying = true; this.say(Q.droneLayer ? 'Drone-laying queen has begun laying.' : 'The new queen has started laying eggs!', Q.droneLayer ? 'bad' : 'good'); }
    if (Q.present) {
      Q.ageD += 1 / 24;
      if (R() < (Q.ageD > 4 * 365 ? 0.002 : 0.000004)) { this.queen = { present: false }; this.say('The queen has died.', 'bad'); }
    }
    // -- queenless: emergency queen rearing from young worker larvae
    if (!this.queen.present && this.queenCells.length === 0) {
      let made = 0;
      for (let j = 0; j < n && made < 4; j++) {
        const i = this.broodOrder[j];
        if (st[i] === ST.LARVA && this.caste[i] === 0 && this.age[i] < 120) { st[i] = ST.QCELL; this.queenCells.push({ idx: i, age: this.age[i], kind: 'emergency' }); made++; }
      }
      if (made) this.say(`Queenless: workers are raising ${made} emergency queen cells from young larvae.`, 'warn');
      else {
        this.queenlessH++;
        if (!this.layingWorkers && this.queenlessH > 24 * 21 && c.eggs + c.larvae + c.capped === 0) { this.layingWorkers = true; this.say('Hopelessly queenless — laying workers have developed (drone eggs only).', 'bad'); }
      }
    } else if (this.queen.present) { this.queenlessH = 0; if (this.queen.mated) this.layingWorkers = false; }
  }
  removeQC(k) { const qc = this.queenCells[k]; if (this.st[qc.idx] === ST.QCELL) this.st[qc.idx] = ST.DIRTY; this.queenCells.splice(k, 1); }
  startSwarmCells() {
    const R = this.rand, k = 6 + (R() * 9 | 0);
    for (let m = 0; m < k; m++) {
      const f = 1 + (R() * 8 | 0), s = R() < .5 ? 0 : 1, side = (1 * 10 + f) * 2 + s;
      const r = ROWS - 1 - (R() * 2 | 0), cc = 14 + (R() * 52 | 0);
      const i = side * CPS + r * COLS + cc;
      if (this.st[i] === ST.QCELL) continue;
      this.st[i] = ST.QCELL; this.queenCells.push({ idx: i, age: -Math.floor(R() * 72) - 1, kind: 'swarm' });
    }
    this.swarmPrep = true;
    this.say(`Swarm preparations: workers built ${this.queenCells.length} queen cells along the frame bottoms; the queen is slimming down.`, 'warn');
  }
  issueSwarm() {
    const R = this.rand; let left = 0, dr = 0;
    for (let i = 0; i < this.nb; i++) {
      if (!this.alive[i]) continue;
      if (this.btype[i] === 0) { if (this.fstate[i] === 1) continue; if (R() < (this.bage[i] < this.onset ? 0.62 : 0.45)) { this.killBee(i); this.deathsToday--; left++; } }
      else if (R() < 0.3) { this.killBee(i); this.deathsToday--; dr++; }
    }
    this.consumeSugar(left * 30);
    this.queen = { present: false }; this.swarmPrep = false;
    this.swarmEvent = { t: this.t, n: left };
    this.say(`🐝 PRIME SWARM! The old queen left with ~${left.toLocaleString()} workers and ${dr} drones, each carrying ~35 mg of honey.`, 'swarm');
  }

  // ---------------------------------------------------------------- daily
  resetDay() {
    this.nectarToday = 0; this.pollenToday = 0; this.waterToday = 0; this.tripsToday = 0; this.laidToday = 0; this.wantToday = 0;
    this.deathsToday = 0; this.lostForagers = 0; this.broodDeathsToday = 0; this.emergedToday = 0; this.sugarUsedToday = 0; this.pollenUsedToday = 0;
    this.chilledToday = 0; this.cellsDrawnToday = 0;
  }
  daily(d) {
    const c = this.cnt || {};
    this.nectar24 = this.nectarToday;
    const rec = {
      day: this.day, doy: this.day % 365, workers: this.nWorkers, drones: this.nDrones,
      brood: this.broodTotal || 0, honey: (c.honeySugar || 0) / 0.82 / 1e6, nectar: ((c.nectarSugar || 0) + (c.nectarWater || 0)) / 1e6,
      sugarKg: (c.sugar || 0) / 1e6, pollen: (c.pollen || 0) / 1e6, nectarIn: this.nectarToday / 1e6, pollenIn: this.pollenToday / 1e3,
      laid: this.laidToday, deaths: this.deathsToday, trips: this.tripsToday, temp: this.wx ? this.wx.mean : 0,
      chilled: this.chilledToday, emerged: this.emergedToday,
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
    // drone eviction at the end of the season / dearth
    const wasEvict = this.evictDrones;
    this.evictDrones = (doy > 228 && (this.nectar24 < 150e3 || doy > 258)) || doy > 290 || doy < 60 || (this.cnt && this.cnt.sugar < 3e6) || (this.queen.present === false && false);
    if (this.queen.present === false || this.queen.virgin) this.evictDrones = false;
    if (this.evictDrones && !wasEvict && this.nDrones > 50) this.say('Workers are evicting the drones from the hive.', 'info');
    if (doy === 172) this.say('Summer solstice — the colony is near peak population.', 'info');
    // swarm impulse check
    const Q = this.queen;
    const congested = this.congest.length >= 3 && Math.max(...this.congest) < 0.85;
    // crowding dilutes queen pheromone (queen mandibular pheromone reaches fewer workers)
    const drawnCells = this.nActive - (this.cnt ? this.cnt.undrawn : 0);
    this.crowding = this.nWorkers / (drawnCells * 0.22);
    const youngSurplus = this.roles ? this.roles.nurses / Math.max(1, this.cnt.larvae) : 0;
    const pressure = Math.max(congested ? 1 : 0, this.storageFull ? 1 : 0, clamp((this.crowding - 0.8) / 0.4, 0, 1) * clamp(youngSurplus, 0, 1.2));
    this.swarmPressure = pressure;
    if (!this.swarmPrep && Q.present && Q.mated && Q.laying && this.queenCells.length === 0 && doy >= 100 && doy <= 185 && this.nWorkers > 17000 && pressure > 0.2) {
      if (this.allowSwarm) { if (this.rand() < 0.3 * pressure) this.startSwarmCells(); }
      else if (!this.suppMsg || this.t - this.suppMsg > 24 * 10) { this.say('Swarm impulse detected — beekeeper removed the queen cups (swarming disabled).', 'info'); this.suppMsg = this.t; }
    }
    // supersedure of an aging/failing queen
    if (Q.present && Q.mated && Q.ageD > 2.6 * 365 && doy > 100 && doy < 240 && this.queenCells.length === 0 && this.rand() < 0.02) {
      let made = 0;
      for (let j = 0; j < this.nActive && made < 2; j++) { const i = this.broodOrder[j]; if (this.st[i] === ST.LARVA && this.caste[i] === 0 && this.age[i] < 110) { this.st[i] = ST.QCELL; this.queenCells.push({ idx: i, age: this.age[i], kind: 'supersedure' }); made++; } }
      if (made) this.say('Workers are raising supersedure cells to replace the aging queen.', 'warn');
    }
    if (doy > 270 && this.wx.mean < 8 && this.clusterYear !== this.year) { this.say('Cold weather — bees are forming a winter cluster.', 'info'); this.clusterYear = this.year; }
    if (this.nWorkers < 300 && !this.deadMsg) { this.deadMsg = true; this.say('The colony has collapsed.', 'bad'); }
  }

  // ---------------------------------------------------------------- beekeeper actions
  addSuper() {
    if (this.nBoxes >= 3) return 'Already has a super.';
    this.nBoxes = 3; this.excluder = true; this.buildOrders();
    this.say('Beekeeper added a honey super (foundation, above a queen excluder).', 'keeper'); return 'ok';
  }
  harvest() {
    let got = 0; const n = this.nActive;
    const total = () => { let s = 0; for (let i = 0; i < n; i++) if (this.st[i] === ST.HONEY || this.st[i] === ST.NECTAR) s += this.sugar[i]; return s / 0.82; };
    let keep = 20e6, have = total();
    for (const box of [2, 1]) {
      for (let i = box * 20 * CPS; i < (box + 1) * 20 * CPS && i < n; i++) {
        if (this.st[i] !== ST.HONEY) continue;
        const m = this.sugar[i] / 0.82;
        if (box === 1 && have - m < keep) continue;
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
    this.layingWorkers = false; this.say('Beekeeper introduced a mated queen in a cage; she should be released and laying in ~3 days.', 'keeper');
  }
}
if (typeof module !== 'undefined') module.exports = { Hive, ST, COLS, ROWS, CPS, FPB, SIDES, NC, DEV, FLORA };
