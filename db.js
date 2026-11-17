'use strict';
/* 数据层：账号、段位(ELO)、战绩、对局历史、排行榜
 * 使用 Node 22 内置的 node:sqlite（零原生依赖、零编译）。
 * 数据库文件路径由环境变量 DB_PATH 指定；默认项目根目录 data/xq.db。
 */
const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'xq.db');

// 确保目录存在
const dir = path.dirname(DB_PATH);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

const db = new DatabaseSync(DB_PATH);

// 打开 WAL 模式，提升并发读写稳定性
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL UNIQUE,
  nickname      TEXT NOT NULL DEFAULT '棋友',
  rating        INTEGER NOT NULL DEFAULT 1200,   -- ELO 分
  peak_rating   INTEGER NOT NULL DEFAULT 1200,   -- 历史最高分
  wins          INTEGER NOT NULL DEFAULT 0,
  losses        INTEGER NOT NULL DEFAULT 0,
  draws         INTEGER NOT NULL DEFAULT 0,
  streak        INTEGER NOT NULL DEFAULT 0,      -- 当前连胜(负为连败)
  best_streak   INTEGER NOT NULL DEFAULT 0,
  avatar        TEXT NOT NULL DEFAULT 'default', -- 头像标识（后续按段位解锁）
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_users_rating ON users(rating DESC);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

CREATE TABLE IF NOT EXISTS games (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  mode          TEXT NOT NULL,                   -- ai | online
  red_email     TEXT,                            -- 红方邮箱（可为空=游客/AI）
  black_email   TEXT,
  red_name      TEXT NOT NULL,
  black_name    TEXT NOT NULL,
  winner        INTEGER NOT NULL,                -- 0=红 1=黑 -1=和
  reason        TEXT,
  moves         TEXT NOT NULL DEFAULT '[]',      -- 棋谱 JSON [[f,t],...]
  notation      TEXT NOT NULL DEFAULT '',        -- 中文记谱（逗号分隔）
  per_move      INTEGER NOT NULL DEFAULT 0,
  ai_level      INTEGER,                         -- 人机模式下的 AI 难度
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_games_email ON games(red_email, black_email);
CREATE INDEX IF NOT EXISTS idx_games_time ON games(created_at DESC);
`);

/* ---------------- 段位映射 ---------------- */
// 依据 ELO 分划分段位，贴近主流象棋平台体感
const RANKS = [
  { min: 0,    name: '青铜', icon: '🥉', color: '#cd7f32' },
  { min: 1000, name: '白银', icon: '🥈', color: '#a8a9ad' },
  { min: 1200, name: '黄金', icon: '🥇', color: '#d4af37' },
  { min: 1400, name: '铂金', icon: '💠', color: '#2bb3b3' },
  { min: 1600, name: '钻石', icon: '💎', color: '#4b6ef5' },
  { min: 1800, name: '大师', icon: '👑', color: '#b0392b' }
];

function rankFor(rating) {
  let cur = RANKS[0];
  for (const r of RANKS) if (rating >= r.min) cur = r;
  return cur;
}

function nextRank(rating) {
  for (const r of RANKS) if (rating < r.min) return r;
  return null;
}

/* ---------------- ELO 计算 ---------------- */
// 标准 Elo：K 因子基础 32；和棋各半。返回 [红方变化, 黑方变化]
function eloDelta(ra, rb, winner) {
  // winner: 0=红胜 1=黑胜 -1=和
  const ea = 1 / (1 + Math.pow(10, (rb - ra) / 400));
  const eb = 1 - ea;
  const K = 32;
  let sa, sb;
  if (winner === -1) { sa = 0.5; sb = 0.5; }
  else if (winner === 0) { sa = 1; sb = 0; }
  else { sa = 0; sb = 1; }
  return [Math.round(K * (sa - ea)), Math.round(K * (sb - eb))];
}

/* ---------------- 用户 ---------------- */
function getUserByEmail(email) {
  const e = String(email || '').toLowerCase().trim();
  if (!e) return null;
  return db.prepare('SELECT * FROM users WHERE email = ?').get(e) || null;
}

function getUserById(id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id) || null;
}

function createUser(email, nickname) {
  const e = String(email).toLowerCase().trim();
  const n = String(nickname || '').trim().slice(0, 12) || '棋友';
  const now = Date.now();
  db.prepare(
    'INSERT INTO users (email, nickname, rating, peak_rating, created_at) VALUES (?, ?, 1200, 1200, ?)'
  ).run(e, n, now);
  return getUserByEmail(e);
}

function updateNickname(email, nickname) {
  const e = String(email).toLowerCase().trim();
  const n = String(nickname || '').trim().slice(0, 12) || '棋友';
  db.prepare('UPDATE users SET nickname = ? WHERE email = ?').run(n, e);
  return getUserByEmail(e);
}

/* 返回一个带段位的公开画像 */
function publicProfile(u) {
  if (!u) return null;
  const rank = rankFor(u.rating);
  const next = nextRank(u.rating);
  const total = u.wins + u.losses + u.draws;
  return {
    id: u.id,
    nickname: u.nickname,
    rating: u.rating,
    peakRating: u.peak_rating,
    rank: rank.name,
    rankIcon: rank.icon,
    rankColor: rank.color,
    nextRank: next ? next.name : null,
    nextRankRating: next ? next.min : null,
    wins: u.wins,
    losses: u.losses,
    draws: u.draws,
    total: total,
    winRate: total ? Math.round(u.wins * 100 / Math.max(1, u.wins + u.losses)) : 0,
    streak: u.streak,
    bestStreak: u.best_streak,
    avatar: u.avatar,
    createdAt: u.created_at
  };
}

/* 记录一局对局，更新双方战绩与 ELO。
 * redEmail / blackEmail 可为 null（游客/AI，不记分）。
 */
function recordGame(opts) {
  const o = opts || {};
  const now = Date.now();
  const movesJson = JSON.stringify(o.moves || []);
  const notation = Array.isArray(o.notation) ? o.notation.join(',') : (o.notation || '');

  const info = db.prepare(
    `INSERT INTO games
       (mode, red_email, black_email, red_name, black_name, winner, reason, moves, notation, per_move, ai_level, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    o.mode || 'ai',
    o.redEmail ? String(o.redEmail).toLowerCase() : null,
    o.blackEmail ? String(o.blackEmail).toLowerCase() : null,
    o.redName || '红方',
    o.blackName || '黑方',
    o.winner === -1 ? -1 : (o.winner === 1 ? 1 : 0),
    o.reason || '',
    movesJson,
    notation,
    o.perMove || 0,
    o.aiLevel || null,
    now
  );

  // 更新两位玩家（仅当有邮箱）
  applyResult(o.redEmail, o.blackEmail, o.winner);

  return info.lastInsertRowid;
}

