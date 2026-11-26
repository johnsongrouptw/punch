/* 莊臣打卡 — 手機端程式（支援離線） */
(function () {
  'use strict';

  var LS = {
    get: function (k, d) { try { var v = localStorage.getItem('jg_' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem('jg_' + k, JSON.stringify(v)); } catch (e) {} },
    del: function (k) { try { localStorage.removeItem('jg_' + k); } catch (e) {} }
  };
  var $ = function (id) { return document.getElementById(id); };

  // 每支手機的辨識碼（綁定用）
  var deviceId = LS.get('device');
  if (!deviceId) { deviceId = uuid(); LS.set('device', deviceId); }

  var emp = LS.get('emp', null);       // {id, name, type}
  var cfg = LS.get('cfg', null);       // {lat, lng, radius}
  var syncing = false;

  /* ---------- 共用 ---------- */
  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16);
    });
  }
  function api(action, data) {
    var body = Object.assign({ action: action, empId: emp && emp.id, deviceId: deviceId }, data || {});
    return fetch(window.API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body), redirect: 'follow' })
      .then(function (r) { return r.json(); })
      .then(function (j) { if (!j.ok) throw new Error(j.error || '發生錯誤'); return j; });
  }
  function show(view) {
    document.querySelectorAll('main > section').forEach(function (sec) { sec.classList.toggle('hidden', sec.id !== 'v-' + view); });
    window.scrollTo(0, 0);
    if (view === 'main') renderStatus();
    if (view === 'main' && window.JGLeave) window.JGLeave.onMain();
  }
  var toastTimer;
  function toast(msg, ms) {
    var t = $('toast'); t.textContent = msg; t.classList.remove('hidden');
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.classList.add('hidden'); }, ms || 3000);
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function hhmm(d) { return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function applyType() {
    var field = emp && (emp.type === '外勤' || emp.night);
    document.querySelectorAll('.field-only').forEach(function (el) { el.classList.toggle('hidden', !field); });
    $('who').textContent = emp ? emp.name : '';
  }
  function distanceM(lat1, lng1, lat2, lng2) {
    var R = 6371000, k = Math.PI / 180, dLat = (lat2 - lat1) * k, dLng = (lng2 - lng1) * k;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(lat1 * k) * Math.cos(lat2 * k) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  /* ---------- 時鐘與狀態 ---------- */
  function tick() {
    var d = new Date();
    $('c-time').textContent = hhmm(d) + ':' + pad(d.getSeconds());
    $('c-date').textContent = d.getFullYear() + '/' + pad(d.getMonth() + 1) + '/' + pad(d.getDate()) +
      '（' + '日一二三四五六'.charAt(d.getDay()) + '）';
  }
  function renderStatus() {
    var q = LS.get('queue', []);
    var last = LS.get('last', null);
    var s = '';
    if (last) s += '最近打卡：' + last.kind + ' ' + last.time + '<br>';
    if (q.length) s += '<span class="pending">● ' + q.length + ' 筆待上傳' + (navigator.onLine ? '' : '（目前沒有網路）') + '</span>';
    else s += '<span class="done">● 全部已上傳</span>';
    $('c-status').innerHTML = s;
    // 「立即上傳」只在有待上傳紀錄時顯示
    var hasQ = q.length > 0;
    $('b-sync').classList.toggle('hidden', !hasQ);
    $('b-chpw').style.gridColumn = hasQ ? '' : '1 / -1';
  }

  /* ---------- 上傳 ---------- */
  function sync() {
    var q = LS.get('queue', []);
    if (!q.length || syncing || !emp) return Promise.resolve();
    syncing = true;
    return api('punch', { deviceNow: Date.now(), records: q })
      .then(function (j) {
        var ok = {}; j.accepted.forEach(function (id) { ok[id] = 1; });
        LS.set('queue', LS.get('queue', []).filter(function (r) { return !ok[r.id]; }));
      })
      .catch(function (e) {
        if (/綁定/.test(e.message)) unbound(e.message);
      })
      .then(function () { syncing = false; renderStatus(); });
  }
  function unbound(msg) {
    // 手機被解除綁定：保留未上傳的紀錄，回到登入
    LS.del('emp'); emp = null; applyType();
    show('login'); loadEmployees();
    $('l-err').textContent = msg;
  }

  /* ---------- 打卡 ---------- */
  function getPos() {
    return new Promise(function (resolve) {
      if (!navigator.geolocation) return resolve(null);
      navigator.geolocation.getCurrentPosition(
        function (p) { resolve({ lat: +p.coords.latitude.toFixed(6), lng: +p.coords.longitude.toFixed(6), acc: Math.round(p.coords.accuracy) }); },
        function () { resolve(null); },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 });
    });
  }
  function askNote(title) {
    return new Promise(function (resolve) {
      $('note-title').textContent = title;
      $('note-text').value = '';
      $('note-mask').classList.remove('hidden');
      setTimeout(function () { $('note-text').focus(); }, 100);
      $('note-ok').onclick = function () {
        var v = $('note-text').value.trim();
        if (!v) { toast('請填寫備註'); return; }
        $('note-mask').classList.add('hidden'); resolve(v);
      };
      $('note-cancel').onclick = function () { $('note-mask').classList.add('hidden'); resolve(null); };
    });
  }
  function punch(kind, btn) {
    var ts = Date.now();  // 以按下的瞬間為打卡時間
    var buttons = document.querySelectorAll('.big');
    buttons.forEach(function (b) { b.disabled = true; });
    toast('定位中…', 15000);
    getPos().then(function (pos) {
      var inside = false;
      if (pos && cfg && cfg.locations) {
        inside = cfg.locations.some(function (l) {
          return distanceM(pos.lat, pos.lng, Number(l.lat), Number(l.lng)) <= Number(cfg.radius || 200);
        });
      }
      $('toast').classList.add('hidden');
      if (inside) return { pos: pos, note: '' };
      var title = pos ? '不在公司附近打卡' : '無法取得定位';
      return askNote(title + '（' + kind + '）').then(function (note) { return note === null ? null : { pos: pos, note: note }; });
    }).then(function (r) {
      buttons.forEach(function (b) { b.disabled = false; });
      if (!r) { toast('已取消，沒有打卡'); return; }
      var rec = { id: uuid(), kind: kind, ts: ts,
        lat: r.pos ? r.pos.lat : null, lng: r.pos ? r.pos.lng : null, acc: r.pos ? r.pos.acc : null,
        note: r.note, offline: !navigator.onLine };
      var q = LS.get('queue', []); q.push(rec); LS.set('queue', q);
      var t = hhmm(new Date(ts));
      LS.set('last', { kind: kind, time: t });
      toast('已記錄：' + kind + ' ' + t + (navigator.onLine ? '' : '（待上傳）'), 3500);
      renderStatus();
      sync();
    });
  }

  /* ---------- 登入 ---------- */
  function loadEmployees() {
    var sel = $('l-emp');
    if (!navigator.onLine) { sel.innerHTML = '<option value="">請先連上網路</option>'; return; }
    api('employees').then(function (j) {
      sel.innerHTML = '<option value="">— 請選擇 —</option>' +
        j.list.map(function (e) { return '<option value="' + e.id + '">' + e.name + '</option>'; }).join('');
    }).catch(function (e) { sel.innerHTML = '<option value="">載入失敗，請重新整理</option>'; $('l-err').textContent = e.message; });
  }
  $('l-btn').onclick = function () {
    var id = $('l-emp').value, pw = $('l-pw').value;
    $('l-err').textContent = '';
    if (!id || !pw) { $('l-err').textContent = '請選擇名字並輸入密碼'; return; }
    this.disabled = true; var btn = this;
    api('login', { empId: id, password: pw }).then(function (j) {
      emp = { id: j.id, name: j.name, type: j.type, night: j.night }; LS.set('emp', emp);
      cfg = { locations: j.locations, radius: j.radius }; LS.set('cfg', cfg);
      $('l-pw').value = ''; applyType();
      if (j.mustChange) { show('pw'); } else { show('main'); sync(); }
    }).catch(function (e) { $('l-err').textContent = e.message; })
      .then(function () { btn.disabled = false; });
  };

  /* ---------- 改密碼 ---------- */
  $('p-btn').onclick = function () {
    var o = $('p-old').value, n = $('p-new').value, n2 = $('p-new2').value;
    $('p-err').textContent = '';
    if (n.length < 4) { $('p-err').textContent = '新密碼至少 4 碼'; return; }
    if (n !== n2) { $('p-err').textContent = '兩次輸入的新密碼不一樣'; return; }
    var btn = this; btn.disabled = true;
    api('changePassword', { oldPassword: o, newPassword: n }).then(function () {
      ['p-old', 'p-new', 'p-new2'].forEach(function (k) { $(k).value = ''; });
      toast('密碼已更新'); show('main'); sync();
    }).catch(function (e) { $('p-err').textContent = e.message; })
      .then(function () { btn.disabled = false; });
  };

  /* ---------- 紀錄與補登 ---------- */
  $('b-history').onclick = function () {
    show('history');
    var box = $('h-list');
    if (!navigator.onLine) { box.textContent = '需要網路才能查看紀錄。'; return; }
    box.textContent = '載入中…';
    api('history').then(function (j) {
      if (!j.list.length) { box.textContent = '目前沒有紀錄。'; return; }
      box.innerHTML = j.list.map(function (r) {
        return '<div class="row"><div>' + r.date.slice(5).replace('-', '/') + ' ' + r.time + ' ' + r.kind +
          (r.note ? '<small>' + escapeHtml(r.note) + '</small>' : '') + '</div><div><small>' +
          (r.src === '打卡' ? (r.place || '') : r.src) + '</small></div></div>';
      }).join('');
    }).catch(function (e) { box.textContent = e.message; });
  };
  $('b-makeup').onclick = function () {
    var d = new Date();
    $('m-date').value = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    $('m-time').value = ''; $('m-reason').value = ''; $('m-err').textContent = '';
    show('makeup');
  };
  $('m-btn').onclick = function () {
    var data = { date: $('m-date').value, kind: $('m-kind').value, time: $('m-time').value, reason: $('m-reason').value.trim() };
    $('m-err').textContent = '';
    if (!data.date || !data.time || !data.reason) { $('m-err').textContent = '日期、時間、原因都要填'; return; }
    if (!navigator.onLine) { $('m-err').textContent = '需要網路才能送出補登'; return; }
    var btn = this; btn.disabled = true;
    api('makeup', data).then(function () { toast('補登已送出，等待審核'); show('main'); })
      .catch(function (e) { $('m-err').textContent = e.message; })
      .then(function () { btn.disabled = false; });
  };
  $('b-chpw').onclick = function () { show('pw'); };
  $('b-sync').onclick = function () {
    if (!navigator.onLine) { toast('目前沒有網路'); return; }
    if (!LS.get('queue', []).length) { toast('全部已上傳'); return; }
    sync().then(function () { toast(LS.get('queue', []).length ? '上傳失敗，稍後會自動再試' : '上傳完成'); });
  };
  document.querySelectorAll('.back').forEach(function (b) { b.onclick = function () { show('main'); }; });
  document.querySelectorAll('.big').forEach(function (b) { b.onclick = function () { punch(b.dataset.kind, b); }; });

  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  /* ---------- 給請假模組用 ---------- */
  window.JG = { api: api, show: show, toast: toast, $: $, escapeHtml: escapeHtml, getEmp: function () { return emp; } };

  /* ---------- 啟動 ---------- */
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
  window.addEventListener('online', function () { renderStatus(); sync(); });
  window.addEventListener('offline', renderStatus);
  setInterval(tick, 1000); tick();
  setInterval(sync, 60000);

  applyType();
  if (!emp) {
    show('login'); loadEmployees();
  } else {
    show('main'); renderStatus();
    if (navigator.onLine) {
      api('check').then(function (j) {
        emp.type = j.type; emp.night = j.night; emp.name = j.name; LS.set('emp', emp); applyType();
        if (j.mustChange) show('pw');
        api('config').then(function (c) { cfg = { locations: c.locations, radius: c.radius }; LS.set('cfg', cfg); }).catch(function () {});
        sync();
      }).catch(function (e) { if (/綁定|找不到/.test(e.message)) unbound(e.message); });
    }
  }
})();
