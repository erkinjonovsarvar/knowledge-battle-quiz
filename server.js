// Bilimlar bellashuvi — jonli test o'yini (Kahoot uslubida), qo'shimcha kutubxonasiz.
// Ishga tushirish: node server.js  (yoki "O'YINNI BOSHLASH.bat")
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const zlib = require('zlib');
const crypto = require('crypto');
const { spawn } = require('child_process');

const PORT = Number(process.env.PORT || 3777);
const ROOT = __dirname;
const BANK_DIR = path.join(ROOT, 'testlar');
const RESULT_DIR = path.join(ROOT, 'natijalar');
const SETTINGS_FILE = path.join(ROOT, 'sozlamalar.json');
const NO_TUNNEL = process.argv.includes('--no-tunnel');

for (const d of [BANK_DIR, RESULT_DIR]) fs.mkdirSync(d, { recursive: true });

// ---------- sozlamalar (admin paroli) ----------
let config = {};
try { config = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')); } catch {}
if (!config.adminParol) {
  config.adminParol = String(crypto.randomInt(100000, 999999));
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(config, null, 2));
}

// ---------- test bazalari ----------
function listBanks() {
  return fs.readdirSync(BANK_DIR).filter(f => f.endsWith('.json')).map(f => {
    try {
      const b = JSON.parse(fs.readFileSync(path.join(BANK_DIR, f), 'utf8'));
      const counts = b.topics.map((_, i) => b.questions.filter(q => q.t === i).length);
      const noTopic = b.questions.filter(q => q.t == null).length;
      return { id: f.replace(/\.json$/, ''), title: b.title, topics: b.topics, counts, noTopic, total: b.questions.length };
    } catch { return null; }
  }).filter(Boolean);
}
function loadBank(id) {
  if (!/^[\w.-]+$/.test(id)) throw new Error('Noto‘g‘ri test nomi');
  return JSON.parse(fs.readFileSync(path.join(BANK_DIR, id + '.json'), 'utf8'));
}

// .docx ichidan word/document.xml ni o'qish (zip ni o'zimiz ochamiz)
function docxText(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Fayl .docx emas');
  const entries = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let e = 0; e < entries; e++) {
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nlen);
    if (name === 'word/document.xml') {
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const data = buf.subarray(start, start + csize);
      const xml = (method === 8 ? zlib.inflateRawSync(data) : data).toString('utf8');
      const ent = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
      return (xml.match(/<w:p[ >][\s\S]*?<\/w:p>/g) || [])
        .map(par => ent((par.match(/<w:t[^>]*>[\s\S]*?<\/w:t>/g) || []).map(t => t.replace(/<[^>]+>/g, '')).join('')))
        .join('\n');
    }
    p += 46 + nlen + xlen + clen;
  }
  throw new Error('.docx ichida matn topilmadi');
}

// Format: savol ==== #to'g'ri ==== variant ==== variant ++++ ; "N-mavzu: ..." sarlavhalari ixtiyoriy
function parseTest(text) {
  const lines = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  const topics = [], questions = [], problems = [];
  let topic = null, cur = null;
  const finish = () => {
    if (!cur) return;
    if (cur.a == null || cur.o.length < 2) problems.push(cur.q.slice(0, 80));
    else questions.push(cur);
    cur = null;
  };
  for (let t of lines) {
    const m = t.match(/^\d+\s*-\s*mavzu\s*[:.]?\s*(.*)$/i);
    if (m && !cur) { topics.push(m[1] || t); topic = topics.length - 1; continue; }
    if (/^=+$/.test(t)) continue;
    if (/^\++$/.test(t)) { finish(); continue; }
    if (!cur) {
      const qm = t.match(/^(\d+)\s*[.)]\s*(.*)$/);
      cur = { n: qm ? Number(qm[1]) : questions.length + 1, t: topic, q: qm ? qm[2] : t, o: [], a: null };
    } else {
      if (t.startsWith('#')) { cur.a = cur.o.length; t = t.slice(1).trim(); }
      cur.o.push(t);
    }
  }
  finish();
  return { topics, questions, problems };
}

