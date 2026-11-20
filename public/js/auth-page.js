/* 登录页逻辑：发验证码 → 校验 → 保存会话 → 跳转。
 * 依赖 core.js（window.XQAuth）。
 */
(function () {
  'use strict';
  var A = window.XQAuth;
  function $(id) { return document.getElementById(id); }

  function showMsg(msg, kind) {
    var el = $('loginError');
    el.textContent = msg || '';
    el.className = 'msg' + (kind ? ' ' + kind : '');
  }

  var sendTimer = 0;
  function startCountdown() {
    var btn = $('btnSendCode');
    var left = 60;
    btn.disabled = true;
    btn.textContent = left + 's 后重发';
    clearInterval(sendTimer);
    sendTimer = setInterval(function () {
      left--;
      if (left <= 0) {
        clearInterval(sendTimer);
        btn.disabled = false;
        btn.textContent = '发送验证码';
      } else {
        btn.textContent = left + 's 后重发';
      }
    }, 1000);
  }

  function sendCode(email, cb) {
    A.api('/api/auth/send-code', { method: 'POST', body: { email: email } }).then(function (r) {
      if (r.ok) cb(null, r.debugCode || null);
      else cb(new Error(r.msg || '发送失败'));
    }).catch(function (e) { cb(e); });
  }

  function verify(email, code, cb) {
    A.api('/api/auth/verify', { method: 'POST', body: { email: email, code: code } }).then(function (r) {
      if (r.ok && r.token) { A.saveSession(r.token, r.user); cb(null, r.user); }
      else cb(new Error(r.msg || '验证失败'));
    }).catch(function (e) { cb(e); });
  }

  /* 登录成功跳转：next 参数 > 主页 */
  function goNext() {
    var m = /[?&]next=([^&]+)/.exec(location.search);
    var next = m ? decodeURIComponent(m[1]) : '/';
    // 防止 open redirect
    if (next.charAt(0) !== '/') next = '/';
    A.navigate(next);
  }

  $('btnSendCode').addEventListener('click', function () {
    var email = $('loginEmail').value.trim();
    if (!email) { showMsg('请输入邮箱', 'warn'); return; }
    var btn = this;
    btn.disabled = true;
    btn.textContent = '发送中…';
    sendCode(email, function (err, debugCode) {
      if (err) {
        btn.disabled = false;
        btn.textContent = '发送验证码';
        showMsg(err.message, 'warn');
        return;
      }
      startCountdown();
      if (debugCode) {
        $('loginCode').value = debugCode;
        showMsg('开发模式：验证码已自动填入 ' + debugCode, 'ok');
      } else {
        showMsg('验证码已发送，请查收邮件', 'ok');
      }
    });
  });

  $('btnLogin').addEventListener('click', function () {
    var email = $('loginEmail').value.trim();
    var code = $('loginCode').value.trim();
    if (!email || !code) { showMsg('请输入邮箱和验证码', 'warn'); return; }
    var btn = this;
    btn.disabled = true;
    verify(email, code, function (err) {
      btn.disabled = false;
      if (err) { showMsg(err.message, 'warn'); return; }
      goNext();
    });
  });

  ['loginEmail', 'loginCode'].forEach(function (id) {
    $(id).addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); $('btnLogin').click(); }
    });
  });

  /* 已登录则直接回主页 */
  A.refreshMe().then(function (u) {
    if (u) goNext();
  });
})();
