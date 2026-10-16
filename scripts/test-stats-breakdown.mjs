// ตัวเลขค่าน้ำมันบน Dashboard ต้องตรงกับที่เอกสารพิมพ์จริง
//
// 16 ต.ค. 2569 — costBreakdown() ใน server.js คิดค่าน้ำมันเป็น
//   (distOut + distRet) x fuelRate
// ซึ่งพลาดสองอย่างพร้อมกัน และผิดคนละทาง ยอดรวมเลยเกือบหักล้างกันพอดี
// มองจากยอดรวมจะไม่เห็นว่าผิด ทั้งที่รายใบผิดหนัก
//
//   ๑. ไม่ดู carType  ขาที่ไม่ได้เบิกรถก็ถูกคิดค่าน้ำมัน
//      วัดกับใบจริง 63 ใบ: เกิน 8 ใบ รวม +6,871.70 บาท
//      ตัวหนักสุดคือใบที่ carType = ไม่ระบุ (นั่ง Taxi ล้วน) แต่ dashboard ขึ้นค่าน้ำมันให้
//
//   ๒. ไม่รู้จักเหมาจ่าย  ใบที่เลือกเหมาจ่ายต้องใช้ยอดก้อนที่เก็บไว้ (_flatRate.total)
//      ไม่ใช่คิด ระยะ x อัตรา ใหม่
//      วัดกับใบจริง: ขาด 10 ใบ รวม -7,287.00 บาท
//
// กฎที่ถูกต้องลอกมาจากตัวที่พิมพ์เอกสารจริง public/history.html บรรทัด 694-700
// ซึ่งเป็นยอดที่ผู้ใช้เห็นและกดยืนยัน จึงถือเป็นแหล่งความจริง
//
//   node scripts/test-stats-breakdown.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { costBreakdown } = require('../backend/stats-breakdown.js');

const results = [];
const ok = (name, pass, detail = '') => {
  results.push(pass);
  console.log((pass ? '  ผ่าน  ' : '  ตก    ') + name + (detail ? '  -> ' + detail : ''));
};
const near = (a, b) => Math.abs(a - b) < 0.005;

/** ใบเบิกจำลอง ให้ใส่เฉพาะส่วนที่เกี่ยวกับค่าน้ำมัน */
const md = (carType, distOut, distRet, fuelRate, extra) => Object.assign({
  _carType: carType,
  _travel: { distOut: distOut, distRet: distRet },
  _costs: { fuelRate: fuelRate }
}, extra || {});

console.log('═══ 1. คิดค่าน้ำมันตาม carType เท่านั้น ═══');

ok('ไป-กลับ = คิดสองขา',
   near(costBreakdown(md('ไป-กลับ', 100, 100, 5)).fuel, 1000),
   costBreakdown(md('ไป-กลับ', 100, 100, 5)).fuel + ' บาท');

ok('ขาไป = คิดขาไปขาเดียว ไม่เอาขากลับมาบวก',
   near(costBreakdown(md('ขาไป', 100, 100, 5)).fuel, 500),
   costBreakdown(md('ขาไป', 100, 100, 5)).fuel + ' บาท');

ok('ขากลับ = คิดขากลับขาเดียว',
   near(costBreakdown(md('ขากลับ', 100, 100, 5)).fuel, 500),
   costBreakdown(md('ขากลับ', 100, 100, 5)).fuel + ' บาท');

/* ใบที่นั่ง Taxi ล้วน carType จะเป็น "ไม่ระบุ" เพราะไม่ได้ติ๊กรถส่วนตัวสักขา
   แต่ช่องระยะทางยังถูกเติมจากแผนที่ ค่าน้ำมันจึงต้องเป็นศูนย์
   ใบจริงที่เจอแบบนี้มี 7 ใบ หนักสุด id=75 ขึ้นค่าน้ำมัน 1,644 บาท */
ok('ไม่ระบุ = ไม่มีใครขับรถ ค่าน้ำมันต้องเป็นศูนย์',
   near(costBreakdown(md('ไม่ระบุ', 205.5, 205.5, 4)).fuel, 0),
   costBreakdown(md('ไม่ระบุ', 205.5, 205.5, 4)).fuel + ' บาท');

ok('ไม่มีคีย์ carType เลย (ใบเก่า) = ไม่เดาว่าไป-กลับ',
   near(costBreakdown({ _travel: { distOut: 50, distRet: 50 }, _costs: { fuelRate: 5 } }).fuel, 0));

console.log('');
console.log('═══ 2. ใบที่เลือกเหมาจ่าย ใช้ยอดก้อนที่เก็บไว้ ═══');