// ---------- o'yin holati ----------
const AVATARS = ['🦊', '🐼', '🦁', '🐯', '🐸', '🐵', '🦉', '🐧', '🐙', '🦄', '🐝', '🐢', '🐬', '🦋', '🐻', '🐨', '🦒', '🐳', '🦖', '🐞', '🚀', '⚡', '🌟', '🍀', '🎯', '🔥', '💎', '🎸'];
let game = null;          // joriy o'yin
let publicUrl = null;     // internet havolasi (cloudflared)
let publicReady = false;
let timer = null;

function shuffle(a, rnd = Math.random) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
function seeded(str) {
  let h = 2166136261;
  for (const c of str) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; };
}

function createGame(s) {
  const bank = loadBank(s.bankId);
  const topicSet = new Set((s.topics || []).map(Number));
  let pool = bank.questions.filter(q => q.t == null ? s.includeNoTopic !== false : topicSet.has(q.t));
  if (!pool.length) throw new Error('Tanlangan mavzularda savol yo‘q');
  if (s.shuffleQ) shuffle(pool);
  const count = Math.max(1, Math.min(Number(s.count) || pool.length, pool.length));
  pool = pool.slice(0, count);
  const questions = pool.map(q => {
    const order = q.o.map((_, i) => i);
    if (s.shuffleA) shuffle(order);
    return { n: q.n, topic: q.t == null ? '' : bank.topics[q.t], q: q.q, options: order.map(i => q.o[i]), correct: order.indexOf(q.a) };
  });
  clearTimeout(timer);
  game = {
    pin: String(crypto.randomInt(100000, 999999)),
    title: bank.title,
    settings: {
      time: Math.max(5, Math.min(Number(s.time) || 20, 300)),
      readTime: Math.max(0, Math.min(Number(s.readTime) || 0, 30)),
      // matn telefonda ko'rinmasa, o'quvchi faqat harf/rangga qarab bosadi — tartib ekrandagidek bo'lishi shart
      perPlayer: !!s.perPlayer && s.showOnPhone !== false, showOnPhone: s.showOnPhone !== false,
      boardEvery: s.boardEvery !== false, autoNext: !!s.autoNext,
      teams: [3, 4, 5].includes(Number(s.teams)) ? Number(s.teams) : 0,
      teamChoose: !!s.teamChoose,
    },
    questions, idx: -1, phase: 'lobby',
    qStart: 0, deadline: 0, paused: false, remaining: 0, phaseEnds: 0,
    players: new Map(), startedAt: null, savedFile: null,
  };
}

const activePlayers = () => [...game.players.values()].filter(p => !p.kicked);
function ranking() {
  return activePlayers().sort((a, b) => b.score - a.score || a.correctTime - b.correctTime || a.joined - b.joined);
}
// ---------- jamoalar ----------
// Har o'quvchi o'zi javob beradi; jamoa bali = a'zolar ballarining o'rtachasi
// (jamoalarda odam soni har xil bo'lsa ham adolatli).
const TEAMS = [
  { name: 'Burgutlar', emoji: '🦅', color: '#e5484d' },
  { name: 'Delfinlar', emoji: '🐬', color: '#3e63dd' },
  { name: 'Sherlar', emoji: '🦁', color: '#e09b0e' },
  { name: 'Bo‘rilar', emoji: '🐺', color: '#2f9e63' },
  { name: 'Yulduzlar', emoji: '⭐', color: '#8e4ec6' },
];
function smallestTeam() {
  const counts = Array(game.settings.teams).fill(0);
  for (const p of activePlayers()) counts[p.team]++;
  return counts.indexOf(Math.min(...counts));
}
function teamRanking() {
  const n = game.settings.teams;
  if (!n) return [];
  const done = Math.max(0, game.phase === 'question' || game.phase === 'get_ready' ? game.idx : game.idx + 1);
  const rows = TEAMS.slice(0, n).map((t, i) => {
    const m = activePlayers().filter(p => p.team === i);
    const sum = m.reduce((s, p) => s + p.score, 0), correct = m.reduce((s, p) => s + p.correct, 0);
    return {
      i, ...t, members: m.length, total: sum, score: m.length ? Math.round(sum / m.length) : 0,
      pct: m.length && done ? Math.round(100 * correct / (m.length * done)) : 0,
      last: m.length ? Math.round(m.reduce((s, p) => s + ((p.answers[game.idx] || {}).points || 0), 0) / m.length) : 0,
    };
  });
  return rows.sort((a, b) => b.score - a.score || b.members - a.members)
    .map((r, k) => ({ ...r, rank: k + 1, prevRank: game.teamPrev ? game.teamPrev[r.i] : null }));
}
function balanceTeams() {
  const list = shuffle(activePlayers());
  list.forEach((p, k) => { p.team = k % game.settings.teams; });
}

