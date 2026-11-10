/* ตัวแปลงขาเดินทาง — ที่เดียวในระบบที่ตอบว่า "ใบนี้มีกี่ขา"
 *
 * เหตุที่ต้องมี — 10 พ.ย. 2569 เจ้าของงานต้องการเบิกในใบเดียวว่า
 *   วันที่ 9  บ้าน -> รพ. -> บ้าน
 *   วันที่ 10 บ้าน -> รพ. -> บ้าน      รวม 4 ขา
 * แต่โครงสร้างเดิมเก็บได้แค่ 2 ขา (fromGeo/toGeo + distOut/distRet)
 *
 * ใบเก่าทุกใบในฐานข้อมูลเป็นโครงสร้างเดิม ถ้าแปลงย้อนหลังแล้วพลาด
 * เอกสารที่ส่งการเงินไปแล้วจะเปลี่ยนยอด จึงเลือก "อ่านผ่านตัวแปลง" แทนการย้ายข้อมูล
 * เทสต์นี้จึงเน้นที่สุดว่า **ใบเก่าต้องให้ผลเหมือนเดิมทุกตัวอักษร**
 *
 * รัน: node scripts/test-travel-legs.mjs
 */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const TravelLegs = require('../public/travel-legs.js');

let pass = 0, fail = 0;
const ok = (name, cond, got) => {
    if (cond) { pass++; console.log('  ผ่าน  ' + name); }
    else { fail++; console.log('  ตก    ' + name
        + (got !== undefined ? '\n         ได้ ' + JSON.stringify(got) : '')); }
};

/* ── 1. ใบเก่าแบบปกติ: ไป-กลับทางเดิม ── */
{
    const legs = TravelLegs.legsOf({
        startDate: '2026-11-09', endDate: '2026-11-09',
        from: 'บ้าน', to: 'โรงพยาบาล',
        fromGeo: { lat: 13.6, lng: 100.5 }, toGeo: { lat: 13.7, lng: 100.6 },
        routePath: [[13.6, 100.5], [13.7, 100.6]],
        distOut: '12', distRet: '12'
    });
    ok('ใบเก่าได้ 2 ขา', legs.length === 2, legs.length);
    ok('ขาไปถูก', legs[0].dir === 'ขาไป' && legs[0].from === 'บ้าน'
        && legs[0].to === 'โรงพยาบาล' && legs[0].km === 12, legs[0]);
    ok('ขากลับสลับต้นทางปลายทาง', legs[1].dir === 'ขากลับ'
        && legs[1].from === 'โรงพยาบาล' && legs[1].to === 'บ้าน', legs[1]);
    ok('ขากลับใช้หมุดสลับกัน',
        legs[1].fromGeo && legs[1].fromGeo.lat === 13.7
        && legs[1].toGeo && legs[1].toGeo.lat === 13.6, legs[1]);
    ok('ขากลับใช้เส้นทางย้อนกลับ',
        JSON.stringify(legs[1].path) === JSON.stringify([[13.7, 100.6], [13.6, 100.5]]), legs[1].path);
    ok('เส้นทางขาไปไม่ถูกกลับหัวไปด้วย',
        JSON.stringify(legs[0].path) === JSON.stringify([[13.6, 100.5], [13.7, 100.6]]), legs[0].path);
}

/* ── 2. ใบเก่ากรณีพิเศษ: ขากลับไปคนละที่ ── */
{
    const legs = TravelLegs.legsOf({
        startDate: '2026-11-09', endDate: '2026-11-10',
        from: 'บ้าน', to: 'โรงพยาบาล',
        fromGeo: { lat: 13.6, lng: 100.5 }, toGeo: { lat: 13.7, lng: 100.6 },
        returnDifferent: true,
        returnFrom: 'โรงแรม', returnFromGeo: { lat: 13.8, lng: 100.7 },
        returnTo: 'ที่ทำงาน', returnGeo: { lat: 13.9, lng: 100.8 },
        returnPath: [[13.8, 100.7], [13.9, 100.8]],
        distOut: '12', distRet: '20'
    });
    ok('กรณีพิเศษ: ขากลับใช้จุดที่ระบุเอง',
        legs[1].from === 'โรงแรม' && legs[1].to === 'ที่ทำงาน', legs[1]);
    ok('กรณีพิเศษ: ขากลับใช้ returnPath ไม่ใช่เส้นทางย้อนกลับ',
        JSON.stringify(legs[1].path) === JSON.stringify([[13.8, 100.7], [13.9, 100.8]]), legs[1].path);
    ok('ขากลับใช้วันกลับถึง', legs[1].date === '2026-11-10', legs[1].date);
}

