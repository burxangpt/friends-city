import * as THREE from 'three';
import { io } from '/socket.io/socket.io.esm.min.js';

const $ = s => document.querySelector(s);
const PI = Math.PI;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const angDiff = (a, b) => { let d = (b - a) % (2 * PI); if (d > PI) d -= 2 * PI; if (d < -PI) d += 2 * PI; return d; };
function rng(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const R = rng(20260);

/* ---------- renderer / scene ---------- */
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.body.prepend(renderer.domElement);
const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x9fd0ee, 70, 230);
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 500);
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });

const hemi = new THREE.HemisphereLight(0xcfe8ff, 0x6a7a4a, 1.1); scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff0d0, 2.6);
sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -55, right: 55, top: 55, bottom: -55, near: 1, far: 220 });
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.04;
scene.add(sun, sun.target);
const SUN_OFF = new THREE.Vector3(45, 75, 30);

const mat = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.85, metalness: 0, ...o });
const box = (w, h, d, m, x, y, z, shadow = true) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); o.castShadow = shadow; o.receiveShadow = true; scene.add(o); return o; };

/* ---------- world ---------- */
const colliders = [];
const addCollider = (cx, cz, w, d) => colliders.push({ minx: cx - w / 2, maxx: cx + w / 2, minz: cz - d / 2, maxz: cz + d / 2 });

const ground = new THREE.Mesh(new THREE.PlaneGeometry(300, 300).rotateX(-PI / 2), mat(0x6fae5a));
ground.receiveShadow = true; scene.add(ground);

const ROADS = [-100, -60, -20, 20, 60, 100];
const roadMat = mat(0x3b3a4a, { roughness: 0.95 });
for (const k of ROADS) { box(260, 0.04, 8, roadMat, 0, 0.02, k, false); box(8, 0.04, 260, roadMat, k, 0.02, 0, false); }
const dashGeo = new THREE.BoxGeometry(2.4, 0.01, 0.25);
const dashes = [];
for (const k of ROADS) for (let t = -125; t <= 125; t += 6) {
  if (ROADS.some(o => Math.abs(t - o) < 5.5)) continue;
  dashes.push([t, k, 0], [k, t, PI / 2]);
}
const dashMesh = new THREE.InstancedMesh(dashGeo, new THREE.MeshBasicMaterial({ color: 0xe9d9a6 }), dashes.length);
const dm = new THREE.Object3D();
dashes.forEach(([x, z, r], i) => { dm.position.set(x, 0.05, z); dm.rotation.y = r; dm.updateMatrix(); dashMesh.setMatrixAt(i, dm.matrix); });
scene.add(dashMesh);

/* ---------- materials, textures, helpers ---------- */
const glowMats = []; let glowLevel = 0;
const WALLS = [0xf2d9b8, 0xe8b9a0, 0xc9d8c5, 0xb9cfe0, 0xf0e2a8, 0xd8c0d8, 0xf2c26b, 0xe3a39a];
const ROOFS = [0x9c4a3c, 0x5d6b8a, 0x6b4a3a, 0x3f5a52, 0x7a2f2a];
const cache = {};
const cm = (c, o = {}) => (cache[c + JSON.stringify(o)] ||= mat(c, o));
const BX = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const CYL = (r, h) => new THREE.CylinderGeometry(r, r, h, 8);
function put(g, geo, m, x, y, z, rx = 0, ry = 0, rz = 0) {
  const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.rotation.set(rx, ry, rz); o.castShadow = o.receiveShadow = true; g.add(o); return o;
}
const glassMat = new THREE.MeshStandardMaterial({ color: 0x7fa6c9, roughness: 0.15, metalness: 0.3, emissive: 0xffc77a, emissiveIntensity: 0 });
glowMats.push(glassMat);
function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}

/* facades: windows with frames, glass gradient, lit windows at night */
function facade(seed, rows, arch) {
  const r = rng(seed), wins = [];
  if (arch) for (const px of [16, 62, 158, 204]) wins.push([px, 52, 36, 122]);
  else for (let row = 0; row < rows; row++) for (let c = 0; c < 3; c++) wins.push([30 + c * 76, rows === 1 ? 40 : 20 + row * 80, 42, rows === 1 ? 80 : 60]);
  const lit = wins.map(() => r() < 0.6);
  const path = (x, px, py, w, h) => {
    x.beginPath();
    if (arch) { x.moveTo(px, py + h); x.lineTo(px, py + w / 2); x.arc(px + w / 2, py + w / 2, w / 2, PI, 0); x.lineTo(px + w, py + h); } else x.rect(px, py, w, h);
    x.closePath();
  };
  const color = canvasTex(256, 256, x => {
    x.fillStyle = '#efe8dc'; x.fillRect(0, 0, 256, 256);
    wins.forEach(([px, py, w, h]) => {
      const e = arch ? 7 : 5;
      path(x, px - e, py - e, w + 2 * e, h + e); x.fillStyle = '#f9f6ee'; x.fill();
      const g = x.createLinearGradient(0, py, 0, py + h); g.addColorStop(0, '#b4d3ea'); g.addColorStop(1, '#5d86ad');
      path(x, px, py, w, h); x.fillStyle = g; x.fill();
      x.strokeStyle = arch ? '#3b3f48' : '#f9f6ee'; x.lineWidth = arch ? 2 : 3; x.beginPath();
      x.moveTo(px + w / 2, py); x.lineTo(px + w / 2, py + h); x.moveTo(px, py + h * 0.55); x.lineTo(px + w, py + h * 0.55);
      if (arch) for (let k = 1; k < 5; k++) { x.moveTo(px + k * w / 5, py + h * 0.55); x.lineTo(px + k * w / 5, py + h); }
      x.stroke();
      if (!arch) { x.fillStyle = '#cfc6b6'; x.fillRect(px - 7, py + h + 3, w + 14, 5); }
    });
  });
  const glow = canvasTex(256, 256, x => {
    x.fillStyle = '#000'; x.fillRect(0, 0, 256, 256);
    wins.forEach(([px, py, w, h], i) => { if (lit[i]) { path(x, px, py, w, h); x.fillStyle = '#ffc77a'; x.fill(); } });
  });
  return [color, glow];
}
const facades1 = [1, 2, 3, 4].map(n => facade(n, 1, false)), facades2 = [1, 2, 3, 4].map(n => facade(n, 2, false)), facadesA = [1, 2, 3, 4].map(n => facade(n, 1, true));

const logT = canvasTex(128, 256, (x, w) => {
  for (let i = 0; i < 8; i++) { x.fillStyle = ['#8a5a36', '#7a4c2c', '#94643c'][i % 3]; x.fillRect(0, i * 32, w, 30); x.fillStyle = '#4a2c18'; x.fillRect(0, i * 32 + 30, w, 2); }
});
logT.wrapS = logT.wrapT = THREE.RepeatWrapping;
const lmCache = {};
const logMat = (rx, ry) => (lmCache[rx + ',' + ry] ||= (() => { const t = logT.clone(); t.needsUpdate = true; t.repeat.set(rx, ry); return new THREE.MeshStandardMaterial({ map: t, roughness: 0.9 }); })());

