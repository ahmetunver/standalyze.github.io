/* ============================================================================
   notifications.js — Standalyze ortak bildirim zili
   ----------------------------------------------------------------------------
   KULLANIM: Zil (.notif-btn) bulunan HER sayfada, </body>'den hemen önce,
             auth.js YÜKLENDİKTEN SONRA ekle:
                 <script src="notifications.js"></script>

   - Sayfadaki .notif-btn'i otomatik bulur, yanına açılır panel kurar.
   - Son günün verisini (standalyze-get-reports) ve rolleri (standalyze-config)
     kendisi çeker, bildirimleri üretir (rapor hazır / görülmeyenler / düşük aktiflik).
   - Tamamı IIFE içinde: sayfa kodlarındaki global değişkenlerle ÇAKIŞMAZ.
   - Sayfada zaten bir #notifPanel varsa (ör. dashboard'ın kendi paneli) hiçbir
     şey yapmaz; çift kurulum olmaz.
   ========================================================================== */
(function () {
  'use strict';

  function init() {
    // Zaten kurulu mu? (ör. dashboard'ın gömülü paneli) -> dokunma
    if (document.getElementById('notifPanel')) return;
    var btn = document.querySelector('.notif-btn');
    if (!btn) return;

    var API_URL = 'https://y4ubflxdcc.execute-api.eu-central-1.amazonaws.com';
    var ROLE_ACTIVE = { saha: ['standing', 'walking'], masabasi: ['sitting', 'standing', 'walking'] };
    var ROLE_LABEL = { saha: 'Saha', masabasi: 'Masabaşı' };
    var FALLBACK_NAMES = ['berk', 'kadir', 'sevcan', 'mabed', 'mazhar', 'kevser', 'sevgi'];
    var workerRoles = {};

    async function authHeader() {
      try { var t = window.Auth && (await Auth.idToken()); return t ? { Authorization: 'Bearer ' + t } : {}; }
      catch (e) { return {}; }
    }
    function ymd(d) {
      var y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), da = String(d.getDate()).padStart(2, '0');
      return y + '-' + m + '-' + da;
    }
    function roleOf(name) { return workerRoles[(name || '').toLowerCase()] || 'saha'; }
    function num(x) { return Number(x) || 0; }

    async function loadRoles() {
      try {
        var r = await fetch(API_URL + '/standalyze-config', { headers: Object.assign({ Accept: 'application/json' }, await authHeader()) });
        if (!r.ok) return;
        var j = await r.json();
        if (j && j.roles && typeof j.roles === 'object') {
          workerRoles = {};
          Object.keys(j.roles).forEach(function (k) { workerRoles[k.toLowerCase()] = String(j.roles[k]).toLowerCase(); });
        }
      } catch (e) {}
    }

    function normPerson(p) {
      var KEYS = ['standing', 'walking', 'sitting', 'unknown'];
      var tot = KEYS.reduce(function (s, k) { var it = p[k] || {}; return s + num(it.seconds != null ? it.seconds : p[k + '_seconds']); }, 0);
      function one(k) { var it = p[k] || {}; var sec = num(it.seconds != null ? it.seconds : p[k + '_seconds']); return { seconds: sec, percent: tot > 0 ? sec / tot * 100 : 0 }; }
      return { standing: one('standing'), walking: one('walking'), sitting: one('sitting'), unknown: one('unknown') };
    }
    function activeRate(acts, role) {
      var tot = acts.standing.seconds + acts.walking.seconds + acts.sitting.seconds + acts.unknown.seconds;
      if (tot <= 0) return null;
      var keys = ROLE_ACTIVE[role] || ROLE_ACTIVE.saha;
      var active = keys.reduce(function (s, k) { return s + (acts[k].seconds || 0); }, 0);
      return Math.round(active / tot * 100);
    }

    async function fetchDay(date) {
      try {
        var url = API_URL + '/standalyze-get-reports?camera=both&date=' + date;
        var res = await fetch(url, { headers: Object.assign({ Accept: 'application/json' }, await authHeader()) });
        if (!res.ok) return { status: res.status, data: null };
        var raw = await res.json();
        var m = (raw && (raw.merged || raw)) || {};
        var data = {};
        Object.keys(m || {}).forEach(function (k) {
          var v = m[k];
          if (v && typeof v === 'object' && (v.standing || v.sitting || v.walking || v.unknown)) data[k.toLowerCase()] = normPerson(v);
        });
        return { status: 200, data: data };
      } catch (e) { return { status: 0, data: null }; }
    }

    // ── Panel arayüzü ──
    var wrap = document.createElement('span');
    wrap.className = 'notif-wrap';
    wrap.style.cssText = 'position:relative;display:inline-flex';
    btn.parentNode.insertBefore(wrap, btn);
    wrap.appendChild(btn);
    if (!btn.style.position) btn.style.position = 'relative';

    var panel = document.createElement('div');
    panel.id = 'notifPanel';
    panel.style.cssText = 'display:none;position:absolute;right:0;top:46px;width:330px;max-height:62vh;overflow-y:auto;background:#fff;border:1px solid #ECE8FB;border-radius:14px;box-shadow:0 16px 48px rgba(40,20,90,.18);z-index:1000;text-align:left';
    panel.innerHTML = '<div style="padding:14px 16px;border-bottom:1px solid #F0EEF8;font-size:14px;font-weight:700;color:#1A1635;font-family:inherit">Bildirimler</div><div id="notifList" style="font-family:inherit"></div>';
    wrap.appendChild(panel);

    function iconSvg(kind) {
      var m = {
        doc: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>',
        eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
        down: '<path d="M23 18l-9.5-9.5-5 5L1 6"/><polyline points="17 18 23 18 23 12"/>',
        warn: '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>'
      };
      return m[kind] || m.doc;
    }
    function trDayFull(iso) { if (!iso) return ''; var d = new Date(iso + 'T00:00:00'); return d.toLocaleDateString('tr-TR', { day: '2-digit', month: 'long', year: 'numeric' }); }

    var NOTIFS = [];
    function render() {
      var list = panel.querySelector('#notifList');
      if (!NOTIFS.length) {
        list.innerHTML = '<div style="padding:20px 16px;text-align:center;color:#A09BB8;font-size:13px;font-family:inherit">Yeni bildirim yok</div>';
      } else {
        list.innerHTML = NOTIFS.map(function (it) {
          return '<div style="display:flex;gap:10px;padding:12px 16px;border-bottom:1px solid #F4F2FB;font-family:inherit">'
            + '<div style="flex:0 0 30px;width:30px;height:30px;border-radius:9px;background:' + it.color + '1A;display:flex;align-items:center;justify-content:center">'
            + '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="' + it.color + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + iconSvg(it.icon) + '</svg></div>'
            + '<div style="min-width:0"><div style="font-size:13px;font-weight:600;color:#1A1635">' + it.title + '</div>'
            + '<div style="font-size:12px;color:#8B85A8;margin-top:2px;line-height:1.4">' + it.desc + '</div></div></div>';
        }).join('');
      }
      var dot = btn.querySelector('.notif-dot');
      if (dot) dot.style.display = NOTIFS.length ? 'block' : 'none';
    }

    function build(data, date) {
      var names = Object.keys(data);
      var extras = [];
      try { extras = JSON.parse(localStorage.getItem('extraEmployees') || '[]').map(function (e) { return (e.name || '').toLowerCase(); }); } catch (e) {}
      var seen = {};
      var roster = FALLBACK_NAMES.concat(extras, names).filter(function (n) { if (!n || seen[n]) return false; seen[n] = 1; return true; });
      var cap = function (s) { return s.charAt(0).toUpperCase() + s.slice(1); };
      var items = [];
      if (date && names.length) {
        items.push({ color: '#16A34A', icon: 'doc', title: 'Günlük rapor hazır', desc: trDayFull(date) + ' · ' + names.length + ' çalışan analiz edildi.' });
        var missing = roster.filter(function (n) { return names.indexOf(n) === -1; });
        if (missing.length) items.push({ color: '#D97706', icon: 'eye', title: missing.length + ' çalışan görülmedi', desc: missing.map(cap).join(', ') });
        names.forEach(function (n) {
          var role = roleOf(n), rate = activeRate(data[n], role);
          if (rate != null && rate < 40) items.push({ color: '#C03050', icon: 'down', title: cap(n) + ' · düşük aktiflik', desc: '%' + rate + ' (' + ROLE_LABEL[role] + ') — gün içinde az hareket görüldü.' });
        });
      } else if (!names.length) {
        items.push({ color: '#C03050', icon: 'warn', title: 'Veri yok', desc: 'Son 14 günde analiz kaydı bulunamadı.' });
      }
      NOTIFS = items;
      render();
    }

    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      var open = !(panel.style.display === 'none' || !panel.style.display);
      panel.style.display = open ? 'none' : 'block';
      var dot = btn.querySelector('.notif-dot');
      if (!open && dot) dot.style.display = 'none';   // açınca "okundu" say
    });
    document.addEventListener('click', function (e) { if (!wrap.contains(e.target)) panel.style.display = 'none'; });

    // ── Veriyi çek, bildirimleri kur ──
    (async function () {
      render(); // boş başlangıç
      // auth.js token'ı hazır olana kadar kısa bekleme: sayfanın kendi isteğiyle
      // eşzamanlı token yenilemesi çakışıp zili token'sız bırakmasın.
      for (var w = 0; w < 12; w++) {
        var hdr = await authHeader();
        if (hdr && hdr.Authorization) break;
        await new Promise(function (res) { setTimeout(res, 300); });
      }
      await loadRoles();
      var found = null, foundDate = null, today = new Date();
      for (var i = 0; i < 14; i++) {
        var dd = new Date(today); dd.setDate(today.getDate() - i);
        var date = ymd(dd);
        var r = await fetchDay(date);
        if (r.data && Object.keys(r.data).length) { found = r.data; foundDate = date; break; }
      }
      build(found || {}, foundDate);
    })();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();