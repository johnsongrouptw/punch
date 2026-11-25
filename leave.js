/* 香港商莊臣打卡 — 請假、審核、外訓、LINE 綁定 */
(function () {
  'use strict';
  var J = window.JG, $ = J.$;
  var meta = null, proxyMode = false;
  var TIMES = ['09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00'];
  function esc(s) { return J.escapeHtml(s == null ? '' : s); }
  function today() { var d = new Date(); return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()); }
  function p2(n) { return (n < 10 ? '0' : '') + n; }
  function opts(sel, list, val) { sel.innerHTML = list.map(function (x) { return '<option' + (x === val ? ' selected' : '') + '>' + esc(x) + '</option>'; }).join(''); }

  /* ---------- 通用視窗 ---------- */
  function modal(o) {
    return new Promise(function (resolve) {
      $('gm-title').textContent = o.title || '';
      $('gm-body').innerHTML = o.html || '';
      var inp = $('gm-input');
      inp.classList.toggle('hidden', !o.input); inp.value = ''; inp.placeholder = o.placeholder || '';
      $('gm-cancel').classList.toggle('hidden', !!o.alertOnly);
      $('gm-btns').style.gridTemplateColumns = o.alertOnly ? '1fr' : '';
      $('gm-ok').textContent = o.okText || '確定';
      $('gm-mask').classList.remove('hidden');
      $('gm-ok').onclick = function () {
        if (o.input && o.required && !inp.value.trim()) { J.toast('請填寫內容'); return; }
        $('gm-mask').classList.add('hidden'); resolve(o.input ? inp.value.trim() : true);
      };
      $('gm-cancel').onclick = function () { $('gm-mask').classList.add('hidden'); resolve(null); };
    });
  }

  /* ---------- 照片壓縮 ---------- */
  function compress(file) {
    return new Promise(function (resolve, reject) {
      var img = new Image(), url = URL.createObjectURL(file);
      img.onload = function () {
        var max = 1600, w = img.width, h = img.height, k = Math.min(1, max / Math.max(w, h));
        var c = document.createElement('canvas'); c.width = Math.round(w * k); c.height = Math.round(h * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL('image/jpeg', 0.8).split(',')[1]);
      };
      img.onerror = function () { reject(new Error('照片讀取失敗')); };
      img.src = url;
    });
  }
  function readImages(input) {
    var files = Array.prototype.slice.call(input.files || [], 0, 5);
    return Promise.all(files.map(compress));
  }

  /* ---------- 主畫面按鈕 ---------- */
  function loadMeta() {
    return J.api('leaveMeta').then(function (m) { meta = m; renderExtra(); return m; });
  }
  function renderExtra() {
    var box = $('leave-extra'); if (!meta) { box.innerHTML = ''; return; }
    var b = [];
    if (meta.isApprover) b.push('<button class="ghost" id="b-approve">待審核' + (meta.pending ? '<span class="badge">' + meta.pending + '</span>' : '') + '</button>');
    if (meta.isApprover || meta.isAdmin) b.push('<button class="ghost" id="b-dept">部門請假</button>');
    if (meta.isAdmin) b.push('<button class="ghost" id="b-proxy">代辦請假</button>');
    if (meta.canTrain) b.push('<button class="ghost" id="b-train">登記外訓</button>');
    if (meta.lineReady && !meta.lineBound) b.push('<button class="ghost" id="b-line" style="border-color:#06c755;color:#06a347">綁定 LINE 通知</button>');
    var html = '';
    for (var i = 0; i < b.length; i += 2) html += '<div class="row2">' + b[i] + (b[i + 1] || '<div></div>') + '</div>';
    box.innerHTML = html;
    if ($('b-approve')) $('b-approve').onclick = openApprove;
    if ($('b-dept')) $('b-dept').onclick = openDept;
    if ($('b-proxy')) $('b-proxy').onclick = function () { openForm(true); };
    if ($('b-train')) $('b-train').onclick = openTrain;
    if ($('b-line')) $('b-line').onclick = bindLine;
  }

  /* ---------- 請假表單 ---------- */
  function unitOf(name) {
    for (var i = 0; i < meta.types.length; i++) if (meta.types[i].name === name) return meta.types[i].unit;
    return 1;
  }
  function applyUnit() {
    var u = unitOf($('lf-type').value);
    var st = $('lf-st').value, et = $('lf-et').value;
    document.querySelectorAll('.lf-time').forEach(function (el) { el.classList.toggle('hidden', u === 'day'); });
    if (u === 1) { opts($('lf-st'), TIMES.slice(0, 9), st || '09:00'); opts($('lf-et'), TIMES.slice(1), et || '18:00'); }
    if (u === 4) { opts($('lf-st'), ['09:00', '14:00'], st === '14:00' ? '14:00' : '09:00'); opts($('lf-et'), ['13:00', '18:00'], et === '13:00' ? '13:00' : '18:00'); }
    if (u === 8) { opts($('lf-st'), ['09:00'], '09:00'); opts($('lf-et'), ['18:00'], '18:00'); }
    $('lf-unit').textContent = u === 'day' ? '產假依規定一次請完，連續計算（含假日），只要選開始與結束日期。'
      : u === 1 ? '以 1 小時為單位。' : u === 4 ? '以半天為單位：上午 09:00–13:00、下午 14:00–18:00。' : '以 1 天為單位。';
  }
  function fillAgents() {
    var forId = proxyMode ? $('lf-emp').value : meta.me.id;
    var list = meta.people.filter(function (p) { return p.id !== forId; });
    $('lf-agent').innerHTML = '<option value="">— 請選擇 —</option>' + list.map(function (p) { return '<option>' + esc(p.name) + '</option>'; }).join('');
  }
  function openForm(proxy) {
    proxyMode = !!proxy;
    var go = function () {
      $('lf-title').textContent = proxyMode ? '代辦請假' : '請假申請';
      $('lf-proxy').classList.toggle('hidden', !proxyMode);
      if (proxyMode) {
        $('lf-emp').innerHTML = meta.people.map(function (p) { return '<option value="' + p.id + '">' + esc(p.name) + '（' + esc(p.dept) + '）</option>'; }).join('');
        $('lf-emp').onchange = fillAgents;
      }
      $('lf-type').innerHTML = meta.types.map(function (t) { return '<option>' + esc(t.name) + '</option>'; }).join('');
      $('lf-sd').value = meta.today; $('lf-ed').value = meta.today;
      $('lf-reason').value = ''; $('lf-files').value = ''; $('lf-err').textContent = '';
      applyUnit(); fillAgents();
      J.show('leave');
    };
    if (!navigator.onLine) { J.toast('請假需要網路'); return; }
    loadMeta().then(go).catch(function (e) { J.toast(e.message); });
  }
  $('lf-type').onchange = applyUnit;
  $('lf-sd').onchange = function () { if ($('lf-ed').value < $('lf-sd').value) $('lf-ed').value = $('lf-sd').value; };

  function formData() {
    var u = unitOf($('lf-type').value);
    return {
      type: $('lf-type').value, startDate: $('lf-sd').value, endDate: $('lf-ed').value,
      startTime: u === 'day' ? '09:00' : $('lf-st').value, endTime: u === 'day' ? '18:00' : $('lf-et').value,
      agent: $('lf-agent').value, reason: $('lf-reason').value.trim()
    };
  }

  $('lf-btn').onclick = function () {
    var f = formData(), btn = this;
    $('lf-err').textContent = '';
    if (!f.agent) { $('lf-err').textContent = '請選擇代理人'; return; }
    if (!f.reason) { $('lf-err').textContent = '請填寫事由'; return; }
    btn.disabled = true;
    var base = proxyMode ? { forEmpId: $('lf-emp').value } : {};
    J.api('leavePreview', Object.assign({ form: f }, base)).then(function (r) {
      if (!r.ok) throw new Error(r.error);
      return confirmLeave(f, r).then(function (urgent) {
        if (urgent === null) return;
        $('lc-ok').disabled = true; $('lc-err').textContent = '';
        return readImages($('lf-files')).then(function (images) {
          return J.api('leaveSubmit', Object.assign({ form: f, urgent: urgent, images: images }, base));
        }).then(function (res) {
          $('lc-mask').classList.add('hidden');
          var msg = res.gm ? '已送出，已通知行政部與代理人。'
            : '已送出。主管原則上於 1 個工作天內審核，預計 <b>' + esc(res.dueText) + '</b> 完成，屆時請到「我的請假」查看狀態。';
          return modal({ title: '請假已送出', html: '<p style="line-height:1.7">' + msg + '</p>', alertOnly: true, okText: '好的' });
        }).then(function (v) { if (v) J.show('main'); })
          .catch(function (e) { $('lc-err').textContent = e.message; })
          .then(function () { $('lc-ok').disabled = false; });
      });
    }).catch(function (e) { $('lf-err').textContent = e.message; })
      .then(function () { btn.disabled = false; });
  };

  function confirmLeave(f, r) {
    return new Promise(function (resolve) {
      var who = proxyMode ? $('lf-emp').selectedOptions[0].textContent + '<br>' : '';
      var range = f.type === '產假' ? f.startDate + ' ～ ' + f.endDate : f.startDate + ' ' + f.startTime + ' ～ ' + (f.endDate !== f.startDate ? f.endDate + ' ' : '') + f.endTime;
      var h = '<div class="m" style="line-height:1.8">' + who + '<b>' + esc(f.type) + '</b>　' + esc(range) +
        '<br>共 <b>' + (r.hours % 8 === 0 ? (r.hours / 8) + ' 天' : r.hours + ' 小時') + '</b>　代理人：' + esc(f.agent) + '</div>';
      if (r.sameDay) h += '<div class="slogan">' + esc(meta.slogan) + '</div>';
      (r.warnings || []).forEach(function (w) { h += '<div class="warnbox">' + esc(w) + '</div>'; });
      if (r.needUrgent) h += '<label class="chk"><input type="checkbox" id="lc-urgent"> 本次請假屬「急病或臨時重大事故」</label>';
      $('lc-body').innerHTML = h; $('lc-err').textContent = '';
      $('lc-mask').classList.remove('hidden');
      $('lc-ok').onclick = function () {
        var urgent = false;
        if (r.needUrgent) {
          urgent = $('lc-urgent').checked;
          if (!urgent) { $('lc-err').textContent = '未符合提前申請規定，若屬急病或臨時重大事故請勾選；否則請返回修改日期。'; return; }
        }
        resolve(urgent);
      };
      $('lc-cancel').onclick = function () { $('lc-mask').classList.add('hidden'); resolve(null); };
    });
  }

  /* ---------- 我的請假 ---------- */
  function card(l, actions, showName) {
    return '<div class="lv"><div class="h"><span>' + (showName ? esc(l.name) + '　' : '') + esc(l.type) + '</span><span class="st st-' + esc(l.status) + '">' + esc(l.status) + '</span></div>' +
      '<div class="m">' + esc(l.range) + '　共 ' + esc(l.hoursText) +
      (l.agent ? '<br>代理人：' + esc(l.agent) : '') +
      (l.reason ? '<br>' + (l.type === '公出外訓' ? '內容' : '事由') + '：' + esc(l.reason) : '') +
      (l.status === '審核中' && l.dueText ? '<br>預計審核：' + esc(l.dueText) : '') +
      (l.approver && l.status !== '審核中' ? '<br>審核：' + esc(l.approver) : '') +
      (l.comment ? '<br>說明：' + esc(l.comment) : '') +
      (l.source && l.source !== '本人' ? '<br><small>' + esc(l.source) + '</small>' : '') +
      '<br><small>證明：' + (l.proofs ? l.proofs + ' 張' : '無') + '</small></div>' +
      (l.flags ? '<div class="flags">⚑ ' + esc(l.flags) + '</div>' : '') +
      (actions ? '<div class="acts">' + actions + '</div>' : '') + '</div>';
  }
  function openMy() {
    J.show('myleave');
    var box = $('ml-list'); box.textContent = '載入中…';
    if (!navigator.onLine) { box.textContent = '需要網路才能查看。'; return; }
    J.api('myLeaves').then(function (r) {
      if (!r.list.length) { box.textContent = '目前沒有請假紀錄。'; return; }
      box.innerHTML = r.list.map(function (l) {
        var a = '';
        if (l.status === '審核中') a += '<button class="ghost" data-cancel="' + l.id + '">取消申請</button>';
        if (l.status !== '已取消' && l.status !== '已駁回' && l.type !== '公出外訓') a += '<button class="ghost" data-proof="' + l.id + '">補上傳證明</button>';
        if (l.proofs) a += '<button class="ghost" data-view="' + l.id + '">查看證明</button>';
        return card(l, a);
      }).join('');
      bindCommon(box, openMy);
      box.querySelectorAll('[data-cancel]').forEach(function (b) {
        b.onclick = function () {
          modal({ title: '取消請假申請', html: '<p>確定要取消這筆申請嗎？</p>', okText: '確定取消' }).then(function (ok) {
            if (!ok) return;
            J.api('leaveCancel', { id: b.dataset.cancel }).then(function () { J.toast('已取消'); openMy(); }).catch(function (e) { J.toast(e.message); });
          });
        };
      });
      box.querySelectorAll('[data-proof]').forEach(function (b) {
        b.onclick = function () {
          var inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*'; inp.multiple = true;
          inp.onchange = function () {
            J.toast('上傳中…', 20000);
            readImages(inp).then(function (images) { return J.api('leaveAddProof', { id: b.dataset.proof, images: images }); })
              .then(function (r) { J.toast('已上傳，共 ' + r.count + ' 張'); openMy(); })
              .catch(function (e) { J.toast(e.message); });
          };
          inp.click();
        };
      });
    }).catch(function (e) { box.textContent = e.message; });
  }
  function bindCommon(box) {
    box.querySelectorAll('[data-view]').forEach(function (b) {
      b.onclick = function () {
        J.toast('載入照片…', 15000);
        J.api('leaveProof', { id: b.dataset.view }).then(function (r) {
          J.toast('已載入', 800);
          modal({ title: '證明文件', html: '<div class="imgs">' + r.images.map(function (src) { return '<img src="' + src + '" alt="證明照片">'; }).join('') + '</div>', alertOnly: true, okText: '關閉' });
        }).catch(function (e) { J.toast(e.message); });
      };
    });
  }

  /* ---------- 待審核 ---------- */
  function openApprove() {
    J.show('approve');
    var box = $('ap-list'); box.textContent = '載入中…';
    J.api('pendingList').then(function (r) {
      if (!r.list.length) { box.textContent = '目前沒有待審核的請假。'; return; }
      box.innerHTML = r.list.map(function (l) {
        return card(l, '<button class="okbtn" data-ok="' + l.id + '">核准</button><button class="danger" data-no="' + l.id + '">駁回</button>' +
          (l.proofs ? '<button class="ghost" data-view="' + l.id + '">查看證明</button>' : ''), true);
      }).join('');
      bindCommon(box);
      box.querySelectorAll('[data-ok]').forEach(function (b) {
        b.onclick = function () { decide(b.dataset.ok, 'approve', ''); };
      });
      box.querySelectorAll('[data-no]').forEach(function (b) {
        b.onclick = function () {
          modal({ title: '駁回請假', html: '<p>請填寫駁回原因，系統會用 LINE 通知申請人。</p>', input: true, required: true, okText: '確定駁回' })
            .then(function (c) { if (c) decide(b.dataset.no, 'reject', c); });
        };
      });
    }).catch(function (e) { box.textContent = e.message; });
  }
  function decide(id, d, c) {
    J.api('leaveDecide', { id: id, decision: d, comment: c }).then(function () {
      J.toast(d === 'approve' ? '已核准，已通知行政部與代理人' : '已駁回，已通知申請人');
      loadMeta(); openApprove();
    }).catch(function (e) { J.toast(e.message); });
  }

  /* ---------- 部門請假 ---------- */
  function openDept() {
    J.show('dept');
    var box = $('dp-list'); box.textContent = '載入中…';
    J.api('deptLeaves').then(function (r) {
      if (!r.list.length) { box.textContent = '沒有已核准的請假。'; return; }
      box.innerHTML = r.list.map(function (l) {
        return card(l, '<button class="danger" data-cx="' + l.id + '">取消這筆假</button>' + (l.proofs ? '<button class="ghost" data-view="' + l.id + '">查看證明</button>' : ''), true);
      }).join('');
      bindCommon(box);
      box.querySelectorAll('[data-cx]').forEach(function (b) {
        b.onclick = function () {
          modal({ title: '取消已核准的請假', html: '<p>請填寫取消原因，系統會通知行政部、代理人與申請人。</p>', input: true, required: true, okText: '確定取消' })
            .then(function (c) {
              if (!c) return;
              J.api('leaveCancelApproved', { id: b.dataset.cx, comment: c }).then(function () { J.toast('已取消'); openDept(); }).catch(function (e) { J.toast(e.message); });
            });
        };
      });
    }).catch(function (e) { box.textContent = e.message; });
  }

  /* ---------- 登記外訓 ---------- */
  function openTrain() {
    loadMeta().then(function () {
      $('tr-people').innerHTML = meta.trainScope.map(function (p) {
        return '<label><input type="checkbox" value="' + p.id + '"> ' + esc(p.name) + '<small style="color:#888">（' + esc(p.dept) + '）</small></label>';
      }).join('');
      $('tr-sd').value = meta.today; $('tr-ed').value = meta.today;
      opts($('tr-st'), TIMES.slice(0, 9), '09:00'); opts($('tr-et'), TIMES.slice(1), '18:00');
      $('tr-title').value = ''; $('tr-err').textContent = '';
      J.show('train');
    }).catch(function (e) { J.toast(e.message); });
  }
  $('tr-sd').onchange = function () { if ($('tr-ed').value < $('tr-sd').value) $('tr-ed').value = $('tr-sd').value; };
  $('tr-btn').onclick = function () {
    var ids = Array.prototype.map.call(document.querySelectorAll('#tr-people input:checked'), function (i) { return i.value; });
    var btn = this; $('tr-err').textContent = '';
    if (!ids.length) { $('tr-err').textContent = '請選擇同仁'; return; }
    btn.disabled = true;
    J.api('trainingAssign', { empIds: ids, form: { startDate: $('tr-sd').value, startTime: $('tr-st').value, endDate: $('tr-ed').value, endTime: $('tr-et').value, title: $('tr-title').value.trim() } })
      .then(function (r) { J.toast('已登記 ' + r.count + ' 位，並已通知'); J.show('main'); })
      .catch(function (e) { $('tr-err').textContent = e.message; })
      .then(function () { btn.disabled = false; });
  };

  /* ---------- LINE 綁定 ---------- */
  function bindLine() {
    J.api('lineBindCode').then(function (r) {
      return modal({
        title: '綁定 LINE 通知',
        html: '<p style="line-height:1.7">請在 10 分鐘內，用 LINE 傳送以下訊息給<b>公司官方帳號</b>：</p>' +
          '<div style="font-size:32px;font-weight:700;text-align:center;letter-spacing:4px;margin:14px 0">綁定 ' + r.code + '</div>' +
          '<p class="hint">收到「綁定成功」的回覆就完成了。之後請假審核、外訓等通知會從官方帳號傳給您。</p>',
        okText: '我已傳送', alertOnly: true
      });
    }).then(function () { setTimeout(loadMeta, 3000); }).catch(function (e) { J.toast(e.message); });
  }

  $('b-leave').onclick = function () { openForm(false); };
  $('b-myleave').onclick = openMy;

  window.JGLeave = {
    onMain: function () { if (J.getEmp() && navigator.onLine) loadMeta().catch(function () {}); }
  };
  if (J.getEmp() && navigator.onLine) loadMeta().catch(function () {});
})();