/* ── 2ข. ติ๊ก "ไปคนละที่" แต่ไม่ได้ปักหมุด ต้องถอยไปใช้ของขาไป ──
   ตรงกับ mapLegsOf ที่เช็ค isMapGeo ก่อนใช้ ไม่ได้เช็คแค่ธง returnDifferent */
{
    const legs = TravelLegs.legsOf({
        from: 'บ้าน', to: 'โรงพยาบาล',
        fromGeo: { lat: 13.6, lng: 100.5 }, toGeo: { lat: 13.7, lng: 100.6 },
        returnDifferent: true, returnFrom: '', returnTo: '',
        returnFromGeo: null, returnGeo: null,
        routePath: [[13.6, 100.5], [13.7, 100.6]]
    });
    ok('ติ๊กไปคนละที่แต่ไม่มีหมุด ยังกลับทางเดิม',
        legs[1].from === 'โรงพยาบาล' && legs[1].to === 'บ้าน', legs[1]);
    ok('ติ๊กไปคนละที่แต่ไม่มีหมุด ใช้เส้นทางย้อนกลับ',
        JSON.stringify(legs[1].path) === JSON.stringify([[13.7, 100.6], [13.6, 100.5]]), legs[1].path);
}

/* ── 3. ใบเก่าที่ไม่ได้กรอกวันกลับ ต้องถอยไปใช้วันไป ── */
{
    const legs = TravelLegs.legsOf({ startDate: '2026-11-09', endDate: '', from: 'ก', to: 'ข' });
    ok('ไม่มีวันกลับ ใช้วันไปแทน', legs[1].date === '2026-11-09', legs[1].date);
}

/* ── 4. ใบใหม่ที่มี legs อยู่แล้ว ต้องใช้ตัวนั้น ไม่สังเคราะห์ทับ ── */
{
    const mine = [
        { dir: 'ขาไป',   date: '2026-11-09', from: 'บ้าน', to: 'รพ.', km: 12 },
        { dir: 'ขากลับ', date: '2026-11-09', from: 'รพ.', to: 'บ้าน', km: 12 },
        { dir: 'ขาไป',   date: '2026-11-10', from: 'บ้าน', to: 'รพ.', km: 12 },
        { dir: 'ขากลับ', date: '2026-11-10', from: 'รพ.', to: 'บ้าน', km: 12 }
    ];
    const legs = TravelLegs.legsOf({ legs: mine, distOut: '999', distRet: '999' });
    ok('ใบใหม่ได้ 4 ขา', legs.length === 4, legs.length);
    ok('ใบใหม่ไม่เอา distOut เดิมมาปน', legs[0].km === 12, legs[0].km);
    ok('ขาที่ 3 เป็นวันที่ 10', legs[2].date === '2026-11-10', legs[2].date);
}

/* ── 5. ใบที่ไม่มีข้อมูลเดินทางเลย ต้องไม่พัง ── */
{
    ok('travel = null ไม่พัง', Array.isArray(TravelLegs.legsOf(null)));
    ok('travel = {} ไม่พัง',   Array.isArray(TravelLegs.legsOf({})));
    ok('legs = [] ว่าง ถอยไปใช้ฟิลด์เดิม', TravelLegs.legsOf({ legs: [], distOut: '5' }).length === 2);
}

/* ── 6. ระยะทางรวม ต้องเท่าผลรวมของทุกขา ── */
{
    ok('ใบเก่า: รวม = distOut + distRet',
        TravelLegs.totalKm({ distOut: '12', distRet: '20' }) === 32,
        TravelLegs.totalKm({ distOut: '12', distRet: '20' }));
    ok('ใบใหม่: รวมทุกขา',
        TravelLegs.totalKm({ legs: [{ km: 12 }, { km: 12 }, { km: 12 }, { km: 12 }] }) === 48);
}

/* ── 7. ขาเดินทางต้องใช้ชื่อคีย์ชุดเดียวกับรายการ Taxi ──
   เจ้าของงานสั่ง 10 พ.ย. 2569 ว่าค่าน้ำมันต้องใช้แนวเดียวกับ Taxi
   ผู้ใช้จะได้เห็นรูปแบบเดียวทั้งหน้า ไม่ต้องเรียนรู้สองแบบ
   taxiLegRowsOf() ใน history.html คืน { dir, date, from, to, fromGeo, toGeo, amount } */
{
    const l = TravelLegs.legsOf({ from: 'ก', to: 'ข' })[0];
    ['dir', 'date', 'from', 'to', 'fromGeo', 'toGeo'].forEach(k => {
        ok('ขามีคีย์ "' + k + '" เหมือนรายการ Taxi', k in l, Object.keys(l));
    });
}

/* ── 8. เทียบกับกติกาจริงในไฟล์ ไม่ใช่ตรรกะที่คัดลอกมาเขียนใหม่ ──
   ถ้ามีคนแก้กติกาขากลับใน history.html เทสต์นี้ต้องตกทันที จะได้รู้ว่าสองที่หลุดกัน */
{
    const hist = readFileSync(new URL('../public/history.html', import.meta.url), 'utf8');
    ok('history.html ยังใช้กติกา returnDifferent เดิมอยู่',
        /const rd = !!tr\.returnDifferent;/.test(hist)
        && /isMapGeo\(tr\.returnFromGeo\) \? tr\.returnFromGeo : null/.test(hist));
}

console.log(`\nผ่าน ${pass}  ตก ${fail}`);
process.exit(fail ? 1 : 0);