function gable(g, len, span, h, color, y, oh, wallColor) {
  const S = span / 2 + oh, sh = new THREE.Shape(); sh.moveTo(-S, 0); sh.lineTo(S, 0); sh.lineTo(0, h); sh.closePath();
  put(g, new THREE.ExtrudeGeometry(sh, { depth: len, bevelEnabled: false }).translate(0, 0, -len / 2).rotateY(PI / 2), cm(color), 0, y, 0);
  const k = (span / 2) / S, t = new THREE.Shape(); t.moveTo(-span / 2, 0); t.lineTo(span / 2, 0); t.lineTo(0, h * k); t.closePath();
  for (const s of [-1, 1]) { const m = new THREE.Mesh(new THREE.ShapeGeometry(t), cm(wallColor, { side: THREE.DoubleSide })); m.position.set(s * (len / 2 + 0.02), y, 0); m.rotation.y = s * PI / 2; g.add(m); }
}
function win(g, w, h, x, y, z, fc = 0xf4efe6) {
  put(g, BX(w + 0.25, h + 0.25, 0.1), cm(fc), x, y, z);
  put(g, BX(w, h, 0.14), glassMat, x, y, z + 0.01);
  put(g, BX(0.06, h, 0.18), cm(fc), x, y, z + 0.02); put(g, BX(w, 0.06, 0.18), cm(fc), x, y, z + 0.02);
}
const door = (g, x, z, w, h, c) => put(g, BX(w, h, 0.12), cm(c), x, h / 2, z + 0.05);

