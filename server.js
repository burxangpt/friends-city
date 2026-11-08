const express = require('express');
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
if (fs.existsSync(__dirname + '/public/index.html')) app.use(express.static(__dirname + '/public'));
else {
  const send = f => (req, res) => res.sendFile(__dirname + '/' + f);
  app.get('/', send('index.html')); app.get('/index.html', send('index.html')); app.get('/main.js', send('main.js'));
}
app.get('/api/info', (req, res) => {
  const ips = [];
  for (const list of Object.values(os.networkInterfaces())) for (const i of list || []) if (i.family === 'IPv4' && !i.internal) ips.push(i.address);
  res.json({ port: req.socket.localPort, ips });
});

/* ---------- storage: data.json, or Upstash Redis when UPSTASH_* variables are set ---------- */
const DATA = process.env.DATA_FILE || __dirname + '/data.json';
const REMOTE = process.env.UPSTASH_REDIS_REST_URL, RTOKEN = process.env.UPSTASH_REDIS_REST_TOKEN, RKEY = 'friendscity';
let db = { users: {}, plots: {} };
async function rcmd(cmd) {
  const r = await fetch(REMOTE, { method: 'POST', headers: { Authorization: 'Bearer ' + RTOKEN }, body: JSON.stringify(cmd) });
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  return j.result;
}
async function write() {
  try {
    if (REMOTE) await rcmd(['SET', RKEY, JSON.stringify(db)]);
    else { const tmp = DATA + '.tmp'; await fs.promises.writeFile(tmp, JSON.stringify(db)); await fs.promises.rename(tmp, DATA); }
  } catch (e) { console.error('save failed:', e.message); }
}
let timer = null;
function save() { clearTimeout(timer); timer = setTimeout(write, 400); }
process.on('SIGTERM', async () => { clearTimeout(timer); await write(); process.exit(0); });

const ADMINS = (process.env.ADMINS || '').toLowerCase().split(',').map(x => x.trim()).filter(Boolean);
async function load() {
  let raw = REMOTE ? await rcmd(['GET', RKEY]) : null, fromFile = false;
  if (!raw) { try { raw = fs.readFileSync(DATA, 'utf8'); fromFile = true; } catch (e) { raw = null; } }
  if (raw) db = JSON.parse(raw);
  db.users = db.users || {}; db.plots = db.plots || {};
  const ks = Object.keys(db.users);
  if (ks.length && !ks.some(k => db.users[k].admin)) db.users[ks[0]].admin = true;
  if (REMOTE && fromFile) await write();
  console.log('Data loaded from ' + (REMOTE && !fromFile ? 'Upstash' : 'file') + ': ' + ks.length + ' users');
}

const TYPES = new Set(['classic', 'cabin', 'lodge', 'modern', 'villa', 'uzbek', 'shalash']), ADMIN_TYPES = new Set(['bunker', 'redbunker']);
const PLOT_IDS = new Set();
for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
  if ((i === 0 && j === 0) || (i === 1 && j === 0)) continue;
  for (let k = 0; k < 4; k++) PLOT_IDS.add(i + ',' + j + ',' + k);
}
const hashPw = (pw, salt) => crypto.scryptSync(pw, salt, 32);
const NAME_RE = /^[\p{L}\p{N}_ -]{2,16}$/u;
const players = new Map();

function enter(socket, key) {
  const u = db.users[key];
  if ([...players.values()].some(p => p.key === key)) return socket.emit('autherr', 'Этот аккаунт уже в игре');
  if (ADMINS.includes(key)) u.admin = true;
  if (!u.token) u.token = crypto.randomBytes(24).toString('hex');
  save();
  const p = { id: socket.id, key, name: u.name, x: u.x ?? 0, z: u.z ?? 12, ry: 0, m: 0, hue: u.hue };
  players.set(socket.id, p);
  socket.data.key = key;
  socket.emit('init', { id: socket.id, token: u.token, players: [...players.values()], plots: db.plots, admin: !!u.admin });
  socket.broadcast.emit('joined', p);
  io.emit('count', players.size);
}

