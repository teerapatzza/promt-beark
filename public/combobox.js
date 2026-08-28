/*
 * combobox.js — ช่องกรอกที่เลือกจากรายการได้ และพิมพ์ค่าใหม่เองก็ได้
 *
 * ทำไมไม่ใช้ <datalist> :
 *   <datalist> เป็นของเบราว์เซอร์ ปรับหน้าตาไม่ได้เลยแม้แต่นิดเดียว
 *   กล่องที่เด้งขึ้นมาหน้าตาไม่เข้ากับหน้าเว็บ ตัวอักษรเล็ก และทับข้อความคำอธิบายด้านล่าง
 *   อีกอย่างคือมันไม่บอกผู้ใช้ว่า "ค่าที่พิมพ์ใหม่จะถูกเพิ่มเข้ารายการ" ซึ่งเป็นหัวใจของช่องนี้
 *
 * ตัวนี้จึงวาดรายการเอง คุมหน้าตาได้ ใช้คีย์บอร์ดได้ และบอกชัดว่ากำลังจะเพิ่มค่าใหม่
 *
 * ใช้งาน:  const cb = Combobox.attach('pPosition', { addLabel: 'ตำแหน่ง' });
 *          cb.setItems([...]);  cb.setValue('ผู้เยี่ยมสำรวจ');  cb.getValue();
 */