/* ---------- structures (door faces +z) ---------- */
function buildClassic(w, d, floors, wall, roof, fi, arch) {
  const g = new THREE.Group(), h = arch ? 3.8 : floors === 1 ? 5 : 7.5, dx = 0;
  const [map, em] = (arch ? facadesA : floors === 1 ? facades1 : facades2)[fi];
  const m = new THREE.MeshStandardMaterial({ color: wall, map, emissive: 0xffffff, emissiveMap: em, emissiveIntensity: glowLevel, roughness: 0.9 });
  glowMats.push(m); g.userData.mats = [m];
  put(g, BX(w, h, d), m, 0, h / 2, 0);
  put(g, BX(w + 0.3, 0.6, d + 0.3), cm(arch ? 0xe07a6a : 0x8a8478), 0, 0.3, 0);
  gable(g, w + 0.4, d, arch ? 1.8 : 3, roof, h, arch ? 0.9 : 0.6, wall);
  if (!arch) put(g, BX(0.9, 2.2, 0.9), cm(0x7a6a62), w * 0.25, h + 1.8, -d * 0.15);
  put(g, BX(1.9, 2.8, 0.2), cm(0xf4efe6), dx, 1.4, d / 2 + 0.02);
  door(g, dx, d / 2 + 0.05, 1.5, 2.5, 0x7a2a30);
  put(g, new THREE.SphereGeometry(0.07, 8, 6), cm(0xf4efe6), dx + 0.5, 1.2, d / 2 + 0.2);
  put(g, BX(2.6, 0.38, 0.6), cm(0xa39d93), dx, 0.19, d / 2 + 0.3);
  put(g, BX(2.6, 0.19, 0.6), cm(0xa39d93), dx, 0.1, d / 2 + 0.9);
  return g;
}
function buildCabin() {
  const g = new THREE.Group(), brown = 0x4a2f22;
  put(g, BX(6, 3, 5), logMat(1, 1.25), 0, 1.5, -1);
  gable(g, 6.8, 5, 1.8, brown, 3, 0.7, 0x8a5a36);
  put(g, BX(6, 0.25, 2), cm(0x9a6a40), 0, 0.12, 2.5);
  for (const s of [-1, 1]) put(g, CYL(0.12, 2.6), cm(0x5a3a22), s * 2.8, 1.3, 3.3);
  put(g, BX(6.4, 0.15, 2.5), cm(brown), 0, 2.8, 2.5, 0.17);
  door(g, 0, 1.5, 1.0, 2.0, 0x3a2418);
  win(g, 0.9, 0.9, -2, 1.6, 1.53, 0x3a2a1c); win(g, 0.9, 0.9, 2, 1.6, 1.53, 0x3a2a1c);
  put(g, BX(0.8, 2.6, 0.8), cm(0x7d7770), -2.2, 3.6, -2.5);
  return g;
}
function buildLodge() {
  const g = new THREE.Group(), wood = cm(0x9a6a40);
  put(g, BX(7, 6, 6), logMat(1, 2.5), 0, 3, -1.5);
  gable(g, 7.8, 6, 3, 0x3d4f66, 6, 0.8, 0x8a5a36);
  put(g, BX(7, 0.25, 3), wood, 0, 0.12, 3); put(g, BX(7, 0.2, 3), wood, 0, 3.1, 3);
  for (const s of [-1, 1]) put(g, CYL(0.14, 3), cm(0x5a3a22), s * 3.3, 1.5, 4.3);
  put(g, BX(7, 0.1, 0.1), wood, 0, 3.9, 4.45);
  for (const s of [-1, 1]) put(g, BX(0.1, 0.1, 3), wood, s * 3.45, 3.9, 3);
  for (let i = -3; i <= 3; i++) put(g, BX(0.07, 0.8, 0.07), wood, i, 3.5, 4.45);
  door(g, 0, 1.5, 1.1, 2.1, 0x3a2418);
  win(g, 1, 1, -2.3, 1.7, 1.53, 0x3a2a1c); win(g, 1, 1, 2.3, 1.7, 1.53, 0x3a2a1c);
  win(g, 1, 1.2, -2.3, 4.6, 1.53, 0x3a2a1c); win(g, 1.3, 2, 0, 4.4, 1.53, 0x3a2a1c); win(g, 1, 1.2, 2.3, 4.6, 1.53, 0x3a2a1c);
  put(g, BX(0.9, 3, 0.9), cm(0x7d7770), 2.4, 7.4, -3.2);
  return g;
}
function buildModern() {
  const g = new THREE.Group(), dark = cm(0x14161b);
  put(g, BX(9, 3.2, 5.5), cm(0x23262d), 0, 1.6, -1.25);
  put(g, BX(10, 0.35, 6.5), dark, 0, 3.4, -0.75);
  put(g, BX(7.4, 2.6, 0.12), glassMat, -0.4, 1.5, 1.55);
  for (const x of [-4, -2.2, -0.4, 1.4, 3.2]) put(g, BX(0.1, 2.7, 0.16), dark, x, 1.5, 1.56);
  put(g, BX(1.4, 3.2, 0.15), cm(0x7a5236), 4.0, 1.6, 1.55);
  put(g, BX(10, 0.3, 2.5), cm(0x6b4a32), 0, 0.15, 2.75);
  put(g, BX(4, 0.18, 0.8), cm(0x6b4a32), 0, 0.09, 4.4);
  return g;
}
function buildVilla() {
  const g = new THREE.Group(), dark = cm(0x1d1f25);
  put(g, BX(7, 3.2, 5), dark, -1.5, 1.6, -2);
  put(g, BX(3, 3.2, 5.5), cm(0xcfc9bd), 3.5, 1.6, -1.75);
  put(g, BX(9.4, 3, 6), dark, -0.5, 4.7, -1.5);
  put(g, BX(9.8, 0.3, 6.4), cm(0x111317), -0.5, 6.35, -1.5);
  put(g, BX(1.4, 6.2, 1), cm(0x77746c, { flatShading: true }), -4.2, 3.1, 1.0);
  put(g, BX(5.4, 2.2, 0.12), glassMat, -1.0, 4.7, 1.56);
  put(g, BX(3.6, 2.5, 0.12), glassMat, -1.7, 1.5, 0.56);
  door(g, 0.9, 0.5, 1.2, 2.4, 0x7a5236);
  put(g, BX(2.6, 2.4, 0.1), cm(0xd9d6cf), 3.5, 1.2, 1.06);
  put(g, BX(3.6, 0.04, 4.2), cm(0x8a8d93), 3.5, 0.02, 3.1);
  put(g, BX(1.8, 0.6, 3.6), cm(0x9aa0a8, { metalness: 0.6, roughness: 0.3 }), 3.5, 0.65, 3.1);
  put(g, BX(1.5, 0.5, 1.8), cm(0x2a3140), 3.5, 1.2, 2.9);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) put(g, new THREE.CylinderGeometry(0.33, 0.33, 0.2, 10), cm(0x15161a), 3.5 + sx * 0.95, 0.33, 3.1 + sz * 1.2, 0, 0, PI / 2);
  return g;
}
function buildShalash() {
  const g = new THREE.Group(), L = Math.hypot(2, 2.8), phi = Math.atan2(2, 2.8);
  const stick = cm(0x7a5a30, { flatShading: true }), leaf = cm(0x4f8a3a, { flatShading: true });
  for (const s of [-1, 1]) {
    put(g, BX(0.14, L, 4.2), stick, s * 1.0, 1.4, 0, 0, 0, s * phi);
    put(g, BX(0.1, L * 0.85, 3.9), leaf, s * 1.1, 1.46, 0, 0, 0, s * phi);
  }
  const tri = new THREE.Shape(); tri.moveTo(-2, 0); tri.lineTo(2, 0); tri.lineTo(0, 2.8); tri.closePath();
  const back = new THREE.Mesh(new THREE.ShapeGeometry(tri), cm(0x7a5a30, { side: THREE.DoubleSide })); back.position.z = -2.1; g.add(back);
  const op = new THREE.Shape(); op.moveTo(-0.8, 0); op.lineTo(0.8, 0); op.lineTo(0, 1.9); op.closePath();
  const hole = new THREE.Mesh(new THREE.ShapeGeometry(op), new THREE.MeshBasicMaterial({ color: 0x120d08 })); hole.position.z = 2.12; g.add(hole);
  for (const s of [-1, 1]) put(g, CYL(0.07, 2.2), stick, s * 0.9, 1.1, 2.15, 0, 0, s * -0.3);
  const stone = cm(0x77746c, { flatShading: true });
  for (let i = 0; i < 6; i++) { const a = i * PI / 3; put(g, new THREE.IcosahedronGeometry(0.2, 0), stone, Math.cos(a) * 0.6, 0.15, 3.4 + Math.sin(a) * 0.6); }
  const ember = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.6, 6), new THREE.MeshBasicMaterial({ color: 0xff8a2a })); ember.position.set(0, 0.35, 3.4); g.add(ember);
  return g;
}
function buildBunker() {
  const g = new THREE.Group(), conc = cm(0x6f776b);
  put(g, BX(7, 3.4, 6), conc, 0, 1.7, 0);
  put(g, BX(7.4, 0.9, 6.4), cm(0x4f7a3f, { flatShading: true }), 0, 3.85, 0);
  put(g, BX(3.6, 3, 0.5), cm(0x838b7d), 0, 1.5, 3.05);
  put(g, BX(2.4, 2.5, 0.2), cm(0x4a4f55, { metalness: 0.5, roughness: 0.5 }), 0, 1.25, 3.35);
  put(g, BX(0.14, 2.3, 0.1), cm(0x2b2f35), 0, 1.25, 3.48);
  put(g, BX(0.8, 0.7, 0.15), glassMat, -2.3, 2.2, 3.02);
  put(g, CYL(0.2, 1.4), cm(0x4a4f55), 2.4, 5, -1.5);
  const moss = cm(0x4d6b3a, { flatShading: true });
  put(g, BX(1.8, 1.2, 0.06), moss, -2, 1.1, 3.02); put(g, BX(1.2, 0.8, 0.06), moss, 2.5, 2.4, 3.02);
  return g;
}
function buildRedBunker() {
  const g = new THREE.Group(), red = cm(0xa43f2b, { metalness: 0.2, roughness: 0.7 });
  const sh = new THREE.Shape(); sh.moveTo(-3, 0); sh.lineTo(3, 0); sh.lineTo(3, 3.6); sh.lineTo(0, 3.6); sh.closePath();
  put(g, new THREE.ExtrudeGeometry(sh, { depth: 5, bevelEnabled: false }).translate(0, 0, -2.5), red, 0, 0, 0);
  put(g, BX(1.4, 2.4, 0.12), cm(0x8a3322, { metalness: 0.3 }), 1.5, 1.5, 2.55);
  put(g, CYL(0.07, 0.4), cm(0x2b2f35), 2.0, 1.5, 2.7, PI / 2);
  for (const y of [0.5, 2.9, 3.3]) put(g, BX(2.9, 0.05, 0.04), cm(0x7e2f20), 1.5, y, 2.52);
  put(g, new THREE.TorusGeometry(0.3, 0.06, 6, 12), cm(0x2b2f35), 1.5, 3.8, 0);
  return g;
}
function buildEnterable(w, d, wall, roof, fi) {
  const g = new THREE.Group(), H = 4.2, t = 0.4, hw = w / 2, hd = d / 2, DG = 0.9, DH = 2.7;
  const [map, em] = facades1[fi], mats = []; g.userData.mats = mats;
  const piece = (u0, u1, v0, v1) => {
    const a = map.clone(), b = em.clone(); a.needsUpdate = b.needsUpdate = true;
    a.repeat.set(u1 - u0, v1 - v0); a.offset.set(u0, v0); b.repeat.copy(a.repeat); b.offset.copy(a.offset);
    const m = new THREE.MeshStandardMaterial({ color: wall, map: a, emissive: 0xffffff, emissiveMap: b, emissiveIntensity: glowLevel, roughness: 0.9 });
    mats.push(m); glowMats.push(m); return m;
  };
  const wb = (bw, bh, bd, x, y, z, u0, u1, v0, v1) => put(g, BX(bw, bh, bd), piece(u0, u1, v0, v1), x, y, z);
  const uL = (hw - DG) / w, uR = (hw + DG) / w;
  wb(w, H, t, 0, H / 2, -hd + t / 2, 0, 1, 0, 1);
  wb(t, H, d - 2 * t, -hw + t / 2, H / 2, 0, 0, 1, 0, 1);
  wb(t, H, d - 2 * t, hw - t / 2, H / 2, 0, 0, 1, 0, 1);
  wb(hw - DG, H, t, -(hw + DG) / 2, H / 2, hd - t / 2, 0, uL, 0, 1);
  wb(hw - DG, H, t, (hw + DG) / 2, H / 2, hd - t / 2, uR, 1, 0, 1);
  wb(2 * DG, H - DH, t, 0, (H + DH) / 2, hd - t / 2, uL, uR, DH / H, 1);
  put(g, BX(w - 2 * t, 0.1, d - 2 * t), cm(0xb08a5a), 0, 0.05, 0);
  const trim = cm(0xf4efe6);
  for (const s of [-1, 1]) put(g, BX(0.18, DH, 0.5), trim, s * DG, DH / 2, hd - t / 2);
  put(g, BX(2 * DG + 0.36, 0.18, 0.5), trim, 0, DH + 0.09, hd - t / 2);
  put(g, BX(2.6, 0.38, 0.6), cm(0xa39d93), 0, 0.19, hd + 0.3); put(g, BX(2.6, 0.19, 0.6), cm(0xa39d93), 0, 0.1, hd + 0.9);
  const rg = new THREE.Group(); g.add(rg); g.userData.roof = rg;
  gable(rg, w + 0.5, d, 3.4, roof, H, 0.7, wall);
  put(rg, BX(1, 2.4, 1), cm(0x7a6a62), w * 0.28, H + 2, -d * 0.2);
  /* interior */
  put(g, BX(4, 0.03, 3), cm(0xb85c4a), 0, 0.12, -2.2);
  put(g, BX(3, 0.5, 1), cm(0x4f6d8a), 0, 0.35, -4.9); put(g, BX(3, 0.8, 0.25), cm(0x4f6d8a), 0, 0.6, -5.4);
  put(g, BX(1.6, 0.4, 0.8), cm(0x7a5236), 0, 0.3, -3.2);
  put(g, BX(2.2, 0.5, 3.2), cm(0xe8e0d0), -4.4, 0.35, -4.2); put(g, BX(1.4, 0.2, 0.6), cm(0xffffff), -4.4, 0.7, -5.5);
  put(g, BX(2, 0.8, 1.2), cm(0x8a5a36), 4.2, 0.5, 1.5);
  for (const z of [0.5, 2.5]) put(g, BX(0.6, 0.5, 0.6), cm(0xb08a5a), 4.2, 0.35, z);
  put(g, BX(0.5, 2.4, 2.5), cm(0x6b4a32), -5.7, 1.3, 0.5);
  put(g, BX(3, 0.9, 0.8), cm(0xd8d4cc), 4.5, 0.55, -5.4);
  put(g, CYL(0.05, 1.6), cm(0x2b2f45), 2.4, 0.9, -5.0); put(g, new THREE.SphereGeometry(0.25, 10, 8), lampMat, 2.4, 1.8, -5.0);
  return g;
}
function buildStructure(type, data, fi) {
  const wall = WALLS[data.wall], roof = ROOFS[data.roof];
  switch (type) {
    case 'cabin': return buildCabin();
    case 'lodge': return buildLodge();
    case 'modern': return buildModern();
    case 'villa': return buildVilla();
    case 'shalash': return buildShalash();
    case 'bunker': return buildBunker();
    case 'redbunker': return buildRedBunker();
    case 'uzbek': return buildClassic(10, 8, 1, wall, roof, fi, true);
    default: return data.floors === 1 ? buildEnterable(13, 13, wall, roof, fi) : buildClassic(13, 13, data.floors, wall, roof, fi, false);
  }
}
const FP = { classic: [13, 13], cabin: [8, 7], lodge: [10, 9], modern: [10, 8], villa: [10, 10], uzbek: [10, 8], shalash: [5, 5], bunker: [7, 6], redbunker: [6, 5] };
const LABEL_H = { cabin: 6.5, lodge: 11, modern: 6, villa: 9.5, uzbek: 7.5, shalash: 5, bunker: 6.5, redbunker: 6 };