/* เหมาจ่ายคิดตามช่วงระยะทาง ไม่ใช่ ระยะ x อัตรา
   ถ้าคิดใหม่ตอนทำสถิติ จะไม่ตรงกับยอดที่พิมพ์บนเอกสารและที่จ่ายจริง
   ใบจริง id=111 เป็นตัวอย่าง: dashboard ขึ้น 1,002 ทั้งที่จ่ายจริง 2,400 */
const flat = md('ไป-กลับ', 100.2, 100.2, 5, {
  _fuelMethod: 'flat',
  _flatRate: { total: 2400, legs: [{ dir: 'ขาไป', amount: 1200 }, { dir: 'ขากลับ', amount: 1200 }] }
});
ok('เหมาจ่าย = ใช้ _flatRate.total ไม่ใช่ ระยะ x อัตรา',
   near(costBreakdown(flat).fuel, 2400),
   costBreakdown(flat).fuel + ' บาท (ถ้าคิดผิดจะได้ 1002)');

const flatZero = md('ไป-กลับ', 50, 50, 5, { _fuelMethod: 'flat', _flatRate: { total: 0, legs: [] } });
ok('เหมาจ่ายที่ยอดเป็นศูนย์ ก็ต้องเป็นศูนย์ ไม่ถอยไปคิดจากระยะ',
   near(costBreakdown(flatZero).fuel, 0),
   costBreakdown(flatZero).fuel + ' บาท');

const flatNoData = md('ไป-กลับ', 50, 50, 5, { _fuelMethod: 'flat' });
ok('เลือกเหมาจ่ายแต่ไม่มียอดเก็บไว้ = ถอยไปคิดจากระยะตามปกติ',
   near(costBreakdown(flatNoData).fuel, 500),
   costBreakdown(flatNoData).fuel + ' บาท');

console.log('');
console.log('═══ 3. ยอดอื่นต้องไม่เปลี่ยนไปจากเดิม ═══');

const full = md('ไป-กลับ', 10, 10, 5, {
  _costs: {
    fuelRate: 5,
    taxiEntries: [{ amount: 300 }, { amount: 450 }],
    hotelEntries: [{ rate: 1500, nights: 2 }],
    airAmount: 3000, tollAmount: 120, parkingAmount: 80, otherAmount: 60
  }
});
const b = costBreakdown(full);
ok('ค่า Taxi รวมทุกรายการ', near(b.taxi, 750), b.taxi + ' บาท');
ok('ค่าที่พัก rate x คืน',   near(b.hotel, 3000), b.hotel + ' บาท');
ok('ค่าเครื่องบิน',          near(b.air, 3000));
ok('ค่าทางด่วน',             near(b.toll, 120));
ok('ค่าที่จอดรถ',            near(b.parking, 80));
ok('ค่าใช้จ่ายอื่น',          near(b.other, 60));
ok('ค่าน้ำมันของใบนี้ 20 กม. x 5', near(b.fuel, 100), b.fuel + ' บาท');

/* km ที่คืนออกไปเป็นระยะทางที่เดินทางจริง ใช้ในมุมมองปลายทาง ไม่ใช่ฐานคิดเงิน
   จึงยังเป็นผลรวมสองขาเหมือนเดิม ไม่ผูกกับ carType */
ok('km ยังเป็นระยะทางรวมสองขาเหมือนเดิม', near(b.km, 20), b.km + ' กม.');

console.log('');
console.log('═══ 4. ข้อมูลพิกล ต้องไม่พัง ═══');

ok('ส่ง null เข้าไป ไม่ throw', near(costBreakdown(null).fuel, 0));
ok('ส่ง {} เข้าไป ไม่ throw',   near(costBreakdown({}).fuel, 0));
ok('ระยะทางเป็นข้อความ แปลงได้',
   near(costBreakdown(md('ไป-กลับ', '10.5', '10.5', '5')).fuel, 105),
   costBreakdown(md('ไป-กลับ', '10.5', '10.5', '5')).fuel + '');
ok('ระยะทางเป็นค่าขยะ = ศูนย์ ไม่ใช่ NaN',
   near(costBreakdown(md('ไป-กลับ', 'abc', null, 5)).fuel, 0));

console.log('');
const pass = results.filter(Boolean).length;
console.log('สรุป ' + pass + '/' + results.length + (pass === results.length ? '  ผ่านทั้งหมด' : '  ยังไม่ผ่าน'));
process.exitCode = pass === results.length ? 0 : 1;
