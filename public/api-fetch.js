/*
 * api-fetch.js — ต้องโหลดใน <head> ก่อนสคริปต์อื่นทุกตัว
 *
 * ปัญหาที่แก้:
 *   ระบบย้ายจาก cookie มาใช้ token ใน localStorage แต่หน้าเว็บส่วนใหญ่
 *   ยัง fetch โดยไม่แนบ Authorization header (expense 0/6, profile 0/8)
 *   พอ cookie หมดอายุ -> backend ตอบ 401 -> เด้งไป login -> login เห็น token
 *   -> เด้งต่อไป index  ผู้ใช้เลยเห็นแค่ "กดแล้วเด้งกลับหน้าแรก" โดยไม่มีคำอธิบาย
 *
 * วิธีแก้:
 *   ครอบ window.fetch ให้แนบ Authorization: Bearer <token> อัตโนมัติ
 *   เฉพาะคำขอที่ยิงไปหลังบ้านของเราเอง (same-origin) ไม่ยุ่งกับ CDN ภายนอก
 *   ทำให้ทุกหน้าได้รับการแก้พร้อมกันโดยไม่ต้องไล่แก้ fetch ทีละจุด
 */
(function () {
  'use strict';
  if (window.__apiFetchPatched) return;
  window.__apiFetchPatched = true;

  var orig = window.fetch.bind(window);

  /* ── ฐาน path ของแอป ──────────────────────────────────────
     UAT เสิร์ฟที่ราก (localhost:8081/) แต่ production อยู่ใต้ /prompt/
     โค้ดเรียก fetch('/stats') ซึ่งบน production จะกลายเป็น
     https://209.15.119.96/stats -> หลุดออกนอกแอปเราไปโดนของทีมอื่น -> 404
     (ยืนยันแล้ว: /prompt/stats = 401 ถึงเรา แต่ /stats = 404 ไม่ถึง)
     จึงเติมฐาน path ให้อัตโนมัติ แก้ที่เดียวได้ทุกหน้า
     และไม่ต้องไปแตะ nginx ของเครื่องซึ่งใช้ร่วมกับทีมอื่น */
  var BASE = (function () {
    var m = /^(\/[^\/]+)\//.exec(location.pathname || '/');
    // นับเป็นฐานเฉพาะเมื่อหน้าเว็บถูกเสิร์ฟใต้โฟลเดอร์นั้นจริง
    return (m && m[1] !== '/data') ? m[1] : '';
  })();
  window.__apiBase = BASE;

  function withBase(url) {
    if (!BASE) return url;
    if (url.charAt(0) !== '/') return url;                     // path สัมพัทธ์ ไม่ต้องแตะ
    if (url === BASE || url.indexOf(BASE + '/') === 0) return url;  // เติมไปแล้ว
    return BASE + url;
  }

  function isOwnApi(url) {
    if (!url) return false;
    if (url.indexOf('//') === 0) return false;                 // //cdn...
    if (url.charAt(0) === '/') return true;                    // /settings
    if (url.indexOf(location.origin) === 0) return true;       // http://host/...
    return !/^https?:/i.test(url);                             // path สัมพัทธ์ เช่น data/x.json
  }

  window.fetch = function (input, init) {
    var url = (typeof input === 'string') ? input
            : (input && input.url) ? input.url : '';

    if (!isOwnApi(url)) return orig(input, init);

    var target = withBase(url);
    init = init ? Object.assign({}, init) : {};

    var headers = new Headers(
      init.headers ||
      ((typeof input !== 'string' && input && input.headers) ? input.headers : undefined) ||
      {}
    );

    if (!headers.has('Authorization')) {
      var t = null;
      try { t = localStorage.getItem('token'); } catch (e) { /* โหมดส่วนตัวอาจอ่านไม่ได้ */ }
      if (t) headers.set('Authorization', 'Bearer ' + t);
    }
    init.headers = headers;

    // ส่ง cookie ไปด้วย เผื่อ backend รุ่นเก่าที่ยังอ่านแต่ cookie
    if (!init.credentials) init.credentials = 'same-origin';

    return orig(target, init)
      .then(function (res) {
        // เซสชันหมดอายุ: ต้องบอกผู้ใช้ ห้ามเด้งเงียบๆ กลับหน้าแรก
        if (res.status === 401 && url.indexOf('/auth/login') < 0 && url.indexOf('/auth/register') < 0) {
          sessionExpired();
        }
        return res;
      });
  };

  var bounced = false;
  function sessionExpired() {
    if (bounced) return;
    bounced = true;
    try { localStorage.removeItem('token'); } catch (e) {}
    banner('เซสชันหมดอายุ — กำลังพากลับไปหน้าเข้าสู่ระบบ', 'warn');
    setTimeout(function () {
      location.replace('login.html?reason=expired');
    }, 1800);
  }

  /* ── ตาข่ายกันพลาด: ถ้ามีอะไรพังต้องเห็นข้อความเสมอ ห้ามเงียบ ── */
  function banner(msg, kind) {
    var id = '__appBanner';
    var el = document.getElementById(id);
    if (!el) {
      el = document.createElement('div');
      el.id = id;
      el.style.cssText =
        'position:fixed;left:50%;top:16px;transform:translateX(-50%);z-index:2147483647;' +
        'max-width:90vw;padding:12px 18px;border-radius:12px;' +
        'font-family:"IBM Plex Sans Thai","IBM Plex Sans",sans-serif;' +
        'font-size:14px;font-weight:600;box-shadow:0 8px 28px rgba(0,0,0,.18);white-space:pre-wrap;';
      (document.body || document.documentElement).appendChild(el);
    }
    var style = {
      warn:  ['#fffbeb', '#fcd34d', '#92400e'],
      error: ['#fef2f2', '#fca5a5', '#991b1b']
    }[kind] || ['#eff6ff', '#93c5fd', '#1e40af'];
    el.style.background = style[0];
    el.style.border = '1.5px solid ' + style[1];
    el.style.color = style[2];
    el.textContent = msg;
  }
  window.__appBanner = banner;

  // JS พังกลางคัน -> เดิมจะเงียบสนิท ผู้ใช้เห็นแค่ "กดแล้วไม่เกิดอะไร"
  window.addEventListener('error', function (e) {
    if (!e || !e.message) return;
    banner('เกิดข้อผิดพลาดในหน้านี้: ' + e.message + '\n(กรุณาแจ้งผู้ดูแลระบบ)', 'error');
  });
  window.addEventListener('unhandledrejection', function (e) {
    var m = (e && e.reason && (e.reason.message || e.reason)) || 'ไม่ทราบสาเหตุ';
    banner('คำสั่งทำงานไม่สำเร็จ: ' + m + '\n(กรุณาลองใหม่ หรือแจ้งผู้ดูแลระบบ)', 'error');
  });
})();