function house(x, z, rot, w, d, floors, wall, roof, fi) {
  const g = buildClassic(w, d, floors, wall, roof, fi, fi === 3);
  g.position.set(x, 0.08, z); g.rotation.y = rot * PI / 2; scene.add(g);
  addCollider(x, z, rot % 2 ? d : w, rot % 2 ? w : d);
}

const lampMat = new THREE.MeshStandardMaterial({ color: 0xfff2c0, emissive: 0xffd27a, emissiveIntensity: 0 });
const poleMat = mat(0x2b2f45);
const treeMats = [mat(0x4f9a4a, { flatShading: true }), mat(0x5fae52, { flatShading: true }), mat(0x3f8a58, { flatShading: true })];
const trunkMat = mat(0x6b4a32);
function tree(x, z, s) {
  const g = new THREE.Group();
  const t = new THREE.Mesh(new THREE.CylinderGeometry(0.22 * s, 0.32 * s, 2 * s, 6), trunkMat); t.position.y = s; g.add(t);
  const f1 = new THREE.Mesh(new THREE.IcosahedronGeometry(1.7 * s, 0), treeMats[(R() * 3) | 0]); f1.position.y = 3.1 * s; g.add(f1);
  const f2 = new THREE.Mesh(new THREE.IcosahedronGeometry(1.1 * s, 0), treeMats[(R() * 3) | 0]); f2.position.set(0.5 * s, 4.3 * s, 0.2 * s); g.add(f2);
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  g.position.set(x, 0.08, z); g.rotation.y = R() * PI; scene.add(g);
}
function lamp(x, z) {
  const p = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.1, 4.2, 6), poleMat); p.position.set(x, 2.1, z);
  const b = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8), lampMat); b.position.set(x, 4.3, z);
  scene.add(p, b);
}

