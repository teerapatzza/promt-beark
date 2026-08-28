/*
 * thai-address.js — โมดูลที่อยู่ประเทศไทย (ใช้ร่วมกันทุกหน้า)
 *
 * หน้าที่:
 *   1. ให้รายการ จังหวัด/อำเภอ/ตำบล แบบลูกโซ่ (77 / 928 / 7,436)
 *   2. แปลงชื่อที่คนเขียนเอง -> ชื่อทางการ + รหัสมาตรฐานกรมการปกครอง
 *   3. เติมรหัสไปรษณีย์ให้อัตโนมัติ (ไม่ให้พิมพ์เอง)
 *
 * ความเข้ากันได้กับ production:
 *   บันทึก prov/dist/sub/zip เป็น "ชื่อไทย" เหมือนเดิมเสมอ
 *   รหัส (provinceCode/districtCode/subdistrictCode) เป็นของเพิ่ม โค้ดเก่าไม่รู้จักก็ข้ามไป
 */
(function (global) {
  'use strict';

  var DATA = null;
  var idx = null;
  var loading = null;

  // ── ชื่อจังหวัดที่คนเขียนต่างจากทางการ ──
  var PROV_ALIAS = {
    'กรุงเทพฯ': 'กรุงเทพมหานคร', 'กรุงเทพ': 'กรุงเทพมหานคร',
    'กทม.': 'กรุงเทพมหานคร', 'กทม': 'กรุงเทพมหานคร',
    'กรุงเทพฯ.': 'กรุงเทพมหานคร', 'กรุงเทพมหานครฯ': 'กรุงเทพมหานคร',
    'อยุธยา': 'พระนครศรีอยุธยา', 'โคราช': 'นครราชสีมา',
    'ศรีษะเกษ': 'ศรีสะเกษ', 'สีสะเกษ': 'ศรีสะเกษ',
    'หนองบัวลําภู': 'หนองบัวลำภู', 'บุรีรัมย': 'บุรีรัมย์',
    'ลําปาง': 'ลำปาง', 'ลําพูน': 'ลำพูน', 'กําแพงเพชร': 'กำแพงเพชร'
  };

  // ── ชื่ออำเภอ/เขตที่สะกดต่างจากทางการ ──
  var DIST_ALIAS = {
    'ธัญญบุรี': 'ธัญบุรี', 'ธัญบุุรี': 'ธัญบุรี',
    'เมืองฯ': 'เมือง', 'พระประแดง': 'พระประแดง'
  };

  var PREFIX = ['จังหวัด', 'จ.', 'อำเภอ', 'อ.', 'เขต', 'ตำบล', 'ต.', 'แขวง'];

  function clean(s) {
    s = (s == null ? '' : String(s)).trim().replace(/\s+/g, ' ');
    for (var i = 0; i < PREFIX.length; i++) {
      if (s.indexOf(PREFIX[i]) === 0) { s = s.slice(PREFIX[i].length).trim(); break; }
    }
    return s;
  }

  function buildIndex(d) {
    var ix = {
      provByName: {}, provByCode: {},
      distByProv: {}, distByCode: {},
      subByDist: {}, subByCode: {},
      bangkok: d.bangkokProvinceCode
    };
    d.provinces.forEach(function (p) {
      ix.provByName[p[1]] = p[0];
      ix.provByCode[p[0]] = p[1];
    });
    d.districts.forEach(function (x) {
      (ix.distByProv[x[1]] = ix.distByProv[x[1]] || {})[x[2]] = x[0];
      ix.distByCode[x[0]] = { name: x[2], provinceCode: x[1] };
    });
    d.subdistricts.forEach(function (x) {
      (ix.subByDist[x[1]] = ix.subByDist[x[1]] || {})[x[2]] = { code: x[0], zip: x[3] };
      ix.subByCode[x[0]] = { name: x[2], districtCode: x[1], zip: x[3] };
    });
    return ix;
  }

  /** โหลดไฟล์ข้อมูล (เรียกซ้ำได้ โหลดจริงครั้งเดียว) */
  function load(url) {
    if (DATA) return Promise.resolve(DATA);
    if (loading) return loading;
    loading = fetch(url || 'data/thailand-address.json')
      .then(function (r) {
        if (!r.ok) throw new Error('โหลดข้อมูลที่อยู่ไม่สำเร็จ (HTTP ' + r.status + ')');
        return r.json();
      })
      .then(function (d) { DATA = d; idx = buildIndex(d); return d; });
    return loading;
  }

  function ready() { return !!DATA; }
  function isBangkok(provinceCode) { return String(provinceCode) === String(idx.bangkok); }

  /** คำเรียกหน่วยการปกครอง — กรุงเทพใช้ เขต/แขวง ที่อื่นใช้ อำเภอ/ตำบล */
  function labels(provinceCode) {
    return isBangkok(provinceCode)
      ? { district: 'เขต', subdistrict: 'แขวง' }
      : { district: 'อำเภอ', subdistrict: 'ตำบล' };
  }

  function provinces() {
    return DATA.provinces.map(function (p) { return { code: p[0], name: p[1] }; });
  }
  function districts(provinceCode) {
    if (!provinceCode) return [];
    return DATA.districts
      .filter(function (x) { return x[1] === String(provinceCode); })
      .map(function (x) { return { code: x[0], name: x[2] }; });
  }
  function subdistricts(districtCode) {
    if (!districtCode) return [];
    return DATA.subdistricts
      .filter(function (x) { return x[1] === String(districtCode); })
      .map(function (x) { return { code: x[0], name: x[2], zip: x[3] }; });
  }

  function zipOf(subdistrictCode) {
    var s = idx.subByCode[String(subdistrictCode)];
    return s ? s.zip : '';
  }

  /**
   * แปลงที่อยู่เดิม -> ชื่อทางการ + รหัส
   * คืน { provinceCode, districtCode, subdistrictCode, prov, dist, sub, zip,
   *       changes: [{field, from, to, reason}], unresolved: ['sub', ...] }
   * ถ้าจับคู่ไม่ได้ จะคืนค่าเดิมไว้ (ไม่ทำข้อมูลหาย) และใส่ชื่อ field ใน unresolved
   */
  function normalize(addr) {
    addr = addr || {};
    var out = {
      provinceCode: null, districtCode: null, subdistrictCode: null,
      prov: clean(addr.prov), dist: clean(addr.dist), sub: clean(addr.sub),
      zip: (addr.zip == null ? '' : String(addr.zip)).trim(),
      changes: [], unresolved: []
    };

    // ── จังหวัด ──
    var pRaw = clean(addr.prov);
    var pName = PROV_ALIAS[pRaw] || pRaw;
    var pCode = idx.provByName[pName];
    if (pCode) {
      out.provinceCode = pCode;
      out.prov = pName;
      if (pName !== pRaw) out.changes.push({ field: 'prov', from: addr.prov, to: pName, reason: 'ชื่อทางการ' });
    } else {
      out.unresolved.push('prov');
      return out;   // ไม่รู้จังหวัด ไปต่อไม่ได้
    }

    // ── อำเภอ / เขต ──
    var dRaw = clean(addr.dist);
    var dName = DIST_ALIAS[dRaw] || dRaw;
    var table = idx.distByProv[pCode] || {};
    var dCode = table[dName];

    if (!dCode && (dName === 'เมือง' || dName === 'เมืองฯ')) {
      // "เมือง" -> "เมือง<จังหวัด>"
      var guess = 'เมือง' + pName;
      if (table[guess]) { dCode = table[guess]; dName = guess; }
      else {
        for (var k in table) {
          if (k.indexOf('เมือง') === 0) { dCode = table[k]; dName = k; break; }
        }
      }
    }
    if (!dCode) {
      var dh = Object.keys(table).filter(function (n) {
        return n.indexOf(dName) === 0 || dName.indexOf(n) === 0;
      });
      if (dh.length === 1) { dCode = table[dh[0]]; dName = dh[0]; }
    }

    if (dCode) {
      out.districtCode = dCode;
      out.dist = dName;
      if (dName !== clean(addr.dist)) out.changes.push({ field: 'dist', from: addr.dist, to: dName, reason: 'ชื่อทางการ' });
    } else {
      out.unresolved.push('dist');
      return out;
    }

    // ── ตำบล / แขวง ──
    var sRaw = clean(addr.sub);
    var stab = idx.subByDist[dCode] || {};
    var hit = stab[sRaw];

    if (!hit) {
      var sh = Object.keys(stab).filter(function (n) {
        return n.indexOf(sRaw) === 0 || sRaw.indexOf(n) === 0;
      });
      if (sh.length === 1) { hit = stab[sh[0]]; sRaw = sh[0]; }
      else if (sh.length > 1) {
        // ตำบลถูกแบ่งภายหลัง เช่น บางนา -> บางนาเหนือ/บางนาใต้
        // ถ้าทุกตัวเลือกรหัสไปรษณีย์เดียวกัน เติมรหัสให้ก่อน เหลือให้คนเลือกชื่อ
        var zips = {};
        sh.forEach(function (n) { zips[stab[n].zip] = 1; });
        var zl = Object.keys(zips);
        if (zl.length === 1) {
          if (out.zip !== zl[0]) out.changes.push({ field: 'zip', from: addr.zip, to: zl[0], reason: 'ตามตำบลที่เลือก' });
          out.zip = zl[0];
        }
        out.unresolved.push('sub');
        out.subChoices = sh;   // ให้หน้าเว็บเอาไปให้คนเลือก
        return out;
      }
    }

    if (hit) {
      out.subdistrictCode = hit.code;
      if (sRaw !== clean(addr.sub)) out.changes.push({ field: 'sub', from: addr.sub, to: sRaw, reason: 'ชื่อทางการ' });
      out.sub = sRaw;
      if (out.zip !== hit.zip) {
        out.changes.push({ field: 'zip', from: addr.zip, to: hit.zip, reason: 'รหัสไปรษณีย์ที่ถูกต้องของตำบลนี้' });
        out.zip = hit.zip;
      }
    } else {
      out.unresolved.push('sub');
    }
    return out;
  }

  /** สร้างคำค้นสำหรับหาพิกัด — กรุงเทพต้องใช้ แขวง/เขต ไม่ใช่ ตำบล/อำเภอ */
  function geoQuery(a) {
    if (!a || !a.provinceCode) return '';
    var L = labels(a.provinceCode);
    var parts = [];
    if (a.sub)  parts.push(L.subdistrict + a.sub);
    if (a.dist) parts.push(L.district + a.dist);
    if (a.prov) parts.push(a.prov);
    return parts.join(' ');
  }

  /**
   * แยกที่อยู่บรรทัดเดียวออกเป็น เลขที่ / ซอย / ถนน
   * ใช้วิธีตัดตามตำแหน่งคำสำคัญ แม่นกว่าการจับทีละชิ้น
   * (เช่น "ถนนมิตรภาพ - หนองคาย" และ "ซอยสุขุมวิท 48/3" จะไม่ขาด)
   * คืน null ถ้าไม่มีอะไรให้แยก
   */
  function splitAddressLine(line) {
    var s = (line == null ? '' : String(line)).trim().replace(/\s+/g, ' ');
    if (!s) return null;

    var KEYS = [{ f: 'soi', w: ['ซอย', 'ซ.'] }, { f: 'road', w: ['ถนน', 'ถ.'] }];
    var marks = [];
    KEYS.forEach(function (k) {
      for (var i = 0; i < k.w.length; i++) {
        var p = s.indexOf(k.w[i]);
        if (p >= 0) { marks.push({ pos: p, field: k.f }); break; }
      }
    });
    if (!marks.length) return null;
    marks.sort(function (a, b) { return a.pos - b.pos; });

    var trim = function (x) { return x.replace(/^[\s,\-]+|[\s,\-]+$/g, ''); };
    var out = { no: trim(s.slice(0, marks[0].pos)), soi: '', road: '' };
    for (var i = 0; i < marks.length; i++) {
      var end = (i + 1 < marks.length) ? marks[i + 1].pos : s.length;
      out[marks[i].field] = trim(s.slice(marks[i].pos, end));
    }
    if (!out.soi && !out.road) return null;
    return out;
  }

  /** ข้อมูลที่อยู่ที่พร้อมบันทึก (ชื่อเดิม + รหัสใหม่) */
  function toSaved(a) {
    return {
      sub: a.sub || '', dist: a.dist || '', prov: a.prov || '', zip: a.zip || '',
      subdistrictCode: a.subdistrictCode || null,
      districtCode: a.districtCode || null,
      provinceCode: a.provinceCode || null
    };
  }

  global.ThaiAddress = {
    load: load, ready: ready,
    provinces: provinces, districts: districts, subdistricts: subdistricts,
    normalize: normalize, geoQuery: geoQuery, toSaved: toSaved,
    splitAddressLine: splitAddressLine,
    zipOf: zipOf, labels: labels, isBangkok: isBangkok, clean: clean
  };
})(window);
