/* ══════════════════════════════════════════════════════════════════
   สลับโหมดสว่าง/มืดของพร้อมเบิก
   ──────────────────────────────────────────────────────────────────
   ไฟล์นี้ต้องถูกโหลดแบบปกติ (ไม่ใส่ defer/async) ใน <head> ก่อน <body>
   เพราะบรรทัดล่างสุดจะตั้งธีมทันทีที่ไฟล์ถูกอ่าน
   ถ้าปล่อยไปตั้งตอน DOMContentLoaded ผู้ใช้จะเห็นหน้าขาววาบก่อนแล้วค่อยมืด

   สามสถานะ  auto = ตามเครื่อง (ค่าเริ่มต้น) · light = สว่าง · dark = มืด
   จำค่าไว้ใน localStorage ต่อเบราว์เซอร์ ไม่ได้ส่งขึ้นเซิร์ฟเวอร์
   เพราะเป็นความชอบของหน้าจอเครื่องนั้น ไม่ใช่ข้อมูลของบัญชีผู้ใช้
   ══════════════════════════════════════════════════════════════════ */
(function () {
    'use strict';

    var KEY = 'pb-theme';
    var ORDER = ['auto', 'light', 'dark'];
    var LABEL = { auto: 'ตามเครื่อง', light: 'สว่าง', dark: 'มืด' };

    var ICON = {
        // ดวงอาทิตย์
        light: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
        // พระจันทร์เสี้ยว
        dark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z"/></svg>',
        // จอคอมพิวเตอร์ แทนการใช้ค่าตามเครื่อง
        auto: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>'
    };

    function saved() {
        try {
            var v = localStorage.getItem(KEY);
            return ORDER.indexOf(v) >= 0 ? v : 'auto';
        } catch (e) {
            // โหมดไม่ระบุตัวตนหรือบล็อกคุกกี้ไว้ อ่านไม่ได้ก็ใช้ค่าตามเครื่อง
            return 'auto';
        }
    }

    function prefersDark() {
        try { return window.matchMedia('(prefers-color-scheme: dark)').matches; }
        catch (e) { return false; }
    }

    /** แปลงค่าที่ผู้ใช้เลือก เป็นธีมจริงที่จะใช้วาด */
    function resolve(mode) {
        return mode === 'auto' ? (prefersDark() ? 'dark' : 'light') : mode;
    }

    function apply(mode) {
        var el = document.documentElement;
        el.setAttribute('data-theme', resolve(mode));
        el.setAttribute('data-theme-mode', mode);
        // บอกเบราว์เซอร์ด้วย เพื่อให้แถบเลื่อนและช่องกรอกพื้นฐานเป็นโทนเดียวกัน
        el.style.colorScheme = resolve(mode);
    }

    function paintButton(btn, mode) {
        btn.innerHTML = ICON[mode] + '<span>' + LABEL[mode] + '</span>';
        btn.title = 'โหมดการแสดงผล: ' + LABEL[mode] +
            (mode === 'auto' ? ' (ตอนนี้' + (resolve(mode) === 'dark' ? 'มืด' : 'สว่าง') + ')' : '') +
            '\nกดเพื่อสลับ ตามเครื่อง → สว่าง → มืด';
        btn.setAttribute('aria-label', btn.title.split('\n')[0]);
    }

    function makeButton() {
        var btn = document.createElement('button');
        btn.id = 'pb-theme-toggle';
        btn.type = 'button';
        btn.onclick = function () {
            var next = ORDER[(ORDER.indexOf(saved()) + 1) % ORDER.length];
            try { localStorage.setItem(KEY, next); } catch (e) { /* เขียนไม่ได้ก็ยังสลับได้ในหน้านี้ */ }
            apply(next);
            paintButton(btn, next);
        };
        paintButton(btn, saved());
        return btn;
    }

    /** วางปุ่มไว้ในแถบหัวเว็บที่ auth-guard.js สร้าง ถ้าไม่มีก็ลอยไว้มุมขวาบน */
    function mount() {
        if (document.getElementById('pb-theme-toggle')) return true;
        var bar = document.getElementById('auth-bar') ||
                  document.querySelector('button[onclick="doLogout()"]');
        var btn = makeButton();
        if (bar) {
            var logout = (bar.querySelector ? bar.querySelector('button[onclick="doLogout()"]') : null) ||
                         (bar.tagName === 'BUTTON' ? bar : null);
            var host = logout ? logout.parentNode : bar;
            host.insertBefore(btn, logout || null);
            return true;
        }
        btn.className = 'pb-floating';
        document.body.appendChild(btn);
        return true;
    }

    /* แถบหัวเว็บถูกสร้างด้วยจาวาสคริปต์หลังตรวจสิทธิ์เสร็จ จึงอาจยังไม่มีตอน DOM พร้อม
       เฝ้าดูจนกว่าจะโผล่ แล้วค่อยเสียบปุ่มเข้าไป เลิกเฝ้าเมื่อครบ 10 วินาที
       ไม่ให้เฝ้าค้างไว้ตลอดอายุหน้าเว็บโดยเปล่าประโยชน์ */
    function waitAndMount() {
        if (document.querySelector('button[onclick="doLogout()"]')) { mount(); return; }
        var stop = false;
        var obs = new MutationObserver(function () {
            if (stop) return;
            if (document.querySelector('button[onclick="doLogout()"]')) {
                stop = true; obs.disconnect(); mount();
            }
        });
        obs.observe(document.body, { childList: true, subtree: true });
        setTimeout(function () {
            if (stop) return;
            stop = true; obs.disconnect();
            mount();   // ไม่มีแถบหัวเว็บจริง ๆ ก็ใช้ปุ่มลอยแทน
        }, 10000);
    }

    // ตั้งธีมทันที ก่อนหน้าเว็บถูกวาด เพื่อไม่ให้เห็นแสงขาววาบตอนเปิดหน้า
    apply(saved());

    // ถ้าเลือก "ตามเครื่อง" ไว้ แล้วผู้ใช้สลับธีมของ Windows ระหว่างเปิดหน้าอยู่ ให้ตามไปด้วย
    try {
        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () {
            if (saved() === 'auto') {
                apply('auto');
                var b = document.getElementById('pb-theme-toggle');
                if (b) paintButton(b, 'auto');
            }
        });
    } catch (e) { /* เบราว์เซอร์เก่าไม่รองรับก็ข้ามไป ไม่กระทบการใช้งาน */ }

    if (document.readyState === 'loading')
        document.addEventListener('DOMContentLoaded', waitAndMount);
    else
        waitAndMount();
})();