const isPlotBlock = (i, j) => Math.abs(i) <= 1 && Math.abs(j) <= 1 && !(i === 0 && j === 0) && !(i === 1 && j === 0);
const plotSlots = [];
for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) {
  const cx = i * 40, cz = j * 40;
  box(33, 0.06, 33, mat(0xb9b2a5), cx, 0.03, cz, false);
  box(29, 0.08, 29, mat(0x78b862), cx, 0.04, cz, false);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) lamp(cx + sx * 15.5, cz + sz * 15.5);
  if (i === 0 && j === 0) continue;       // plaza
  if (i === 1 && j === 0) continue;       // cinema
  if (isPlotBlock(i, j)) { let k = 0; for (const sx of [-1, 1]) for (const sz of [-1, 1]) plotSlots.push({ id: i + ',' + j + ',' + (k++), x: cx + sx * 8, z: cz + sz * 8, rot: sz > 0 ? 0 : 2 }); continue; }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const w = 8 + R() * 3, d = 8 + R() * 3, rot = (R() * 4) | 0;
    house(cx + sx * 8 + (R() - .5) * 2, cz + sz * 8 + (R() - .5) * 2, rot, w, d, R() < .5 ? 1 : 2,
      WALLS[(R() * WALLS.length) | 0], ROOFS[(R() * ROOFS.length) | 0], (R() * 4) | 0);
  }
}

/* plaza */
{
  const p = new THREE.Mesh(new THREE.CylinderGeometry(13, 13, 0.12, 40), mat(0xd6cdbd)); p.position.y = 0.1; p.receiveShadow = true; scene.add(p);
  const basin = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.6, 0.9, 24), mat(0x9aa0a8)); basin.position.y = 0.5; basin.castShadow = basin.receiveShadow = true; scene.add(basin);
  const water = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 0.1, 24), mat(0x4aa8d8, { roughness: 0.2, metalness: 0.2 })); water.position.y = 0.92; scene.add(water);
  const col = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.45, 2.8, 10), mat(0x9aa0a8)); col.position.y = 1.6; col.castShadow = true; scene.add(col);
  const top = new THREE.Mesh(new THREE.SphereGeometry(0.7, 12, 10), mat(0xb7d9ee, { roughness: 0.2 })); top.position.y = 3.2; scene.add(top);
  addCollider(0, 0, 7.4, 7.4);
  for (let k = 0; k < 4; k++) {
    const a = k * PI / 2 + PI / 4, bx = Math.cos(a) * 8, bz = Math.sin(a) * 8;
    const bench = new THREE.Group();
    const seat = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.2, 0.8), mat(0x8a5a3a)); seat.position.y = 0.55;
    const back = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.7, 0.12), mat(0x8a5a3a)); back.position.set(0, 0.95, -0.4);
    bench.add(seat, back); bench.traverse(o => { if (o.isMesh) o.castShadow = true; });
    bench.position.set(bx, 0.1, bz); bench.rotation.y = -a - PI / 2; scene.add(bench);
    addCollider(bx, bz, 2.4, 2.4);
  }
  for (let k = 0; k < 8; k++) { const a = k * PI / 4; tree(Math.cos(a) * 13.5, Math.sin(a) * 13.5, 1.1); }
}

/* cinema */
{
  const cx = 40, cz = -4;
  box(22, 9, 14, mat(0x3a2a55), cx, 4.5, cz);
  box(24, 0.8, 16, mat(0x241a38), cx, 9.4, cz);
  addCollider(cx, cz, 22, 14);
  const c = document.createElement('canvas'); c.width = 512; c.height = 128;
  const x = c.getContext('2d');
  x.fillStyle = '#14132b'; x.fillRect(0, 0, 512, 128);
  x.strokeStyle = '#ffb27a'; x.lineWidth = 6; x.strokeRect(6, 6, 500, 116);
  x.fillStyle = '#ffb27a'; x.font = '600 56px Unbounded, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('КИНОТЕАТР', 256, 66);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(12, 3), new THREE.MeshBasicMaterial({ map: tex })); sign.position.set(cx, 7, cz + 7.05); scene.add(sign);
  const door = new THREE.Mesh(new THREE.PlaneGeometry(5, 3.6), new THREE.MeshBasicMaterial({ color: 0xffd27a })); door.position.set(cx, 1.8, cz + 7.05); scene.add(door);
}

/* free trees */
for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) {
  if ((i === 0 && j === 0) || (i === 1 && j === 0)) continue;
  if (isPlotBlock(i, j)) { for (const [tx, tz] of [[-14, 0], [14, 0], [0, -14], [0, 14]]) tree(i * 40 + tx, j * 40 + tz, 1); continue; }
  for (let n = 0; n < 6; n++) {
    const x = i * 40 + (R() - .5) * 27, z = j * 40 + (R() - .5) * 27;
    if (colliders.some(c => x > c.minx - 2.5 && x < c.maxx + 2.5 && z > c.minz - 2.5 && z < c.maxz + 2.5)) continue;
    tree(x, z, 0.8 + R() * 0.6);
  }
}

/* stars */
const starPos = new Float32Array(900);
for (let i = 0; i < 300; i++) { const u = R() * 2 * PI, v = R() * 0.45 * PI + 0.05, r = 320; starPos.set([Math.cos(u) * Math.cos(v) * r, Math.sin(v) * r, Math.sin(u) * Math.cos(v) * r], i * 3); }
const starGeo = new THREE.BufferGeometry(); starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false }));
scene.add(stars);

/* ---------- day / night ---------- */
const C = (h) => new THREE.Color(h);
const daySky = C(0x9fd0ee), nightSky = C(0x0e1030), sky = new THREE.Color();
const dayHemi = C(0xcfe8ff), nightHemi = C(0x3a4a8a), daySun = C(0xfff0d0), nightSun = C(0x7f95ff);
const dayGround = C(0x6fae5a), nightGround = C(0x2c4a3a);
let nightT = 0, nightV = -1;
function applyNight(v) {
  sky.lerpColors(daySky, nightSky, v); scene.background = sky; scene.fog.color.copy(sky);
  hemi.color.lerpColors(dayHemi, nightHemi, v); hemi.intensity = 1.1 - 0.75 * v;
  sun.color.lerpColors(daySun, nightSun, v); sun.intensity = 2.6 - 2.1 * v;
  ground.material.color.lerpColors(dayGround, nightGround, v);
  glowLevel = 1.4 * v; glowMats.forEach(m => m.emissiveIntensity = glowLevel);
  lampMat.emissiveIntensity = 3 * v; stars.material.opacity = v;
  renderer.toneMappingExposure = 1 - 0.1 * v;
}

