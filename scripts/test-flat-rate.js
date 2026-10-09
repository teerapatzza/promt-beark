// ตรวจตัวคำนวณค่าพาหนะเหมาจ่าย ตามบัญชี ๘ ข้อ ๕
//
// กติกาที่เจ้าของระบบยืนยันเมื่อ 9 ต.ค. 2569
//   - คิดทีละเที่ยว ไม่ใช่รวมไป-กลับแล้วค่อยเทียบช่วง
//     ไป 15 กม. ได้ 250 · กลับ 25 กม. ได้ 350 → รวม 600
//   - นอกเขต กทม.ปริมณฑล เหมาจ่ายก้อนเดียว ไม่แบ่งช่วง
//   - เกินเพดานที่ระเบียบคุมถึง ใช้เหมาจ่ายไม่ได้ ต้องกลับไปคิดตามระยะจริง
//
//   node scripts/test-flat-rate.js
const path = require('path');
const FlatRate = require(path.join(__dirname, '..', 'public', 'flat-rate'));

let pass = 0, fail = 0;
const ok = (n, c, d = '') => { c ? pass++ : fail++;
  console.log((c ? '  ผ่าน  ' : '  ตก    ') + n + (d ? '  -> ' + d : '')); };

// ค่าตามตารางในระเบียบ เปิดใช้งาน
const CFG = Object.assign({}, FlatRate.DEFAULT, { enabled: true });

console.log('═══ 1. ช่วงระยะทางตามตาราง (ในเขต กทม.ปริมณฑล) ═══');
// ขอบของทุกช่วง ทั้งค่าต่ำสุด ค่ากลาง และค่าสูงสุดที่ยังอยู่ในช่วง
[[0.1, 150], [10.99, 150],
 [11, 250], [15, 250], [20.99, 250],
 [21, 350], [25, 350], [30.99, 350],
 [31, 450], [40.99, 450],
 [41, 550], [50.99, 550],
 [51, 650], [60.99, 650],
 [61, 750], [150, 750], [200, 750]
].forEach(([km, want]) => {
  const r = FlatRate.legAmount(km, CFG, true);
  ok(String(km).padStart(6) + ' กม. → ' + String(want).padStart(4) + ' บาท',
     r.ok && r.amount === want, r.ok ? r.amount + ' บาท (' + r.label + ')' : r.why);
});

console.log('');
console.log('═══ 2. ตัวอย่างที่เจ้าของระบบยกมา — ไป 15 กลับ 25 ต้องได้ 600 ═══');
const t1 = FlatRate.tripTotal({ distOut: 15, distRet: 25, carType: 'ไป-กลับ' }, CFG, true);
ok('รวมได้ 600 บาท', t1.ok && t1.total === 600, t1.total + ' บาท');
ok('ขาไป 15 กม. ได้ 250', t1.legs[0].amount === 250, t1.legs[0].amount + '');
ok('ขากลับ 25 กม. ได้ 350', t1.legs[1].amount === 350, t1.legs[1].amount + '');
ok('แยกเป็นสองเที่ยว ไม่ใช่รวมระยะแล้วเทียบช่วงเดียว',
   t1.legs.length === 2, t1.legs.length + ' เที่ยว');
// ถ้าคิดผิดเป็นรวมระยะ 40 กม. จะได้ 450 ซึ่งต่างกัน 150 บาท
ok('ไม่ได้คิดแบบรวมระยะ (40 กม. = 450) ซึ่งจะผิด', t1.total !== 450);

console.log('');
console.log('═══ 3. เบิกขาเดียว ═══');
const go = FlatRate.tripTotal({ distOut: 15, distRet: 25, carType: 'ขาไป' }, CFG, true);
ok('ขาไปอย่างเดียว คิดแค่เที่ยวเดียว', go.total === 250 && go.legs.length === 1, go.total + ' บาท');
const back = FlatRate.tripTotal({ distOut: 15, distRet: 25, carType: 'ขากลับ' }, CFG, true);
ok('ขากลับอย่างเดียว ใช้ระยะของขากลับ', back.total === 350 && back.legs.length === 1, back.total + ' บาท');
ok('ขากลับอย่างเดียว ไม่ไปหยิบระยะขาไปมาคิด', back.legs[0].km === 25, back.legs[0].km + ' กม.');