function playerOrder(p, idx) {
  const n = game.questions[idx].options.length;
  const order = [...Array(n).keys()];
  return game.settings.perPlayer ? shuffle(order, seeded(p.token + ':' + idx)) : order;
}

function schedule(ms, fn) { clearTimeout(timer); timer = setTimeout(fn, ms); }

function goQuestion(idx) {
  game.idx = idx;
  game.paused = false;
  for (const p of game.players.values()) p.prevRank = p.rank;
  if (game.settings.teams && idx > 0) {
    game.teamPrev = {};
    for (const t of teamRanking()) game.teamPrev[t.i] = t.rank;
  }
  if (game.settings.readTime > 0) {
    game.phase = 'get_ready';
    game.phaseEnds = Date.now() + game.settings.readTime * 1000;
    schedule(game.settings.readTime * 1000, openAnswers);
  } else openAnswers();
  broadcast();
}
function openAnswers() {
  game.phase = 'question';
  game.qStart = Date.now();
  game.deadline = game.qStart + game.settings.time * 1000;
  schedule(game.settings.time * 1000 + 250, reveal);
  broadcast();
}
function reveal() {
  if (game.phase !== 'question') return;
  clearTimeout(timer);
  game.phase = 'reveal';
  game.paused = false;
  const q = game.questions[game.idx];
  for (const p of activePlayers()) {
    const a = p.answers[game.idx];
    if (a && a.choice === q.correct) {
      p.streak += 1;
      a.bonus = Math.min(100 * (p.streak - 1), 500);
      a.points = a.base + a.bonus;
      p.score += a.points;
      p.correct += 1;
      p.correctTime += a.time;
    } else {
      p.streak = 0;
      if (a) a.points = 0;
    }
  }
  ranking().forEach((p, i) => { p.rank = i + 1; });
  if (game.settings.autoNext) schedule(6000, next);
  broadcast();
}
function next() {
  clearTimeout(timer);
  const last = game.idx >= game.questions.length - 1;
  if (game.phase === 'lobby') { game.startedAt = new Date(); return goQuestion(0); }
  if (game.phase === 'reveal' && (game.settings.boardEvery || last)) {
    game.phase = last ? 'final' : 'leaderboard';
    if (last) saveResults();
    else if (game.settings.autoNext) schedule(6000, next);
    return broadcast();
  }
  if (game.phase === 'reveal' || game.phase === 'leaderboard') {
    if (last) { game.phase = 'final'; saveResults(); return broadcast(); }
    return goQuestion(game.idx + 1);
  }
  if (game.phase === 'get_ready') return openAnswers();
  if (game.phase === 'question') return reveal();
}
function endGame() {
  clearTimeout(timer);
  if (game.phase === 'question') reveal();
  if (game.phase === 'get_ready') game.idx -= 1;   // ochilmagan savol hisobga kirmaydi
  clearTimeout(timer);
  game.phase = 'final';
  saveResults();
  broadcast();
}
function maybeAllAnswered() {
  const act = activePlayers().filter(isOnline);
  if (act.length && act.every(p => p.answers[game.idx])) schedule(600, reveal);
}

