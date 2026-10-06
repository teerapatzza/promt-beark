/* ══════════════════════════════════════════════════════════════════
   สลับโหมดสว่าง/มืดของพร้อมเบิก
   ──────────────────────────────────────────────────────────────────
   ไฟล์นี้ต้องถูกโหลดแบบปกติ (ไม่ใส่ defer/async) ใน <head> ก่อน <body>
   เพราะบรรทัดล่างสุดจะตั้งธีมทันทีที่ไฟล์ถูกอ่าน
   ถ้าปล่อยไปตั้งตอน DOMContentLoaded ผู้ใช้จะเห็นหน้าขาววาบก่อนแล้วค่อยมืด

   สองสถานะ  light = สว่าง · dark = มืด
   เปิดครั้งแรกจะดูธีมของ Windows ให้ หลังจากนั้นใช้ค่าที่ผู้ใช้กดเลือกเสมอ
   จำค่าไว้ใน localStorage ต่อเบราว์เซอร์ ไม่ได้ส่งขึ้นเซิร์ฟเวอร์
   เพราะเป็นความชอบของหน้าจอเครื่องนั้น ไม่ใช่ข้อมูลของบัญชีผู้ใช้
   ══════════════════════════════════════════════════════════════════ */
(function () {
    'use strict';

    var KEY = 'pb-theme';
    // 6 ต.ค. 2569 — เดิมมีสามสถานะ auto/light/dark แต่ผู้ใช้ถามว่า "สัญลักษณ์ตามเครื่องคืออะไร"
    // แปลว่ามันไม่ได้ช่วยอะไร มีแต่ทำให้ต้องกดสามทีกว่าจะวนกลับมาที่เดิม
    // เหลือสองสถานะพอ ส่วนการดูค่าจาก Windows ยังทำอยู่ แต่ทำแค่ตอนเปิดครั้งแรก
    var ORDER = ['light', 'dark'];
    var LABEL = { light: 'สว่าง', dark: 'มืด' };

    var ICON = {
        // ดวงอาทิตย์
        light: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
        // พระจันทร์เสี้ยว
        dark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z"/></svg>'
    };

    function saved() {
        try {
            var v = localStorage.getItem(KEY);
            if (ORDER.indexOf(v) >= 0) return v;
            // ยังไม่เคยเลือก (หรือเป็นค่า auto ของรุ่นก่อน) ให้ดูจากธีมของ Windows เป็นค่าตั้งต้น
            return prefersDark() ? 'dark' : 'light';
        } catch (e) {
            // โหมดไม่ระบุตัวตนหรือบล็อกคุกกี้ไว้ อ่านค่าไม่ได้ ก็ยังดูจาก Windows ได้
            return prefersDark() ? 'dark' : 'light';
        }
    }

    function prefersDark() {
        try { return window.matchMedia('(prefers-color-scheme: dark)').matches; }
        catch (e) { return false; }
    }

    function apply(mode) {
        var el = document.documentElement;
        el.setAttribute('data-theme', mode);
        el.setAttribute('data-theme-mode', mode);
        // บอกเบราว์เซอร์ด้วย เพื่อให้แถบเลื่อนและช่องกรอกพื้นฐานเป็นโทนเดียวกัน
        el.style.colorScheme = mode;
    }

    function paintButton(btn, mode) {
        btn.innerHTML = ICON[mode] + '<span>' + LABEL[mode] + '</span>';
        btn.title = 'ตอนนี้: โหมด' + LABEL[mode] + '\nกดเพื่อสลับเป็นโหมด' +
            LABEL[ORDER[(ORDER.indexOf(mode) + 1) % ORDER.length]];
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

    if (document.readyState === 'loading')
        document.addEventListener('DOMContentLoaded', waitAndMount);
    else
        waitAndMount();
})();