/* ---------- avatars ---------- */
function label(text) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64; const x = c.getContext('2d');
  x.font = '600 28px Onest, sans-serif'; const w = Math.min(240, x.measureText(text).width + 28);
  x.fillStyle = 'rgba(20,19,43,.75)'; x.beginPath(); x.roundRect((256 - w) / 2, 8, w, 48, 14); x.fill();
  x.fillStyle = '#f6efe6'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(text, 128, 33, 224);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true })); s.scale.set(2.6, 0.65, 1); s.position.y = 2.75; return s;
}
const SKINS = [0xf2c9a0, 0xdba77a, 0xb07a52, 0x7a4e32, 0xfce0c8], HAIRS = [0x2a1d1a, 0x5a3a22, 0xc9a24a, 0x15151a, 0xa33a2a];
function makeAvatar(hue, name) {
  const g = new THREE.Group(), n = Math.floor(hue), style = n % 3;
  const skin = mat(SKINS[n % 5]), hair = mat(HAIRS[(n >> 1) % 5]), cloth = mat(new THREE.Color().setHSL(hue / 360, 0.6, 0.55));
  const pants = mat(new THREE.Color().setHSL(((hue + 200) % 360) / 360, 0.35, 0.28)), shoe = mat(0xf4f1ea), dark = mat(0x111111), white = mat(0xffffff);
  const add = (geo, m, x, y, z, parent = g) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = true; parent.add(o); return o; };
  add(new THREE.CapsuleGeometry(0.34, 0.5, 4, 10), cloth, 0, 1.22, 0);
  add(new THREE.CylinderGeometry(0.35, 0.35, 0.09, 12), mat(0x2a1d1a), 0, 0.95, 0);
  add(new THREE.SphereGeometry(0.32, 18, 14), skin, 0, 1.95, 0);
  add(new THREE.SphereGeometry(0.345, 18, 10, 0, 2 * PI, 0, PI / 2), hair, 0, 1.99, -0.02);
  if (style === 1) add(BX(0.62, 0.7, 0.2), hair, 0, 1.78, -0.27);
  if (style === 2) { add(new THREE.CylinderGeometry(0.46, 0.46, 0.05, 16), cloth, 0, 2.2, 0); add(new THREE.CylinderGeometry(0.3, 0.32, 0.22, 16), cloth, 0, 2.3, 0); }
  for (const s of [-1, 1]) { add(new THREE.SphereGeometry(0.065, 8, 8), white, 0.115 * s, 1.97, 0.27); add(new THREE.SphereGeometry(0.035, 8, 8), dark, 0.115 * s, 1.97, 0.325); }
  add(BX(0.12, 0.025, 0.02), dark, 0, 1.84, 0.31);
  const limb = (x, y, parts) => { const p = new THREE.Group(); p.position.set(x, y, 0); parts(p); g.add(p); return p; };
  const leg = x => limb(x, 0.85, p => { add(BX(0.24, 0.78, 0.28), pants, 0, -0.39, 0, p); add(BX(0.27, 0.14, 0.4), shoe, 0, -0.73, 0.06, p); });
  const arm = x => limb(x, 1.55, p => { add(BX(0.17, 0.34, 0.2), cloth, 0, -0.17, 0, p); add(BX(0.14, 0.3, 0.16), skin, 0, -0.47, 0, p); add(new THREE.SphereGeometry(0.09, 8, 8), skin, 0, -0.65, 0, p); });
  g.userData = { legL: leg(-0.15), legR: leg(0.15), armL: arm(-0.46), armR: arm(0.46) };
  g.add(label(name)); scene.add(g); return g;
}
function swing(g, moving, t, speed) {
  const s = moving ? Math.sin(t * speed) * 0.8 : 0, u = g.userData;
  u.legL.rotation.x += (s - u.legL.rotation.x) * 0.4; u.legR.rotation.x += (-s - u.legR.rotation.x) * 0.4;
  u.armL.rotation.x += (-s - u.armL.rotation.x) * 0.4; u.armR.rotation.x += (s - u.armR.rotation.x) * 0.4;
}

/* ---------- plots ---------- */
const plots = new Map();
const lotMat = new THREE.MeshBasicMaterial({ color: 0x7fe0c4, transparent: true, opacity: 0.28 });
const postMat = mat(0xf6efe6);
function setColliders(p, boxes) {
  (p.colliders || []).forEach(c => { const i = colliders.indexOf(c); if (i >= 0) colliders.splice(i, 1); });
  p.colliders = boxes; boxes.forEach(b => colliders.push(b));
}
function wbox(s, x0, x1, z0, z1) {
  const f = s.rot === 0 ? 1 : -1, ax = s.x + f * x0, bx = s.x + f * x1, az = s.z + f * z0, bz = s.z + f * z1;
  return { minx: Math.min(ax, bx), maxx: Math.max(ax, bx), minz: Math.min(az, bz), maxz: Math.max(az, bz) };
}
function renderPlot(slot, data) {
  let p = plots.get(slot.id);
  if (!p) { p = { slot, group: null, colliders: [], data: null }; plots.set(slot.id, p); }
  if (p.group) { scene.remove(p.group); (p.group.userData.mats || []).forEach(m => { const i = glowMats.indexOf(m); if (i >= 0) glowMats.splice(i, 1); }); }
  p.data = data;
  let g;
  if (data && data.owner) {
    const type = data.type || 'classic', fi = [...slot.id].reduce((a, c) => a + c.charCodeAt(0), 0) % 4;
    g = buildStructure(type, data, fi);
    const lb = label(data.owner); lb.position.y = LABEL_H[type] || (data.floors === 1 ? 9 : 11.5); lb.scale.set(3.4, 0.85, 1); g.add(lb);
    const [fw, fd] = FP[type] || [10, 10];
    if (type === 'classic' && data.floors === 1) {
      const hw = fw / 2, hd = fd / 2, t = 0.4, e = 0.2, DG = 0.9;
      setColliders(p, [wbox(slot, -hw - e, hw + e, -hd - e, -hd + t + e), wbox(slot, -hw - e, -hw + t + e, -hd, hd), wbox(slot, hw - t - e, hw + e, -hd, hd),
        wbox(slot, -hw - e, -DG, hd - t - e, hd + e), wbox(slot, DG, hw + e, hd - t - e, hd + e)]);
    } else setColliders(p, [wbox(slot, -fw / 2, fw / 2, -fd / 2, fd / 2)]);
  } else {
    setColliders(p, []);
    g = new THREE.Group();
    const pad = new THREE.Mesh(new THREE.PlaneGeometry(13, 13).rotateX(-PI / 2), lotMat); pad.position.y = 0.02; g.add(pad);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) { const po = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1.1, 0.3), postMat); po.position.set(sx * 6.5, 0.55, sz * 6.5); po.castShadow = true; g.add(po); }
    const lb = label('Свободный участок'); lb.position.y = 3; lb.scale.set(4.4, 1.1, 1); g.add(lb);
  }
  g.position.set(slot.x, 0.08, slot.z); g.rotation.y = slot.rot * PI / 2; scene.add(g); p.group = g;
}
plotSlots.forEach(s => renderPlot(s, null));

