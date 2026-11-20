/* 核心共享模块：认证状态、API 封装、登录门禁守卫。
 * 所有页面共用（login / index / game / profile / leaderboard）。
 * 暴露 window.XQAuth。
 */
(function () {
  'use strict';

  var LS_KEY = 'xq_auth_token';
  var LS_NAME = 'xq_name';

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) {} }

  var auth = {
    token: lsGet(LS_KEY) || '',
    user: null
  };

  function api(path, opts) {
    opts = opts || {};
    var headers = { 'Content-Type': 'application/json' };
    if (auth.token) headers['Authorization'] = 'Bearer ' + auth.token;
    return fetch(path, {
      method: opts.method || 'GET',
      headers: headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined
    }).then(function (r) { return r.json().catch(function () { return {}; }); });
  }

  /* 取当前登录态 */
  function refreshMe() {
    if (!auth.token) return Promise.resolve(null);
    return api('/api/me').then(function (r) {
      if (r.ok && r.user) { auth.user = r.user; }
      else { auth.user = null; auth.token = ''; lsDel(LS_KEY); }
      return auth.user;
    }).catch(function () { return null; });
  }

  function saveSession(token, user) {
    auth.token = token;
    auth.user = user;
    lsSet(LS_KEY, token);
    if (user && user.nickname) lsSet(LS_NAME, user.nickname);
  }

  function logout() {
    auth.token = '';
    auth.user = null;
    lsDel(LS_KEY);
  }

  function getToken() { return auth.token; }
  function getUser() { return auth.user; }
  function isLoggedIn() { return !!auth.user; }

  /* 导航封装：统一用 location.replace，测试可注入 spy */
  function navigate(url) {
    if (window.XQNav && typeof window.XQNav === 'function') { window.XQNav(url); return; }
    location.replace(url);
  }

  /* 门禁守卫：未登录跳转登录页（带 return 回跳参数） */
  function guard() {
    if (auth.user) return true;
    var here = encodeURIComponent(location.pathname + location.search);
    navigate('/login.html?next=' + here);
    return false;
  }

  window.XQAuth = {
    auth: auth, api: api, refreshMe: refreshMe,
    saveSession: saveSession, logout: logout,
    getToken: getToken, getUser: getUser, isLoggedIn: isLoggedIn, guard: guard,
    navigate: navigate
  };
})();
