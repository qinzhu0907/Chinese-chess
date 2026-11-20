/* 排行榜页：领奖台 + 完整榜单。依赖 core.js。 */
(function () {
  'use strict';
  var A = window.XQAuth;
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[<>&"]/g, function (c) { return { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]; }); }

  function load() {
    A.api('/api/leaderboard?limit=100').then(function (r) {
      var list = r.list || [];
      var me = A.getUser();

      var podium = $('lbPodium');
      var order = [1, 0, 2];
      podium.innerHTML = list.slice(0, 3).length ? order.map(function (idx) {
        if (!list[idx]) return '';
        var u = list[idx], place = idx + 1;
        return '<div class="pod p' + place + '"><span class="pod-av">' + (u.rankIcon || '♟') + '</span>' +
          '<span class="pod-name">' + esc(u.nickname) + '</span>' +
          '<span class="pod-pt">' + u.rating + '</span></div>';
      }).join('') : '<div class="bp-empty">暂无玩家</div>';

      var box = $('lbList');
      box.innerHTML = '';
      if (!list.length) {
        box.innerHTML = '<div class="history-empty">暂无玩家</div>';
        return;
      }
      list.slice(3).forEach(function (u, i) {
        var el = document.createElement('div');
        el.className = 'lb-item' + (me && u.id === me.id ? ' me' : '');
        el.innerHTML = '<span class="lb-rank">' + (i + 4) + '</span>' +
          '<span class="lb-avatar" style="background:' + (u.rankColor || '#b0392b') + '">' + (u.rankIcon || '♟') + '</span>' +
          '<span class="lb-name"><b>' + esc(u.nickname) + '</b><i>' + u.rank + '</i></span>' +
          '<span class="lb-stat"><b>' + u.rating + '</b><i>' + u.wins + '胜 ' + u.losses + '负</i></span>';
        box.appendChild(el);
      });
    });
  }

  $('btnBack').addEventListener('click', function () { A.navigate('/'); });

  A.refreshMe().then(function (u) {
    if (!u) { A.navigate('/login.html?next=' + encodeURIComponent('/leaderboard.html')); return; }
    load();
  });
})();