function applyResult(redEmail, blackEmail, winner) {
  const red = redEmail ? getUserByEmail(redEmail) : null;
  const black = blackEmail ? getUserByEmail(blackEmail) : null;
  if (!red && !black) return;

  // 只有双方都登录才算 ELO（打游客不影响段位分）
  const bothLogged = !!(red && black);
  const ra = red ? red.rating : 1200;
  const rb = black ? black.rating : 1200;
  const delta = eloDelta(ra, rb, winner);

  if (red) applySingle(red, winner === 0 ? 'win' : (winner === -1 ? 'draw' : 'loss'), bothLogged ? delta[0] : 0);
  if (black) applySingle(black, winner === 1 ? 'win' : (winner === -1 ? 'draw' : 'loss'), bothLogged ? delta[1] : 0);
}

function applySingle(u, outcome, delta) {
  let wins = u.wins, losses = u.losses, draws = u.draws, streak = u.streak, best = u.best_streak;
  if (outcome === 'win') {
    wins++; streak = streak > 0 ? streak + 1 : 1;
  } else if (outcome === 'loss') {
    losses++; streak = streak < 0 ? streak - 1 : -1;
  } else {
    draws++; streak = 0;
  }
  if (Math.abs(streak) > Math.abs(best)) best = streak;
  const rating = Math.max(0, u.rating + delta);
  const peak = Math.max(u.peak_rating, rating);
  db.prepare(
    `UPDATE users SET rating=?, peak_rating=?, wins=?, losses=?, draws=?, streak=?, best_streak=? WHERE id=?`
  ).run(rating, peak, wins, losses, draws, streak, best, u.id);
}

/* ---------------- 排行榜 ---------------- */
function leaderboard(limit) {
  const n = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
  return db.prepare(
    `SELECT id, nickname, rating, peak_rating, wins, losses, draws, streak, best_streak, avatar
     FROM users ORDER BY rating DESC, wins DESC LIMIT ?`
  ).all(n).map(publicProfile);
}

/* ---------------- 对局历史 ---------------- */
function gamesFor(email, limit) {
  const e = String(email || '').toLowerCase().trim();
  if (!e) return [];
  const n = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
  return db.prepare(
    `SELECT * FROM games WHERE red_email = ? OR black_email = ?
     ORDER BY created_at DESC LIMIT ?`
  ).all(e, e, n).map(function (g) {
    return {
      id: g.id,
      mode: g.mode,
      redName: g.red_name,
      blackName: g.black_name,
      winner: g.winner,
      reason: g.reason,
      moves: safeJson(g.moves),
      notation: g.notation ? g.notation.split(',') : [],
      perMove: g.per_move,
      aiLevel: g.ai_level,
      createdAt: g.created_at,
      mySide: (g.red_email === e) ? 0 : 1
    };
  });
}

function gameById(id) {
  const g = db.prepare('SELECT * FROM games WHERE id = ?').get(id);
  if (!g) return null;
  return {
    id: g.id,
    mode: g.mode,
    redName: g.red_name,
    blackName: g.black_name,
    winner: g.winner,
    reason: g.reason,
    moves: safeJson(g.moves),
    notation: g.notation ? g.notation.split(',') : [],
    perMove: g.per_move,
    aiLevel: g.ai_level,
    createdAt: g.created_at
  };
}

function safeJson(s) {
  try { return JSON.parse(s); } catch (e) { return []; }
}

/* ---------------- 统计 ---------------- */
function globalStats() {
  const users = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  const games = db.prepare('SELECT COUNT(*) AS n FROM games').get().n;
  return { users, games };
}

module.exports = {
  db, DB_PATH,
  RANKS, rankFor, nextRank, eloDelta,
  getUserByEmail, getUserById, createUser, updateNickname,
  publicProfile, recordGame, applyResult,
  leaderboard, gamesFor, gameById, globalStats
};
