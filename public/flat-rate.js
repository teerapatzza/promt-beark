/* ══════════════════════════════════════════════════════════════════
   ค่าพาหนะแบบเหมาจ่าย — ตามบัญชี ๘ ข้อ ๕
   ──────────────────────────────────────────────────────────────────
   ระเบียบให้เลือกได้สองวิธีสำหรับรถส่วนตัว และห้ามใช้ทั้งสองวิธีในช่วงเดียวกัน
     ข้อ ๔  ค่าชดเชยเชื้อเพลิง   คิดตามระยะทางจริง × อัตราต่อกิโลเมตร
     ข้อ ๕  ค่าพาหนะเหมาจ่าย     คิดเป็นก้อนตามช่วงระยะทาง รวมค่าทางด่วนแล้ว

   กติกาที่ยืนยันกับเจ้าของระบบเมื่อ 9 ต.ค. 2569
     - คิดทีละเที่ยว (ขา) ไม่ใช่รวมไป-กลับแล้วค่อยเทียบช่วง
       ไป 15 กม. ได้ 250 · กลับ 25 กม. ได้ 350 → รวม 600
     - อัตรานี้รวมค่าทางด่วนแล้ว ฟอร์มจึงล็อกช่องค่าทางด่วนไว้
     - ระยะเกินเพดาน (ระเบียบคุมถึง 200 กม.) ใช้เหมาจ่ายไม่ได้ ต้องกลับไปคิดตามระยะจริง

   ไฟล์นี้ถูกใช้ทั้งฝั่งเบราว์เซอร์และฝั่งเซิร์ฟเวอร์ จงใจให้มีที่เดียว
   เพราะกฎที่เขียนไว้สองที่เคยทำให้สองฝั่งตัดสินไม่ตรงกันมาแล้ว
   (25 ก.ย. 2569 เรื่องไฟล์แนบ — หน้าเว็บผ่าน แต่เซิร์ฟเวอร์ตีกลับ)
   ══════════════════════════════════════════════════════════════════ */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.FlatRate = factory();
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    /** ค่าตั้งต้นตามบัญชี ๘ ใช้เมื่อแอดมินยังไม่ได้ตั้งค่าของหมวดนั้น */
    var DEFAULT = {
        enabled: false,
        maxKm: 200,
        outsideMetro: 1200,
        bands: [
            { upTo: 10.99, amount: 150 },
            { upTo: 20.99, amount: 250 },
            { upTo: 30.99, amount: 350 },
            { upTo: 40.99, amount: 450 },
            { upTo: 50.99, amount: 550 },
            { upTo: 60.99, amount: 650 },
            { upTo: null,  amount: 750 }     // upTo = null คือช่วงสุดท้าย ไม่มีขอบบน
        ]
    };

    function num(v) { var n = parseFloat(v); return isFinite(n) ? n : 0; }

    /** รวมค่าที่แอดมินตั้งไว้เข้ากับค่าตั้งต้น ให้ได้ชุดที่ครบเสมอ */
    function normalize(cfg) {
        var c = cfg || {};
        var bands = Array.isArray(c.bands) && c.bands.length ? c.bands : DEFAULT.bands;
        return {
            enabled:      c.enabled === true,
            maxKm:        c.maxKm        != null ? num(c.maxKm)        : DEFAULT.maxKm,
            outsideMetro: c.outsideMetro != null ? num(c.outsideMetro) : DEFAULT.outsideMetro,
            // เรียงจากช่วงแคบไปกว้าง แล้วดันช่วงที่ไม่มีขอบบนไปท้ายสุดเสมอ
            bands: bands.slice().sort(function (a, b) {
                if (a.upTo == null) return 1;
                if (b.upTo == null) return -1;
                return num(a.upTo) - num(b.upTo);
            }).map(function (b) {
                return { upTo: b.upTo == null || b.upTo === '' ? null : num(b.upTo), amount: num(b.amount) };
            })
        };
    }

    /**
     * คิดเงินเหมาจ่ายของหนึ่งเที่ยว
     * @param {number}  km        ระยะทางของเที่ยวนั้น
     * @param {object}  cfg       ค่าที่แอดมินตั้งไว้
     * @param {boolean} inMetro   อยู่ในเขต กทม.ปริมณฑลหรือไม่
     * @returns {{amount:number, label:string, ok:boolean, why:string}}
     */
    function legAmount(km, cfg, inMetro) {
        var c = normalize(cfg);
        var d = num(km);

        if (!c.enabled)    return { amount: 0, label: '', ok: false, why: 'หมวดนี้ยังไม่ได้เปิดใช้เหมาจ่าย' };
        if (d <= 0)        return { amount: 0, label: '', ok: false, why: 'ยังไม่มีระยะทาง' };
        if (d > c.maxKm)   return { amount: 0, label: '', ok: false,
                                    why: 'ระยะทาง ' + d + ' กม. เกิน ' + c.maxKm + ' กม. ที่ระเบียบกำหนด' };

        // นอกเขต กทม.ปริมณฑล ระเบียบให้เหมาจ่ายก้อนเดียว ไม่แบ่งช่วง
        if (inMetro === false)
            return { amount: c.outsideMetro, ok: true, why: '',
                     label: 'เหมาจ่ายนอกเขต กทม.ปริมณฑล' };

        for (var i = 0; i < c.bands.length; i++) {
            var b = c.bands[i];
            if (b.upTo == null || d <= b.upTo) {
                var from = i === 0 ? 0 : (num(c.bands[i - 1].upTo) + 0.01);
                return { amount: b.amount, ok: true, why: '',
                         label: b.upTo == null
                             ? 'ระยะทางตั้งแต่ ' + from.toFixed(2) + ' กม. ขึ้นไป'
                             : 'ระยะทาง ' + from.toFixed(2) + ' - ' + num(b.upTo).toFixed(2) + ' กม.' };
            }
        }
        return { amount: 0, label: '', ok: false, why: 'ไม่พบช่วงระยะทางที่ตรงกับ ' + d + ' กม.' };
    }

    /**
     * คิดเงินเหมาจ่ายของทั้งใบ แยกทีละเที่ยวตามที่ระเบียบกำหนด
     * @param {{distOut:number, distRet:number, carType:string}} trip
     * @param {object}  cfg
     * @param {boolean} inMetro
     * @returns {{total:number, legs:Array, ok:boolean, why:string}}
     */
    function tripTotal(trip, cfg, inMetro) {
        var t = trip || {};
        var legs = [];
        var want = t.carType || 'ไป-กลับ';

        if (want === 'ขาไป' || want === 'ไป-กลับ')
            legs.push({ dir: 'ขาไป',   km: num(t.distOut) });
        if (want === 'ขากลับ' || want === 'ไป-กลับ')
            legs.push({ dir: 'ขากลับ', km: num(t.distRet) });

        var total = 0, bad = '';
        legs.forEach(function (l) {
            var r = legAmount(l.km, cfg, inMetro);
            l.amount = r.amount; l.label = r.label; l.ok = r.ok; l.why = r.why;
            if (r.ok) total += r.amount;
            else if (!bad) bad = r.why;
        });

        return { total: total, legs: legs, ok: legs.length > 0 && !bad, why: bad };
    }

    return {
        DEFAULT: DEFAULT,
        normalize: normalize,
        legAmount: legAmount,
        tripTotal: tripTotal
    };
});