console.log('');
console.log('═══ 4. นอกเขต กทม.ปริมณฑล — เหมาก้อนเดียว ไม่แบ่งช่วง ═══');
const out1 = FlatRate.legAmount(15, CFG, false);
ok('15 กม. นอกเขต ได้ 1,200 ไม่ใช่ 250', out1.ok && out1.amount === 1200, out1.amount + '');
const out2 = FlatRate.legAmount(180, CFG, false);
ok('180 กม. นอกเขต ก็ยัง 1,200 เท่าเดิม', out2.ok && out2.amount === 1200, out2.amount + '');
const outTrip = FlatRate.tripTotal({ distOut: 150, distRet: 150, carType: 'ไป-กลับ' }, CFG, false);
ok('ไป-กลับนอกเขต คิดสองเที่ยว = 2,400', outTrip.total === 2400, outTrip.total + ' บาท');

console.log('');
console.log('═══ 5. เกินเพดาน 200 กม. ต้องใช้เหมาจ่ายไม่ได้ ═══');
const over = FlatRate.legAmount(201, CFG, true);
ok('201 กม. ถูกปฏิเสธ', over.ok === false, over.why);
ok('บอกเหตุผลที่อ่านรู้เรื่อง', /เกิน 200 กม/.test(over.why), over.why);
ok('ไม่คืนเงินมั่ว ๆ ตอนถูกปฏิเสธ', over.amount === 0);
const overTrip = FlatRate.tripTotal({ distOut: 100, distRet: 250, carType: 'ไป-กลับ' }, CFG, true);
ok('ไป-กลับที่มีขาหนึ่งเกินเพดาน ทั้งใบถือว่าใช้ไม่ได้', overTrip.ok === false, overTrip.why);
ok('200 กม. พอดี ยังใช้ได้', FlatRate.legAmount(200, CFG, true).ok === true);

console.log('');
console.log('═══ 6. หมวดที่ยังไม่เปิดใช้เหมาจ่าย ═══');
ok('ปิดอยู่ → ใช้ไม่ได้ และไม่คิดเงิน',
   FlatRate.legAmount(15, { enabled: false }, true).ok === false);
ok('ไม่ได้ส่งค่าตั้งมาเลย → ถือว่าปิด',
   FlatRate.legAmount(15, null, true).ok === false);

console.log('');
console.log('═══ 7. แอดมินตั้งตารางเอง ═══');
const custom = { enabled: true, maxKm: 100, outsideMetro: 900,
                 bands: [{ upTo: 20, amount: 100 }, { upTo: null, amount: 400 }] };
ok('ใช้ช่วงที่แอดมินตั้ง ไม่ใช่ค่าตั้งต้น',
   FlatRate.legAmount(10, custom, true).amount === 100, FlatRate.legAmount(10, custom, true).amount + '');
ok('ช่วงสุดท้ายที่ไม่มีขอบบน ใช้ได้', FlatRate.legAmount(90, custom, true).amount === 400);
ok('เพดานที่แอดมินตั้ง มีผลจริง', FlatRate.legAmount(101, custom, true).ok === false);
ok('ค่าเหมานอกเขตที่แอดมินตั้ง มีผลจริง',
   FlatRate.legAmount(10, custom, false).amount === 900);
const messy = { enabled: true, bands: [{ upTo: null, amount: 750 }, { upTo: 10, amount: 150 }] };
ok('ตั้งสลับลำดับมา ระบบเรียงให้เองถูกต้อง',
   FlatRate.legAmount(5, messy, true).amount === 150, FlatRate.legAmount(5, messy, true).amount + '');

console.log('');
console.log('═══ 8. ข้อมูลเพี้ยนต้องไม่ทำให้พัง ═══');
ok('ระยะ 0 → ใช้ไม่ได้ ไม่ใช่คิด 150', FlatRate.legAmount(0, CFG, true).ok === false);
ok('ระยะติดลบ → ใช้ไม่ได้', FlatRate.legAmount(-5, CFG, true).ok === false);
ok('ระยะเป็นข้อความ → ใช้ไม่ได้ ไม่พัง', FlatRate.legAmount('ห้าสิบ', CFG, true).ok === false);
ok('ยังไม่รู้ว่าอยู่ในเขตไหม (null) → คิดแบบในเขต',
   FlatRate.legAmount(15, CFG, null).amount === 250);

console.log('');
console.log('══════════════════════════════════════');
console.log('  ผ่าน ' + pass + ' / ' + (pass + fail));
console.log('══════════════════════════════════════');
process.exit(fail ? 1 : 0);