/* ---------- input ---------- */
const keys = {}; const chatInput = $('#chatInput');
let fp = false, yaw = 0, pitch = 0.35, fpPitch = 0, dist = 11, drag = false, insideNow = false;
const typing = () => document.activeElement === chatInput;
addEventListener('keydown', e => {
  if (typing()) { if (e.code === 'Escape') chatInput.blur(); return; }
  if (!me) return;
  keys[e.code] = true; if (e.code === 'Space') e.preventDefault();
  if (e.code === 'KeyV') { fp = !fp; $('#cross').style.display = fp ? 'block' : 'none'; fp ? renderer.domElement.requestPointerLock() : document.exitPointerLock(); }
  if (e.code === 'KeyN') nightT = nightT ? 0 : 1;
  if (e.code === 'KeyE' && nearPlot && !(nearPlot.data && nearPlot.data.owner) && !myPlotId) socket.emit('claim', nearPlot.slot.id);
  if (e.code === 'KeyB' && myPlotId && nearPlot && nearPlot.slot.id === myPlotId) openEditor();
  if (e.code === 'Escape') closeEditor();
  if (e.code === 'KeyH') goHome();
  if (e.code === 'Enter') { e.preventDefault(); chatInput.focus(); for (const k in keys) keys[k] = false; }
});
addEventListener('keyup', e => { keys[e.code] = false; });
renderer.domElement.addEventListener('mousedown', () => drag = true);
addEventListener('mouseup', () => drag = false);
addEventListener('mousemove', e => {
  if (!me || !(drag || document.pointerLockElement)) return;
  yaw -= e.movementX * 0.0035;
  if (fp) fpPitch = clamp(fpPitch - e.movementY * 0.0035, -1.2, 1.2); else pitch = clamp(pitch + e.movementY * 0.0035, 0.05, 1.3);
});
addEventListener('wheel', e => { dist = clamp(dist + e.deltaY * 0.01, 4, 24); });

/* ---------- network ---------- */
let socket = null, me = null, myId = null;
const pos = { x: 0, z: 12 }; let face = 0, moving = false, netT = 0, time = 0, jy = 0, vy = 0;
const remotes = new Map();
const logEl = $('#log');
function addMsg(name, text) {
  const d = document.createElement('div'), b = document.createElement('b');
  b.textContent = name + ': '; d.append(b, document.createTextNode(text)); logEl.append(d);
  while (logEl.children.length > 8) logEl.firstChild.remove();
}
function addRemote(p) {
  if (p.id === myId || remotes.has(p.id)) return;
  const av = makeAvatar(p.hue, p.name); av.position.set(p.x, 0.08, p.z);
  remotes.set(p.id, { av, x: p.x, z: p.z, ry: p.ry, m: 0 });
}
let myName = '', myPlotId = null, nearPlot = null, lastHint = null;
const hintEl = $('#hint'), editorEl = $('#editor'), TOKEN_KEY = 'fc_token';
const slotById = new Map(plotSlots.map(s => [s.id, s]));
function refreshMyPlot() { myPlotId = null; plots.forEach((p, id) => { if (p.data && p.data.owner === myName) myPlotId = id; }); }

const hex = n => '#' + n.toString(16).padStart(6, '0');
function styleSet(patch) { const p = plots.get(myPlotId); if (p) socket.emit('style', { id: myPlotId, ...p.data, ...patch }); }
function swatches(box, list, key) { list.forEach((c, i) => { const b = document.createElement('button'); b.type = 'button'; b.style.background = hex(c); b.setAttribute('aria-label', 'Цвет ' + (i + 1)); b.addEventListener('click', () => styleSet({ [key]: i })); box.append(b); }); }
swatches($('#wallSw'), WALLS, 'wall'); swatches($('#roofSw'), ROOFS, 'roof');
$('#fl1').onclick = () => styleSet({ floors: 1 }); $('#fl2').onclick = () => styleSet({ floors: 2 });
$('#edDone').onclick = closeEditor;
let delArm = 0; const delBtn = $('#edDel');
delBtn.onclick = () => {
  if (!delArm) { delBtn.textContent = 'Точно снести?'; delArm = setTimeout(() => { delArm = 0; delBtn.textContent = 'Снести дом'; }, 4000); }
  else { clearTimeout(delArm); delArm = 0; delBtn.textContent = 'Снести дом'; socket.emit('release', myPlotId); }
};
const TYPES = [['classic', 'Дом'], ['cabin', 'Хижина'], ['lodge', 'Сруб'], ['modern', 'Стеклянный'], ['villa', 'Вилла'], ['uzbek', 'Ташкентский'], ['shalash', 'Шалаш'], ['bunker', 'Бункер', 1], ['redbunker', 'Красный бункер', 1]];
function buildTypes(admin) {
  TYPES.forEach(([id, name, adm]) => {
    if (adm && !admin) return;
    const b = document.createElement('button'); b.type = 'button'; b.dataset.t = id; b.textContent = name;
    b.addEventListener('click', () => styleSet({ type: id })); $('#typeBox').append(b);
  });
}
function refreshEditor() {
  const p = plots.get(myPlotId); if (!p || !p.data) return;
  const t = p.data.type || 'classic', col = t === 'classic' || t === 'uzbek';
  $('#wallSw').style.display = $('#roofSw').style.display = col ? 'flex' : 'none';
  $('#flRow').style.display = t === 'classic' ? 'flex' : 'none';
  document.querySelectorAll('#typeBox button').forEach(b => b.classList.toggle('on', b.dataset.t === t));
}
function openEditor() { if (document.pointerLockElement) document.exitPointerLock(); fp = false; $('#cross').style.display = 'none'; editorEl.style.display = 'block'; refreshEditor(); }
function closeEditor() { editorEl.style.display = 'none'; }

