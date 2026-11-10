/* ══════════ ขาเดินทางของใบเบิก ══════════
   ที่เดียวในระบบที่ตอบคำถามว่า "ใบนี้มีกี่ขา และแต่ละขาคืออะไร"

   ทำไมต้องมี — 10 พ.ย. 2569 เจ้าของงานต้องการเบิกในใบเดียวว่า
   วันที่ 9 บ้าน->รพ.->บ้าน และวันที่ 10 บ้าน->รพ.->บ้าน รวม 4 ขา
   แต่โครงสร้างเดิมเก็บได้แค่ 2 ขา (fromGeo/toGeo + distOut/distRet)

   ทำไมไม่ย้ายข้อมูลเก่า — ใบเก่าทุกใบในฐานข้อมูลเป็นโครงสร้างเดิม
   ถ้าแปลงย้อนหลังแล้วแปลงผิด เอกสารที่ส่งการเงินไปแล้วจะเปลี่ยนยอด
   จึงเลือกวิธี "อ่านผ่านตัวแปลง" แทน ฐานข้อมูลไม่ต้องแตะเลยแม้แต่แถวเดียว

   รูปของขาใช้ชื่อคีย์ชุดเดียวกับรายการ Taxi ที่ taxiLegRowsOf() คืนมา
   (dir, date, from, to, fromGeo, toGeo) เพราะเจ้าของงานสั่งว่าค่าน้ำมัน
   ต้องใช้แนวเดียวกับ Taxi ผู้ใช้จะได้เห็นรูปแบบเดียวทั้งหน้า ไม่ต้องเรียนรู้สองแบบ

   ใช้ร่วมกันทั้งหน้าเว็บและ backend แบบเดียวกับ public/metro-area.js
     หน้าเว็บ:  <script src="travel-legs.js"></script>  แล้วเรียก TravelLegs.legsOf(...)
     backend:   const TravelLegs = require('../public/travel-legs.js');            */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.TravelLegs = factory();
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    function num(v) { var n = parseFloat(v); return isFinite(n) ? n : 0; }

    /* หมุดที่ใช้งานได้จริงต้องมีพิกัดเป็นตัวเลข
       ของเดิมใน mapLegsOf เช็คด้วย isMapGeo ก่อนใช้ ไม่ได้ดูแค่ธง returnDifferent
       ใบที่ติ๊ก "ไปคนละที่" ไว้แต่ยังไม่ได้ปักหมุด จึงต้องถอยไปใช้ของขาไปเหมือนเดิม */
    function hasGeo(g) {
        return !!(g && isFinite(parseFloat(g.lat)) && isFinite(parseFloat(g.lng)));
    }

    /* เส้นทางขากลับที่กลับทางเดิม = เส้นทางขาไปกลับหัว
       ต้องคัดลอกก่อน reverse ไม่งั้นไปกลับหัวตัวเดียวกับที่ขาไปถืออยู่ */
    function reversePath(p) {
        return (Array.isArray(p) && p.length > 1) ? p.slice().reverse() : null;
    }

    /* เติมคีย์ที่ขาดให้ครบ ผู้เรียกจะได้ไม่ต้องเช็ค undefined ทุกจุด */
    function normalize(l) {
        var x = l || {};
        return {
            dir:     x.dir || 'ขาไป',
            date:    x.date || '',
            from:    x.from || '',
            to:      x.to || '',
            fromGeo: x.fromGeo || null,
            toGeo:   x.toGeo || null,
            km:      num(x.km),
            path:    Array.isArray(x.path) ? x.path : null,
            route:   x.route || null
        };
    }

    /**
     * ขาเดินทางทั้งหมดของใบนี้ เรียงตามลำดับที่กรอก
     * @param {object} travel  ค่าของ metadata._travel
     * @returns {Array<{dir,date,from,to,fromGeo,toGeo,km,path,route}>}
     */
    function legsOf(travel) {
        var t = travel || {};

        // ใบใหม่เก็บขาไว้เอง ใช้ตัวนั้นตรง ๆ ห้ามเอาฟิลด์เก่ามาปน
        if (Array.isArray(t.legs) && t.legs.length) return t.legs.map(normalize);

        // ── ใบเก่า: สังเคราะห์ 2 ขาให้ตรงกับที่เอกสารเดิมถือปฏิบัติทุกประการ ──
        var out = normalize({
            dir: 'ขาไป', date: t.startDate || '',
            from: t.from, to: t.to,
            fromGeo: t.fromGeo, toGeo: t.toGeo,
            km: t.distOut, path: t.routePath, route: t.route
        });

        /* ขากลับระบุจุดเองได้เฉพาะตอนติ๊ก "ไปคนละที่" ไว้ และต้องปักหมุดจริงด้วย
           ไม่ได้ระบุ = ออกจากจุดหมายขาไป กลับมาที่จุดเริ่มต้น ใช้เส้นทางเดิมกลับหัว
           ตรงกับ mapLegsOf() ใน history.html ทุกบรรทัด */
        var rd = !!t.returnDifferent;
        var hasRF = rd && hasGeo(t.returnFromGeo);
        var hasRT = rd && hasGeo(t.returnGeo);
        var ret = normalize({
            dir: 'ขากลับ',
            date: t.endDate || t.startDate || '',
            from: hasRF ? (t.returnFrom || '') : (t.to || ''),
            to:   hasRT ? (t.returnTo   || '') : (t.from || ''),
            fromGeo: hasRF ? t.returnFromGeo : (t.toGeo || null),
            toGeo:   hasRT ? t.returnGeo     : (t.fromGeo || null),
            km: t.distRet,
            path:  (hasRF || hasRT) ? t.returnPath  : reversePath(t.routePath),
            route: (hasRF || hasRT) ? t.returnRoute : t.route
        });

        return [out, ret];
    }

    /** ระยะทางรวมของใบนี้ ใช้แทน distOut + distRet ที่กระจายอยู่หลายที่ */
    function totalKm(travel) {
        return legsOf(travel).reduce(function (s, l) { return s + l.km; }, 0);
    }

    /** มีขาไหนไปทางนั้นบ้างไหม เช่น hasDir(t, 'ขากลับ') */
    function hasDir(travel, dir) {
        return legsOf(travel).some(function (l) { return l.dir === dir; });
    }

    return { legsOf: legsOf, totalKm: totalKm, hasDir: hasDir, hasGeo: hasGeo };
});
