'use strict';
/* 认证模块：邮箱验证码登录 + 会话 token
 * - 验证码存内存（6 位数字，5 分钟过期，60 秒重发冷却）
 * - 登录态用 HMAC 签名的 token（无需额外依赖），有效期 30 天
 */
const crypto = require('crypto');
const nodemailer = require('nodemailer');

const DB = require('./db.js');

/* SMTP 配置（从环境变量读取） */
const SMTP_HOST = process.env.SMTP_HOST || '';
const SMTP_PORT = parseInt(process.env.SMTP_PORT, 10) || 465;
const SMTP_SECURE = (process.env.SMTP_SECURE || 'true') !== 'false';
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';
const MAIL_FROM = process.env.MAIL_FROM || SMTP_USER;

const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const SESSION_TTL = 30 * 24 * 3600 * 1000; // 30 天

/* 验证码存储：email -> { code, expires, lastSent } */
const codes = new Map();
const CODE_TTL = 5 * 60 * 1000;   // 5 分钟
const CODE_RESEND = 60 * 1000;    // 60 秒重发冷却
const MAX_ATTEMPTS = 5;           // 每个验证码最多尝试 5 次

let transporter = null;
function getTransporter() {
  if (transporter) return transporter;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) return null;
  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_SECURE,
    auth: { user: SMTP_USER, pass: SMTP_PASS }
  });
  return transporter;
}

function smtpConfigured() {
  return !!(SMTP_HOST && SMTP_USER && SMTP_PASS);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validEmail(s) {
  return typeof s === 'string' && EMAIL_RE.test(s.trim()) && s.length <= 254;
}

function genCode() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

/* 发送验证码。返回 { ok, msg, debugCode? } */
async function sendCode(email) {
  const e = String(email || '').toLowerCase().trim();
  if (!validEmail(e)) return { ok: false, msg: '邮箱格式不正确' };

  const rec = codes.get(e);
  const now = Date.now();
  if (rec && now - rec.lastSent < CODE_RESEND) {
    const wait = Math.ceil((CODE_RESEND - (now - rec.lastSent)) / 1000);
    return { ok: false, msg: '发送太频繁，请 ' + wait + ' 秒后再试' };
  }

  const code = genCode();
  codes.set(e, { code, expires: now + CODE_TTL, lastSent: now, attempts: 0 });

  if (!smtpConfigured()) {
    // 未配置 SMTP：仅当显式开启 DEV_AUTH 才返回验证码（本地调试），否则拒绝
    if (process.env.DEV_AUTH === '1') {
      return { ok: true, msg: 'SMTP 未配置（开发模式）', dev: true, debugCode: code };
    }
    codes.delete(e);
    return { ok: false, msg: '登录服务未配置，请稍后再试或联系管理员' };
  }

  try {
    const t = getTransporter();
    await t.sendMail({
      from: MAIL_FROM,
      to: e,
      subject: '中国象棋 · 登录验证码',
      text: '您的验证码是 ' + code + '，5 分钟内有效。如非本人操作请忽略。',
      html: '<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;border:1px solid #eee;border-radius:8px">'
        + '<h2 style="margin:0 0 12px;color:#b0392b">中国象棋</h2>'
        + '<p style="font-size:15px">您的登录验证码是：</p>'
        + '<div style="font-size:32px;letter-spacing:8px;font-weight:700;color:#26241f;padding:12px 0">' + code + '</div>'
        + '<p style="color:#888;font-size:13px">5 分钟内有效，如非本人操作请忽略本邮件。</p>'
        + '</div>'
    });
    return { ok: true, msg: '验证码已发送' };
  } catch (err) {
    codes.delete(e);
    return { ok: false, msg: '邮件发送失败：' + (err.message || '请检查 SMTP 配置') };
  }
}

/* 校验验证码并登录/注册。返回 { ok, token?, user?, msg } */
function verifyCode(email, code) {
  const e = String(email || '').toLowerCase().trim();
  const c = String(code || '').trim();
  const rec = codes.get(e);
  if (!rec) return { ok: false, msg: '请先获取验证码' };
  if (Date.now() > rec.expires) { codes.delete(e); return { ok: false, msg: '验证码已过期，请重新获取' }; }
  if (rec.attempts >= MAX_ATTEMPTS) { codes.delete(e); return { ok: false, msg: '尝试次数过多，请重新获取' }; }
  rec.attempts++;
  if (rec.code !== c) return { ok: false, msg: '验证码错误' };

  codes.delete(e);
  let user = DB.getUserByEmail(e);
  if (!user) user = DB.createUser(e, e.split('@')[0]);
  const token = signToken(user.id, user.email);
  return { ok: true, token, user: DB.publicProfile(user) };
}

/* ---------------- 会话 token（HMAC 签名） ---------------- */
function signToken(id, email) {
  const payload = JSON.stringify({ id, email, exp: Date.now() + SESSION_TTL });
  const b64 = Buffer.from(payload).toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(b64).digest('base64url');
  return b64 + '.' + sig;
}

function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  const idx = token.lastIndexOf('.');
  if (idx < 0) return null;
  const b64 = token.slice(0, idx);
  const sig = token.slice(idx + 1);
  const expect = crypto.createHmac('sha256', SESSION_SECRET).update(b64).digest('base64url');
  // 恒定时间比较
  const a = Buffer.from(sig), b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(b64, 'base64url').toString());
    if (Date.now() > payload.exp) return null;
    const user = DB.getUserById(payload.id);
    return user ? DB.publicProfile(user) : null;
  } catch (e) { return null; }
}

module.exports = {
  smtpConfigured, sendCode, verifyCode, signToken, verifyToken, validEmail
};