// ---------- natijalar ----------
function playedCount() { return game.phase === 'final' ? Math.max(0, game.idx + 1) : game.idx; }
function questionStats() {
  const done = game.phase === 'reveal' || game.phase === 'leaderboard' ? game.idx + 1 : playedCount();
  const act = activePlayers();
  return game.questions.slice(0, done).map((q, i) => {
    const answered = act.filter(p => p.answers[i]);
    const right = answered.filter(p => p.answers[i].choice === q.correct).length;
    return { i, n: q.n, q: q.q, correctText: q.options[q.correct], right, total: act.length, pct: act.length ? Math.round(100 * right / act.length) : 0 };
  });
}
function csvResults() {
  const done = playedCount();
  const qs = game.questions.slice(0, done);
  const cell = v => '"' + String(v).replace(/"/g, '""') + '"';
  const T = game.settings.teams;
  const head = ['O‘rin', 'Ism', ...(T ? ['Jamoa'] : []), 'Ball', 'To‘g‘ri', 'Xato', 'Javobsiz', 'Foiz', ...qs.map((q, i) => `${i + 1}-savol (№${q.n})`)];
  const rows = ranking().map((p, r) => {
    let wrong = 0, none = 0;
    const marks = qs.map((q, i) => {
      const a = p.answers[i];
      if (!a) { none++; return '—'; }
      if (a.choice === q.correct) return '+';
      wrong++; return '-';
    });
    return [r + 1, p.name, ...(T ? [TEAMS[p.team].name] : []), p.score, p.correct, wrong, none, done ? Math.round(100 * p.correct / done) + '%' : '0%', ...marks];
  });
  const teamRows = T ? [[], ['Jamoalar'], ['O‘rin', 'Jamoa', 'A’zolar', 'O‘rtacha ball', 'Jami ball', 'To‘g‘ri javoblar %'],
    ...teamRanking().map(t => [t.rank, t.name, t.members, t.score, t.total, t.pct + '%'])] : [];
  return '﻿' + [head, ...rows, ...teamRows].map(r => r.map(cell).join(';')).join('\r\n');
}
function saveResults() {
  try {
    const d = game.startedAt || new Date();
    const pad = n => String(n).padStart(2, '0');
    const name = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}_${game.pin}.csv`;
    fs.writeFileSync(path.join(RESULT_DIR, name), csvResults());
    game.savedFile = name;
  } catch (e) { console.error('Natijani saqlab bo‘lmadi:', e.message); }
}

// ---------- ko'rinishlar ----------
function hostView() {
  const base = { role: 'host', serverNow: Date.now(), publicUrl, publicReady, localUrls: localUrls() };
  if (!game) return { ...base, phase: 'setup' };
  const q = game.questions[game.idx];
  const act = activePlayers();
  const v = {
    ...base, phase: game.phase, pin: game.pin, title: game.title, settings: game.settings,
    idx: game.idx, total: game.questions.length, paused: game.paused, remaining: game.remaining,
    deadline: game.deadline, phaseEnds: game.phaseEnds,
    teamDefs: TEAMS.slice(0, game.settings.teams),
    players: act.map(p => ({ token: p.token.slice(0, 8), name: p.name, avatar: p.avatar, team: p.team, score: p.score, online: isOnline(p), answered: !!(q && p.answers[game.idx]) })),
    answeredCount: q ? act.filter(p => p.answers[game.idx]).length : 0,
    savedFile: game.savedFile,
  };
  if (q && game.phase !== 'lobby') {
    v.question = { n: q.n, topic: q.topic, q: q.q, options: game.phase === 'get_ready' ? [] : q.options };
    if (['reveal', 'leaderboard', 'final'].includes(game.phase)) {
      v.question.correct = q.correct;
      v.dist = q.options.map((_, i) => act.filter(p => p.answers[game.idx] && p.answers[game.idx].choice === i).length);
    }
  }
  if (['reveal', 'leaderboard', 'final'].includes(game.phase)) {
    v.teamBoard = teamRanking();
    v.board = ranking().map(p => ({ name: p.name, avatar: p.avatar, team: p.team, score: p.score, rank: p.rank, prevRank: p.prevRank, streak: p.streak, correct: p.correct, last: p.answers[game.idx] ? p.answers[game.idx].points || 0 : 0 }));
  }
  if (game.phase === 'final') v.stats = questionStats();
  return v;
}
function playerView(token) {
  const base = { role: 'player', serverNow: Date.now() };
  const p = game && game.players.get(token);
  if (!p) return {
    ...base, phase: 'nojoin', open: !!game && game.phase !== 'final',
    teams: game && game.settings.teams && game.settings.teamChoose ? TEAMS.slice(0, game.settings.teams).map((t, i) => ({ ...t, i, members: activePlayers().filter(x => x.team === i).length })) : null,
  };
  if (p.kicked) return { ...base, phase: 'kicked' };
  const q = game.questions[game.idx];
  const rank = ranking();
  const myPos = rank.indexOf(p);
  const v = {
    ...base, phase: game.phase, title: game.title, name: p.name, avatar: p.avatar, score: p.score, streak: p.streak,
    rank: p.rank || null, players: rank.length, idx: game.idx, total: game.questions.length,
    deadline: game.deadline, phaseEnds: game.phaseEnds, paused: game.paused, remaining: game.remaining,
    showOnPhone: game.settings.showOnPhone,
    timeTotal: game.settings.time * 1000, readTotal: game.settings.readTime * 1000,
  };
  if (game.settings.teams) {
    v.team = TEAMS[p.team];
    if (['reveal', 'leaderboard', 'final'].includes(game.phase)) v.teamBoard = teamRanking().map(t => ({ name: t.name, emoji: t.emoji, color: t.color, score: t.score, rank: t.rank, mine: t.i === p.team }));
  }
  if (q && !['lobby', 'final'].includes(game.phase)) {
    const order = playerOrder(p, game.idx);
    const a = p.answers[game.idx];
    v.question = {
      n: q.n, topic: q.topic, q: game.settings.showOnPhone ? q.q : '',
      options: game.phase === 'get_ready' ? [] : order.map(i => ({ i, text: game.settings.showOnPhone ? q.options[i] : '' })),
    };
    v.myChoice = a ? a.choice : null;
    if (['reveal', 'leaderboard'].includes(game.phase)) {
      v.result = { correct: !!a && a.choice === q.correct, answered: !!a, points: a ? a.points || 0 : 0, bonus: a ? a.bonus || 0 : 0, correctText: q.options[q.correct], correctIdx: q.correct, myText: a ? q.options[a.choice] : null };
      if (myPos > 0) { const ahead = rank[myPos - 1]; v.ahead = { name: ahead.name, gap: ahead.score - p.score }; }
    }
  }
  if (game.phase === 'final') {
    const done = playedCount();
    v.correctCount = p.correct;
    v.done = done;
    v.podium = rank.slice(0, 3).map(x => ({ name: x.name, avatar: x.avatar, score: x.score }));
    v.mistakes = game.questions.slice(0, done).map((q, i) => ({ q, a: p.answers[i] }))
      .filter(x => !x.a || x.a.choice !== x.q.correct)
      .map(x => ({ n: x.q.n, topic: x.q.topic, q: x.q.q, options: x.q.options, correct: x.q.correct, mine: x.a ? x.a.choice : null }));
  }
  return v;
}

// ---------- jonli ulanish: long-polling ----------
// SSE oqimini Cloudflare tunneli ushlab qoladi, shuning uchun har bir javob to'liq yopiladi:
// mijoz versiyani yuboradi, o'zgarish bo'lguncha (yoki 25 soniya) javob kutib turadi.
let version = 1;
const waiters = new Set();
function respondView(w) {
  clearTimeout(w.timeout);
  waiters.delete(w);
  const view = w.role === 'host' ? hostView() : playerView(w.token);
  try { json(w.res, 200, { v: version, view }); } catch {}
}
let bTimer = null;
function broadcast() {
  // bir vaqtda kelgan ko'p o'zgarishlarni bitta yuborishga jamlaymiz
  if (bTimer) return;
  bTimer = setTimeout(() => { bTimer = null; version++; for (const w of [...waiters]) respondView(w); }, 40);
}
function touch(token) {
  const p = game && game.players.get(token);
  if (!p) return;
  const wasOnline = isOnline(p);
  p.lastSeen = Date.now();
  if (!wasOnline) broadcast();
}
const isOnline = p => Date.now() - (p.lastSeen || 0) < 35000;
// telefoni uzilganlarni ekranda xira ko'rsatish uchun
setInterval(() => { if (game && [...game.players.values()].some(p => p.wasOnline !== isOnline(p) && ((p.wasOnline = isOnline(p)), true))) broadcast(); }, 5000);

// ---------- HTTP ----------
function localUrls() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) for (const a of list || []) {
    if (a.family === 'IPv4' && !a.internal) out.push(`http://${a.address}:${PORT}`);
  }
  return out;
}
function isLocal(req) {
  const ip = req.socket.remoteAddress || '';
  return !req.headers['cf-connecting-ip'] && (ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1');
}
function isAdmin(req, url) {
  if (isLocal(req)) return true;
  const key = req.headers['x-admin-key'] || url.searchParams.get('key');
  return !!key && key === config.adminParol;
}
function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}
function readBody(req, limit = 20 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', c => { size += c.length; if (size > limit) { reject(new Error('Fayl juda katta')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
async function readJson(req) { const b = await readBody(req, 100000); return b.length ? JSON.parse(b.toString('utf8')) : {}; }

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
function serveFile(res, file) {
  fs.readFile(path.join(ROOT, 'public', file), (err, data) => {
    if (err) { res.writeHead(404); return res.end('Topilmadi'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}

const adminActions = {
  create: s => createGame(s),
  start: () => { if (game.phase === 'lobby') next(); },
  next: () => next(),
  pause: () => {
    if (game.phase !== 'question' || game.paused) return;
    clearTimeout(timer); game.paused = true; game.remaining = Math.max(0, game.deadline - Date.now()); game.pausedAt = Date.now();
  },
  resume: () => {
    if (!game.paused) return;
    game.paused = false; game.qStart += Date.now() - game.pausedAt;
    game.deadline = Date.now() + game.remaining; schedule(game.remaining + 250, reveal);
  },
  addTime: () => {
    if (game.phase !== 'question') return;
    if (game.paused) game.remaining += 10000;
    else { game.deadline += 10000; schedule(game.deadline - Date.now() + 250, reveal); }
  },
  moveTeam: b => {
    if (!game.settings.teams) return;
    for (const p of game.players.values()) if (p.token.startsWith(b.token)) p.team = (Number(b.team) % game.settings.teams + game.settings.teams) % game.settings.teams;
  },
  balanceTeams: () => { if (game.settings.teams) balanceTeams(); },
  kick: b => { for (const p of game.players.values()) if (p.token.startsWith(b.token)) p.kicked = true; },
  end: () => endGame(),
  reset: () => { clearTimeout(timer); game = null; },
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  try {
    if (req.method === 'GET' && (p === '/' || p === '/index.html')) return serveFile(res, 'player.html');
    if (req.method === 'GET' && (p === '/host' || p === '/admin')) return serveFile(res, 'host.html');
    if (req.method === 'GET' && /^\/[\w.-]+\.(js|css|svg|png|ico)$/.test(p)) return serveFile(res, p.slice(1));
    if (p === '/api/ping') return json(res, 200, { ok: true });

    if (p === '/api/poll') {
      const role = url.searchParams.get('role') === 'host' ? 'host' : 'player';
      if (role === 'host' && !isAdmin(req, url)) return json(res, 401, { error: 'Admin paroli kerak' });
      const w = { res, role, token: url.searchParams.get('token') || '' };
      if (role === 'player') touch(w.token);
      if (Number(url.searchParams.get('v')) !== version) return respondView(w);
      waiters.add(w);
      w.timeout = setTimeout(() => respondView(w), 25000);
      res.on('close', () => { clearTimeout(w.timeout); waiters.delete(w); });
      return;
    }

    if (req.method === 'POST' && p === '/api/join') {
      const b = await readJson(req);
      if (!game || game.phase === 'final') return json(res, 400, { error: 'Hozir faol o‘yin yo‘q. O‘qituvchi o‘yinni boshlashini kuting.' });
      if (String(b.pin || '').trim() !== game.pin) return json(res, 400, { error: 'PIN kod noto‘g‘ri' });
      const old = b.token && game.players.get(b.token);
      if (old && !old.kicked) return json(res, 200, { token: old.token });
      let name = String(b.name || '').replace(/\s+/g, ' ').trim().slice(0, 24);
      if (name.length < 2) return json(res, 400, { error: 'Ismingizni yozing (kamida 2 harf)' });
      if (game.players.size >= 300) return json(res, 400, { error: 'O‘yinchilar soni to‘ldi' });
      const taken = new Set(activePlayers().map(x => x.name.toLowerCase()));
      if (taken.has(name.toLowerCase())) return json(res, 400, { error: 'Bu ism band. Familiyangizni ham qo‘shing.' });
      const token = crypto.randomBytes(12).toString('hex');
      const avatar = AVATARS.includes(b.avatar) ? b.avatar : AVATARS[crypto.randomInt(AVATARS.length)];
      const team = !game.settings.teams ? null
        : game.settings.teamChoose && Number(b.team) >= 0 && Number(b.team) < game.settings.teams ? Number(b.team) : smallestTeam();
      game.players.set(token, { token, name, avatar, team, score: 0, streak: 0, correct: 0, correctTime: 0, answers: {}, lastSeen: Date.now(), kicked: false, joined: Date.now(), rank: null, prevRank: null });
      broadcast();
      return json(res, 200, { token });
    }

    if (req.method === 'POST' && p === '/api/answer') {
      const b = await readJson(req);
      const pl = game && game.players.get(b.token);
      if (!pl || pl.kicked) return json(res, 400, { error: 'O‘yinda emassiz' });
      if (game.paused) return json(res, 400, { error: 'Pauza — o‘qituvchi davom ettirishini kuting' });
      if (game.phase !== 'question' || Number(b.idx) !== game.idx) return json(res, 400, { error: 'Vaqt tugadi' });
      if (pl.answers[game.idx]) return json(res, 200, { ok: true });
      const now = Date.now();
      if (now > game.deadline + 300) return json(res, 400, { error: 'Vaqt tugadi' });
      const choice = Number(b.choice);
      if (!(choice >= 0 && choice < game.questions[game.idx].options.length)) return json(res, 400, { error: 'Noto‘g‘ri javob' });
      const t = Math.max(0, now - game.qStart), T = game.settings.time * 1000;
      pl.answers[game.idx] = { choice, time: t, base: Math.round(1000 * (1 - 0.5 * Math.min(1, t / T))) };
      broadcast();
      maybeAllAnswered();
      return json(res, 200, { ok: true });
    }

    // ---- admin ----
    if (p.startsWith('/api/admin/')) {
      if (!isAdmin(req, url)) return json(res, 401, { error: 'Admin paroli noto‘g‘ri' });
      const action = p.slice('/api/admin/'.length);
      if (req.method === 'GET' && action === 'banks') return json(res, 200, { banks: listBanks() });
      if (req.method === 'GET' && action === 'results.csv') {
        if (!game) return json(res, 400, { error: 'O‘yin yo‘q' });
        res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="natija_${game.pin}.csv"` });
        return res.end(csvResults());
      }
      if (req.method === 'POST' && action === 'upload') {
        const buf = await readBody(req);
        const fname = decodeURIComponent(req.headers['x-file-name'] || 'test.txt');
        const title = decodeURIComponent(req.headers['x-title'] || '').trim() || fname.replace(/\.[^.]+$/, '');
        const text = /\.docx$/i.test(fname) ? docxText(buf) : buf.toString('utf8');
        const parsed = parseTest(text);
        if (!parsed.questions.length) return json(res, 400, { error: 'Savol topilmadi. Format: savol, ====, #to‘g‘ri javob, ====, variantlar, ++++', problems: parsed.problems });
        const id = (title.toLowerCase().replace(/[^a-z0-9а-яё]+/gi, '-').replace(/^-|-$/g, '') || 'test').slice(0, 40) + '-' + Date.now().toString(36);
        const safeId = id.replace(/[^\w.-]/g, '');
        fs.writeFileSync(path.join(BANK_DIR, safeId + '.json'), JSON.stringify({ title, source: fname, topics: parsed.topics, questions: parsed.questions }));
        return json(res, 200, { id: safeId, count: parsed.questions.length, topics: parsed.topics.length, problems: parsed.problems });
      }
      if (req.method === 'POST' && adminActions[action]) {
        const b = await readJson(req);
        if (action !== 'create' && !game) return json(res, 400, { error: 'O‘yin yo‘q' });
        adminActions[action](b);
        broadcast();
        return json(res, 200, { ok: true });
      }
    }
    res.writeHead(404); res.end('Topilmadi');
  } catch (e) {
    json(res, 400, { error: e.message || String(e) });
  }
});

// ---------- internet havolasi (cloudflared) ----------
function startTunnel() {
  const candidates = [
    path.join(process.env['ProgramFiles(x86)'] || '', 'cloudflared', 'cloudflared.exe'),
    path.join(process.env.ProgramFiles || '', 'cloudflared', 'cloudflared.exe'),
    path.join(ROOT, 'cloudflared.exe'),
  ];
  const src = candidates.find(f => fs.existsSync(f));
  if (!src) { console.log('  cloudflared topilmadi — faqat bitta Wi-Fi tarmog‘idagi havola ishlaydi.'); return; }
  // KP platformasining skriptlari "cloudflared" jarayonini qidiradi/to'xtatadi — o'yin tunneli
  // ularga aralashmasligi uchun nusxasi boshqa nom bilan ishga tushiriladi.
  const exe = path.join(ROOT, 'oyin-tunnel.exe');
  try { if (!fs.existsSync(exe) || fs.statSync(exe).size !== fs.statSync(src).size) fs.copyFileSync(src, exe); } catch { }
  if (!fs.existsSync(exe)) { console.log('  Tunnel faylini nusxalab bo‘lmadi.'); return; }
  // oyna yopilganda qolib ketgan eski tunnelni tozalash
  try { require('child_process').execSync('taskkill /IM oyin-tunnel.exe /F', { stdio: 'ignore' }); } catch { }
  const cf = spawn(exe, ['tunnel', '--no-autoupdate', '--url', `http://localhost:${PORT}`], { windowsHide: true });
  const onData = d => {
    const m = String(d).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (m && !publicUrl) {
      publicUrl = m[0];
      console.log(`\n  Internet havolasi: ${publicUrl}  (30-60 soniyada ishga tushadi)`);
      broadcast();
      waitPublic();
    }
  };
  cf.stdout.on('data', onData);
  cf.stderr.on('data', onData);
  cf.on('exit', () => { console.log('  cloudflared to‘xtadi.'); publicUrl = null; publicReady = false; broadcast(); });
  const stop = () => { try { cf.kill(); } catch {} process.exit(0); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}
async function waitPublic() {
  for (let i = 0; i < 90 && publicUrl; i++) {
    try {
      const r = await fetch(publicUrl + '/api/ping', { signal: AbortSignal.timeout(5000) });
      if (r.ok) { publicReady = true; console.log('  Havola tayyor — o‘quvchilar kira oladi.'); broadcast(); return; }
    } catch {}
    await new Promise(r => setTimeout(r, 3000));
  }
  publicReady = true; broadcast();   // tekshira olmadik — baribir ko'rsatamiz
}

server.listen(PORT, () => {
  console.log('\n  ===== BILIMLAR BELLASHUVI =====');
  console.log(`  O‘qituvchi (admin) ekrani: http://localhost:${PORT}/host`);
  console.log(`  Boshqa qurilmadan admin bo‘lish paroli: ${config.adminParol}`);
  for (const u of localUrls()) console.log(`  Wi-Fi orqali o‘quvchilar: ${u}`);
  if (!NO_TUNNEL) startTunnel();
});