function goHome() {
  const p = myPlotId && plots.get(myPlotId);
  if (!p) { addMsg('Город', 'У вас пока нет дома. Подойдите к свободному участку и нажмите E'); return; }
  const s = p.slot; pos.x = s.x; pos.z = s.z + (s.rot === 0 ? 7 : -7); resolve(pos);
  yaw = s.rot === 0 ? 0 : PI; face = s.rot === 0 ? PI : 0; me.rotation.y = face; jy = 0; vy = 0;
  camera.position.set(pos.x, 6, pos.z + (s.rot === 0 ? 11 : -11));
}
$('#homeBtn').onclick = e => { goHome(); e.currentTarget.blur(); };
$('#inviteBtn').onclick = async e => {
  e.currentTarget.blur();
  let url = location.origin;
  if (/^(localhost|127\.)/.test(location.hostname)) {
    try { const i = await (await fetch('/api/info')).json(); if (i.ips.length) url = 'http://' + i.ips[0] + ':' + i.port; } catch (err) { /* ignore */ }
    addMsg('Город', 'Ссылка для друзей из вашей Wi-Fi сети: ' + url + ' . Для друзей из других мест игру нужно выложить в интернет (файл ХОСТИНГ.md)');
  } else addMsg('Город', 'Ссылка для друзей: ' + url);
  try { await navigator.clipboard.writeText(url); } catch (err) { /* ignore */ }
};
socket = io();
localStorage.removeItem(TOKEN_KEY);
socket.on('connect', () => { if (me) location.reload(); });
function auth(kind) { $('#authErr').textContent = ''; socket.emit(kind, { name: $('#name').value.trim(), pass: $('#pass').value }); }
$('#joinForm').addEventListener('submit', e => { e.preventDefault(); auth('login'); });
$('#regBtn').addEventListener('click', () => auth('register'));
socket.on('autherr', m => { $('#authErr').textContent = m; });
socket.on('init', d => {
  myId = d.id; buildTypes(d.admin);
  const self = d.players.find(p => p.id === myId); myName = self.name; pos.x = self.x; pos.z = self.z;
  me = makeAvatar(self.hue, self.name); me.position.set(pos.x, 0.08, pos.z);
  d.players.forEach(addRemote);
  plotSlots.forEach(s => renderPlot(s, d.plots[s.id] || null)); refreshMyPlot(); if (myPlotId) goHome();
  $('#join').style.display = 'none'; $('#hud').style.display = 'block';
  addMsg('Город', 'Добро пожаловать, ' + self.name + '!');
});
socket.on('plot', ({ id, data }) => { renderPlot(slotById.get(id), data); refreshMyPlot(); if (!myPlotId) closeEditor(); else if (editorEl.style.display === 'block') refreshEditor(); });
socket.on('notice', t => addMsg('Город', t));
socket.on('joined', p => { addRemote(p); addMsg('Город', p.name + ' вошёл в город'); });
socket.on('moved', d => { const r = remotes.get(d.id); if (r) Object.assign(r, { x: d.x, z: d.z, ry: d.ry, m: d.m, y: d.y || 0 }); });
socket.on('left', id => { const r = remotes.get(id); if (r) { scene.remove(r.av); remotes.delete(id); } });
socket.on('count', n => $('#online').textContent = 'В городе: ' + n);
socket.on('chat', d => addMsg(d.name, d.text));
chatInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') { const t = chatInput.value.trim(); if (t && socket) socket.emit('chat', t); chatInput.value = ''; chatInput.blur(); }
});

/* ---------- loop ---------- */
const PR = 0.45;
function resolve(p) {
  for (const c of colliders) {
    const cx = clamp(p.x, c.minx, c.maxx), cz = clamp(p.z, c.minz, c.maxz), dx = p.x - cx, dz = p.z - cz, d2 = dx * dx + dz * dz;
    if (d2 >= PR * PR) continue;
    if (d2 > 1e-8) { const d = Math.sqrt(d2); p.x = cx + dx / d * PR; p.z = cz + dz / d * PR; }
    else { const l = p.x - c.minx, r = c.maxx - p.x, t = p.z - c.minz, b = c.maxz - p.z, m = Math.min(l, r, t, b);
      if (m === l) p.x = c.minx - PR; else if (m === r) p.x = c.maxx + PR; else if (m === t) p.z = c.minz - PR; else p.z = c.maxz + PR; }
  }
  p.x = clamp(p.x, -118, 118); p.z = clamp(p.z, -118, 118);
}
function updateMe(dt) {
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
  const iz = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0);
  const ix = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0);
  let mx = fx * iz + rx * ix, mz = fz * iz + rz * ix; const len = Math.hypot(mx, mz);
  moving = len > 0; const run = !!keys.ShiftLeft;
  if (moving) { mx /= len; mz /= len; const sp = run ? 10 : 5.5; pos.x += mx * sp * dt; pos.z += mz * sp * dt; resolve(pos); face = Math.atan2(mx, mz); }
  me.rotation.y += angDiff(me.rotation.y, face) * Math.min(1, dt * 12);
  if (keys.Space && jy === 0) vy = 9.5;
  vy -= 22 * dt; jy += vy * dt; if (jy <= 0) { jy = 0; vy = 0; }
  me.position.set(pos.x, 0.08 + jy, pos.z); me.visible = !fp;
  swing(me, moving, time, run ? 16 : 10);
  if (fp) {
    camera.position.set(pos.x, 1.95 + jy, pos.z);
    camera.lookAt(pos.x + fx * Math.cos(fpPitch), 1.95 + jy + Math.sin(fpPitch), pos.z + fz * Math.cos(fpPitch));
  } else {
    const dd = insideNow ? Math.min(dist, 5.5) : dist, pp = insideNow ? Math.max(pitch, 1.0) : pitch;
    const ty = 1.7 + jy * 0.3, ox = Math.sin(yaw) * Math.cos(pp) * dd, oy = Math.sin(pp) * dd, oz = Math.cos(yaw) * Math.cos(pp) * dd;
    camera.position.lerp(new THREE.Vector3(pos.x + ox, Math.max(0.6, ty + oy), pos.z + oz), Math.min(1, dt * 14));
    camera.lookAt(pos.x, ty, pos.z);
  }
  sun.position.set(pos.x, 0, pos.z).add(SUN_OFF); sun.target.position.set(pos.x, 0, pos.z); sun.target.updateMatrixWorld();
  let near = null, nd = 9;
  plots.forEach(p => { const d = Math.hypot(pos.x - p.slot.x, pos.z - p.slot.z); if (d < nd) { nd = d; near = p; } });
  nearPlot = near;
  const inP = near && near.group && near.group.userData.roof && Math.abs(pos.x - near.slot.x) < 6.2 && Math.abs(pos.z - near.slot.z) < 6.2 ? near : null;
  insideNow = !!inP;
  plots.forEach(q => { const r = q.group && q.group.userData.roof; if (r) r.visible = q !== inP; });
  let hint = '';
  if (near) hint = !(near.data && near.data.owner) ? (myPlotId ? 'У вас уже есть участок' : 'E — занять этот участок') : near.data.owner === myName ? 'B — изменить дом' : 'Дом игрока ' + near.data.owner;
  if (hint !== lastHint) { lastHint = hint; hintEl.textContent = hint; hintEl.style.display = hint ? 'block' : 'none'; }
  if (editorEl.style.display === 'block' && !(near && near.slot.id === myPlotId)) closeEditor();
  netT += dt; if (socket && netT > 1 / 30) { netT = 0; socket.emit('move', { x: pos.x, z: pos.z, ry: me.rotation.y, m: moving, y: jy }); }
}
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now; time += dt;
  if (me) updateMe(dt);
  else { const a = time * 0.08; camera.position.set(Math.cos(a) * 62, 22, Math.sin(a) * 62); camera.lookAt(0, 3, 0); }
  const k = 1 - Math.exp(-18 * dt);
  remotes.forEach(r => {
    const a = r.av; a.position.x += (r.x - a.position.x) * k; a.position.z += (r.z - a.position.z) * k; a.position.y += (0.08 + (r.y || 0) - a.position.y) * k;
    a.rotation.y += angDiff(a.rotation.y, r.ry) * k; swing(a, r.m, time, 10);
  });
  nightV += (nightT - nightV) * Math.min(1, dt * 2.5);
  if (nightV < 0 || Math.abs(nightT - nightV) > 0.002) applyNight(Math.max(0, nightV));
  renderer.render(scene, camera); requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