io.on('connection', socket => {
  socket.on('register', ({ name, pass } = {}) => {
    if (socket.data.key) return;
    name = String(name || '').trim(); pass = String(pass || '');
    if (!NAME_RE.test(name)) return socket.emit('autherr', 'Имя: 2–16 символов, буквы, цифры, пробел, _ или -');
    if (pass.length < 4) return socket.emit('autherr', 'Пароль должен быть не короче 4 символов');
    const key = name.toLowerCase();
    if (db.users[key]) return socket.emit('autherr', 'Такое имя уже занято');
    const salt = crypto.randomBytes(16).toString('hex');
    db.users[key] = { name, salt, hash: hashPw(pass, salt).toString('hex'), hue: Math.floor(Math.random() * 360), x: 0, z: 12, admin: Object.keys(db.users).length === 0 };
    enter(socket, key);
  });
  socket.on('login', ({ name, pass } = {}) => {
    if (socket.data.key) return;
    const key = String(name || '').trim().toLowerCase(), u = db.users[key];
    if (!u) return socket.emit('autherr', 'Аккаунт не найден. Нажмите «Создать аккаунт»');
    const ok = crypto.timingSafeEqual(hashPw(String(pass || ''), u.salt), Buffer.from(u.hash, 'hex'));
    if (!ok) return socket.emit('autherr', 'Неверный пароль');
    enter(socket, key);
  });
  socket.on('move', d => {
    const p = players.get(socket.id);
    if (!p || !d) return;
    p.x = +d.x || 0; p.z = +d.z || 0; p.ry = +d.ry || 0; p.m = d.m ? 1 : 0; p.y = Math.max(0, Math.min(5, +d.y || 0));
    const u = db.users[p.key]; u.x = p.x; u.z = p.z;
    socket.volatile.broadcast.emit('moved', { id: p.id, x: p.x, z: p.z, ry: p.ry, m: p.m, y: p.y });
  });
  socket.on('chat', t => {
    const p = players.get(socket.id);
    const text = String(t || '').trim().slice(0, 200);
    if (p && text) io.emit('chat', { name: p.name, text });
  });
  socket.on('claim', id => {
    const p = players.get(socket.id);
    if (!p || !PLOT_IDS.has(id)) return;
    if (db.plots[id]) return socket.emit('notice', 'Этот участок уже занят');
    if (Object.values(db.plots).some(pl => pl.owner === p.name)) return socket.emit('notice', 'У вас уже есть участок');
    const last = db.users[p.key].lastStyle;
    db.plots[id] = last ? { owner: p.name, ...last } : { owner: p.name, wall: Math.floor(Math.random() * 8), roof: Math.floor(Math.random() * 5), floors: 1 };
    save();
    io.emit('plot', { id, data: db.plots[id] });
    io.emit('chat', { name: 'Город', text: p.name + ' занял участок' });
  });
  socket.on('style', d => {
    const p = players.get(socket.id);
    if (!p || !d || !db.plots[d.id] || db.plots[d.id].owner !== p.name) return;
    const pl = db.plots[d.id], wall = Math.floor(+d.wall), roof = Math.floor(+d.roof), floors = Math.floor(+d.floors);
    if (wall >= 0 && wall < 8) pl.wall = wall;
    if (TYPES.has(d.type) || (ADMIN_TYPES.has(d.type) && db.users[p.key].admin)) pl.type = d.type;
    if (roof >= 0 && roof < 5) pl.roof = roof;
    if (floors === 1 || floors === 2) pl.floors = floors;
    save();
    io.emit('plot', { id: d.id, data: pl });
  });
  socket.on('release', id => {
    const p = players.get(socket.id), pl = db.plots[id];
    if (!p || !pl || pl.owner !== p.name) return;
    db.users[p.key].lastStyle = { type: pl.type, wall: pl.wall, roof: pl.roof, floors: pl.floors };
    delete db.plots[id]; save();
    io.emit('plot', { id, data: null });
    io.emit('chat', { name: 'Город', text: p.name + ' освободил участок' });
  });
  socket.on('disconnect', () => {
    if (players.delete(socket.id)) { io.emit('left', socket.id); io.emit('count', players.size); save(); }
  });
});

const PORT = process.env.PORT || 3000;
load().then(() => server.listen(PORT, '0.0.0.0', () => console.log('FRIENDS CITY: http://localhost:' + PORT)))
  .catch(e => { console.error('Не удалось загрузить данные:', e.message); process.exit(1); });