(function () {
  'use strict';

  var CSS = [
    '.cb-wrap{position:relative}',
    '.cb-list{position:absolute;left:0;right:0;top:calc(100% + 6px);z-index:9500;',
    '  background:#fff;border:1px solid #e2e8f0;border-radius:12px;',
    '  box-shadow:0 12px 32px rgba(15,23,42,.14);overflow:hidden;display:none}',
    '.cb-list.open{display:block}',
    '.cb-scroll{max-height:248px;overflow-y:auto;overscroll-behavior:contain}',
    '.cb-head{padding:7px 12px;font-size:11px;font-weight:700;color:#94a3b8;',
    '  background:#f8fafc;border-bottom:1px solid #f1f5f9;letter-spacing:.02em}',
    '.cb-opt{display:flex;align-items:center;gap:8px;width:100%;text-align:left;',
    '  padding:9px 12px;font-size:14px;color:#1e293b;background:none;border:0;',
    '  border-bottom:1px solid #f8fafc;cursor:pointer;line-height:1.45}',
    '.cb-opt:last-child{border-bottom:0}',
    '.cb-opt:hover,.cb-opt.on{background:#eff6ff}',
    '.cb-opt mark{background:#dbeafe;color:#1d4ed8;padding:0;border-radius:2px;font-weight:700}',
    '.cb-new{border-top:1px solid #f1f5f9;background:#f0fdf4;color:#166534;font-weight:600}',
    '.cb-new:hover,.cb-new.on{background:#dcfce7}',
    '.cb-new .cb-plus{display:inline-flex;align-items:center;justify-content:center;',
    '  width:18px;height:18px;border-radius:50%;background:#16a34a;color:#fff;',
    '  font-size:13px;line-height:1;flex:0 0 auto}',
    '.cb-empty{padding:12px;font-size:13px;color:#94a3b8}',
    '.cb-caret{position:absolute;right:12px;top:50%;transform:translateY(-50%);',
    '  pointer-events:none;color:#94a3b8;transition:transform .15s}',
    '.cb-wrap.open .cb-caret{transform:translateY(-50%) rotate(180deg);color:#3b82f6}'
  ].join('\n');

  if (!document.getElementById('cb-style')) {
    var st = document.createElement('style');
    st.id = 'cb-style';
    st.textContent = CSS;
    (document.head || document.documentElement).appendChild(st);
  }

  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  var norm = function (s) { return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim(); };

  function attach(inputId, opts) {
    var input = document.getElementById(inputId);
    if (!input) return null;
    if (input.__cb) return input.__cb;
    opts = opts || {};

    // ปิด datalist เดิมถ้ามี ไม่งั้นจะเด้งสองกล่องซ้อนกัน
    input.removeAttribute('list');
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-expanded', 'false');

    var wrap = document.createElement('div');
    wrap.className = 'cb-wrap';
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);

    var caret = document.createElement('span');
    caret.className = 'cb-caret';
    caret.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" ' +
      'stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="m6 9 6 6 6-6"/></svg>';
    wrap.appendChild(caret);
    if (!input.style.paddingRight) input.style.paddingRight = '34px';

    var list = document.createElement('div');
    list.className = 'cb-list';
    list.setAttribute('role', 'listbox');
    wrap.appendChild(list);

    var items = [], shown = [], cursor = -1, open = false;

    function render() {
      var q = norm(input.value);
      shown = q ? items.filter(function (v) { return norm(v).indexOf(q) >= 0; }) : items.slice();
      var exact = items.some(function (v) { return norm(v) === q; });
      var html = '';

      if (shown.length) {
        html += '<div class="cb-head">' +
          (q ? 'ตรงกับที่พิมพ์ ' + shown.length + ' รายการ' : 'เลือกจากรายการ ' + items.length + ' รายการ') +
          '</div><div class="cb-scroll">';
        html += shown.map(function (v, i) {
          var label = esc(v);
          if (q) {
            var at = norm(v).indexOf(q);
            if (at >= 0) {
              label = esc(v.slice(0, at)) + '<mark>' + esc(v.slice(at, at + q.length)) +
                      '</mark>' + esc(v.slice(at + q.length));
            }
          }
          return '<button type="button" class="cb-opt" role="option" data-i="' + i + '">' +
                 '<span>' + label + '</span></button>';
        }).join('');
        html += '</div>';
      } else if (!q) {
        html += '<div class="cb-empty">ยังไม่มีรายการ — พิมพ์เพื่อเพิ่มรายการแรกได้เลย</div>';
      }

      // ค่าที่ยังไม่มีในรายการ: บอกให้ชัดว่ากดแล้วจะถูกเพิ่มเข้ารายการกลาง
      if (q && !exact) {
        html += '<button type="button" class="cb-opt cb-new" data-new="1">' +
                '<span class="cb-plus">+</span><span>เพิ่ม “' + esc(input.value.trim()) + '” ' +
                'เป็น' + esc(opts.addLabel || 'รายการ') + 'ใหม่</span></button>';
      }

      list.innerHTML = html;
      cursor = -1;

      Array.prototype.forEach.call(list.querySelectorAll('.cb-opt'), function (b) {
        b.addEventListener('mousedown', function (e) {
          e.preventDefault();                       // กัน blur ก่อนคลิกติด
          pick(b.dataset.new ? input.value.trim() : shown[+b.dataset.i]);
        });
      });
    }

    function pick(v) {
      input.value = v || '';
      close();
      input.dispatchEvent(new Event('input',  { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      if (typeof opts.onPick === 'function') opts.onPick(v);
    }

    function show() { render(); list.classList.add('open'); wrap.classList.add('open'); open = true; input.setAttribute('aria-expanded', 'true'); }
    function close() { list.classList.remove('open'); wrap.classList.remove('open'); open = false; input.setAttribute('aria-expanded', 'false'); }

    function move(step) {
      var btns = list.querySelectorAll('.cb-opt');
      if (!btns.length) return;
      if (cursor >= 0) btns[cursor].classList.remove('on');
      cursor = (cursor + step + btns.length) % btns.length;
      btns[cursor].classList.add('on');
      btns[cursor].scrollIntoView({ block: 'nearest' });
    }

    input.addEventListener('focus', show);
    input.addEventListener('input', function () { if (open) render(); else show(); });
    input.addEventListener('blur', function () { setTimeout(close, 120); });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); if (!open) show(); else move(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
      else if (e.key === 'Enter') {
        if (open && cursor >= 0) { e.preventDefault(); list.querySelectorAll('.cb-opt')[cursor].dispatchEvent(new MouseEvent('mousedown')); }
        else close();
      } else if (e.key === 'Escape') { close(); }
    });
    caret.style.pointerEvents = 'auto';
    caret.addEventListener('mousedown', function (e) {
      e.preventDefault();
      if (open) close(); else { input.focus(); show(); }
    });

    var api = {
      setItems: function (arr) {
        items = (arr || []).map(function (v) { return String(v); }).filter(Boolean);
        if (open) render();
      },
      getItems: function () { return items.slice(); },
      setValue: function (v) { input.value = v == null ? '' : String(v); },
      getValue: function () { return input.value.trim(); },
      close: close
    };
    input.__cb = api;
    return api;
  }

  window.Combobox = { attach: attach };
})();
