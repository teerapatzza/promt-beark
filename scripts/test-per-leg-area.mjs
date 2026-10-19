// พื้นที่ กทม.ปริมณฑล ต้องตัดสินรายขา ไม่ใช่ทั้งใบ
//
// 16 ต.ค. 2569 — เจ้าของงานชี้ว่าประกาศให้คิดแยกรายขา และตัวระเบียบยืนยัน
// บัญชี ๘ หัวคอลัมน์เขียนว่า "อัตรา/บาท /เที่ยว"
// ข้อ ๕ บรรทัดนอกเขตเขียนว่า "เหมาจ่าย ๑,๒๐๐ บาท/เที่ยว"
// วงเงินจึงผูกกับเที่ยว ไม่ใช่ทั้งใบ
//
// ของเดิมอ่านพื้นที่จากหมุดขาไปสองหมุด แล้วใช้ผลนั้นกับทุกขา
//   FlatRate.tripTotal(trip, cfg, inMetro)   <- ธงตัวเดียว
// เคสที่ผิดคือกรณีพิเศษที่ขากลับไปคนละที่
//   ขาไป  บ้านนนทบุรี -> รพ.พระประแดง   (ในเขต)
//   ขากลับ รพ.พระประแดง -> เชียงใหม่     (นอกเขต)
// ขากลับจะถูกคิดเรทในเขตตามช่วงระยะทาง แทนที่จะได้ ๑,๒๐๐
// คือผู้เดินทางได้น้อยกว่าที่ระเบียบให้
//
//   node scripts/test-per-leg-area.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const V = require('../backend/validation.js');
const FlatRate = require('../public/flat-rate.js');
const MetroArea = require('../public/metro-area.js');

const results = [];
const ok = (name, pass, detail = '') => {
  results.push(pass);
  console.log((pass ? '  ผ่าน  ' : '  ตก    ') + name + (detail ? '  -> ' + detail : ''));
};

// พิกัดจริง ยืนยันด้วยการถามแผนที่ย้อนพิกัดมาแล้ว
const NONTHABURI  = { lat: 13.8591, lng: 100.5217 };   // ในเขต
const PHRAPRADAENG= { lat: 13.6591, lng: 100.5330 };   // ในเขต
const CHIANGMAI   = { lat: 18.7883, lng:  98.9853 };   // นอกเขต
const BANGPAKONG  = { lat: 13.5307, lng: 100.9400 };   // นอกเขต (ฉะเชิงเทรา)

const CFG = {
  enabled: true, maxKm: 200, outsideMetro: 1200,
  bands: [
    { upTo: 10.99, amount: 150 }, { upTo: 20.99, amount: 250 },
    { upTo: 30.99, amount: 350 }, { upTo: 40.99, amount: 450 },
    { upTo: 50.99, amount: 550 }, { upTo: 60.99, amount: 650 },
    { upTo: null, amount: 750 }
  ]
};

console.log('═══ 1. legAreas อ่านพื้นที่ของแต่ละขาถูกต้อง ═══');

const same = MetroArea.legAreas({ fromGeo: NONTHABURI, toGeo: PHRAPRADAENG });
ok('กลับทางเดิม: ขากลับได้พื้นที่เท่าขาไป',
   same.out.inMetro === true && same.ret.inMetro === true && same.sameLeg === true,
   'ขาไป ' + same.out.reason);

const diff = MetroArea.legAreas({
  fromGeo: NONTHABURI, toGeo: PHRAPRADAENG,
  returnDifferent: true, returnFromGeo: PHRAPRADAENG, returnGeo: CHIANGMAI
});
ok('ขากลับคนละทางและออกนอกเขต: ขาไปในเขต ขากลับนอกเขต',
   diff.out.inMetro === true && diff.ret.inMetro === false && diff.sameLeg === false,
   'ขาไป=' + diff.out.inMetro + ' ขากลับ=' + diff.ret.inMetro + ' · ' + diff.ret.reason);

/* เว้นช่องจุดเริ่มต้นขากลับว่าง = ออกจากจุดที่รถไปส่งขาไป
   เว้นช่องปลายทางขากลับว่าง = กลับที่จุดเริ่มต้น
   เป็นกติกาที่เขียนไว้ในช่องกรอก ไม่ใช่การเดา */
const blankStart = MetroArea.legAreas({
  fromGeo: NONTHABURI, toGeo: PHRAPRADAENG,
  returnDifferent: true, returnFromGeo: null, returnGeo: CHIANGMAI
});
ok('เว้นจุดเริ่มต้นขากลับว่าง: ถอยไปใช้จุดที่รถไปส่งขาไป',
   blankStart.ret.fromProvince === 'สมุทรปราการ' && blankStart.ret.inMetro === false,
   'ต้นทางขากลับ = ' + blankStart.ret.fromProvince);

const blankEnd = MetroArea.legAreas({
  fromGeo: NONTHABURI, toGeo: PHRAPRADAENG,
  returnDifferent: true, returnFromGeo: BANGPAKONG, returnGeo: null
});
ok('เว้นปลายทางขากลับว่าง: ถอยไปใช้จุดเริ่มต้นขาไป',
   blankEnd.ret.toProvince === 'นนทบุรี' && blankEnd.ret.inMetro === false,
   'ปลายทางขากลับ = ' + blankEnd.ret.toProvince + ' · ' + blankEnd.ret.reason);

console.log('');
console.log('═══ 2. เงินที่ออกมาต้องคิดรายขาตาม บัญชี ๘ ข้อ ๕ ═══');

/* ขาไป 28.6 กม. ในเขต -> ช่วง 21.00-30.99 = 350
   ขากลับ 180 กม. นอกเขต -> เหมาจ่ายนอกเขต = 1,200
   รวม 1,550 ไม่ใช่ 350+750 = 1,100 (ซึ่งเป็นผลของกติกาเดิม) */
const trip = { distOut: 28.6, distRet: 180, carType: 'ไป-กลับ' };
const perLeg = FlatRate.tripTotal(trip, CFG, { out: true, ret: false });
ok('ขาไปในเขต 28.6 กม. ได้ 350',
   perLeg.legs[0].amount === 350, perLeg.legs[0].amount + ' · ' + perLeg.legs[0].label);
ok('ขากลับนอกเขต 180 กม. ได้ 1,200',
   perLeg.legs[1].amount === 1200, perLeg.legs[1].amount + ' · ' + perLeg.legs[1].label);
ok('รวมทั้งใบ 1,550 บาท', perLeg.total === 1550, perLeg.total + ' บาท');

const oldWay = FlatRate.tripTotal(trip, CFG, true);
ok('กติกาเดิม (ธงตัวเดียว) จะได้ 1,100 ซึ่งน้อยกว่าที่ระเบียบให้ 450 บาท',
   oldWay.total === 1100, oldWay.total + ' บาท');

ok('แต่ละขาบอกด้วยว่าอยู่ในเขตหรือนอกเขต',
   perLeg.legs[0].inMetro === true && perLeg.legs[1].inMetro === false,
   JSON.stringify(perLeg.legs.map(l => [l.dir, l.inMetro])));

console.log('');
console.log('═══ 3. ส่งแบบเดิม (boolean) ต้องยังทำงานเหมือนเดิม ═══');

/* ไม่บังคับให้ผู้เรียกทุกที่เปลี่ยนพร้อมกัน ชุดทดสอบเดิมยังส่ง boolean อยู่
   ถ้าของเดิมพังเงียบ ๆ จะไม่มีใครรู้จนกว่าเงินจะผิด */
const b1 = FlatRate.tripTotal({ distOut: 15, distRet: 25, carType: 'ไป-กลับ' }, CFG, true);
ok('boolean true = ในเขตทั้งสองขา 250 + 350 = 600', b1.total === 600, b1.total + ' บาท');
const b2 = FlatRate.tripTotal({ distOut: 150, distRet: 150, carType: 'ไป-กลับ' }, CFG, false);
ok('boolean false = นอกเขตทั้งสองขา 1200 x 2 = 2400', b2.total === 2400, b2.total + ' บาท');
const b3 = FlatRate.tripTotal({ distOut: 15, distRet: 25, carType: 'ขาไป' }, CFG, true);
ok('boolean + ขาไปขาเดียว ยังได้ 250', b3.total === 250, b3.total + ' บาท');

console.log('');
console.log('═══ 4. วงเงิน Taxi ฝั่ง backend ต้องคิดรายขาด้วย ═══');

/* รายการ Taxi แต่ละแถวมีทิศทางของตัวเอง เพดานต้องมาจากพื้นที่ของขานั้น
   ขาไปในเขต = เพดาน 750 (ตามระเบียบใหม่) · ขากลับนอกเขต = ไม่บังคับตรงนี้ */
const CAT = { taxiMaxPerTrip: 750, pdfTemplates: ['REPORT', 'TRANSPORT_RECEIPT'] };
const baseTravel = {
  fromGeo: NONTHABURI, toGeo: PHRAPRADAENG,
  startDate: '2026-10-16', endDate: '2026-10-17',
  startTime: '08:00', endTime: '18:00',
  distOut: 28.6, distRet: 28.6,
  returnDifferent: true, returnFromGeo: PHRAPRADAENG, returnGeo: CHIANGMAI
};
const mk = entries => ({
  inputMetadata: {
    _carType: 'ไม่ระบุ',
    _travel: baseTravel,
    _costs: { fuelRate: 5, taxiEntries: entries },
    _activityName: 'ทดสอบ',
    _pdfTemplates: ['REPORT', 'TRANSPORT_RECEIPT']
  },
  requestedBy: 'ทดสอบ', projectId: 'TRAVEL002', amount: 0
});

const overOut = V.validateExpense(mk([
  { date: '2026-10-16', direction: 'ขาไป', amount: 900 }
]), CAT, 750);
ok('Taxi ขาไป 900 บาท ในเขต = เกิน 750 ถูกกันไว้',
   overOut.some(e => /เกินวงเงิน/.test(e.message)),
   overOut.filter(e => /เกินวงเงิน/.test(e.message)).map(e => e.message.split('\n')[0]).join(' | ') || '(ไม่ถูกกัน)');

const okOut = V.validateExpense(mk([
  { date: '2026-10-16', direction: 'ขาไป', amount: 750 }
]), CAT, 750);
ok('Taxi ขาไป 750 บาทพอดี = ผ่าน ตามระเบียบใหม่',
   !okOut.some(e => /เกินวงเงิน/.test(e.message)),
   okOut.filter(e => /เกินวงเงิน/.test(e.message)).map(e => e.message.split('\n')[0]).join(' | ') || 'ผ่าน');

/* ขากลับของใบนี้ออกนอกเขต (ไปเชียงใหม่) เพดานในเขตจึงไม่ควรถูกบังคับกับขานั้น
   ของเดิมใช้พื้นที่ของขาไปกับทุกแถว ขากลับ 900 บาทจะถูกกันไว้อย่างผิด ๆ */
const retOut = V.validateExpense(mk([
  { date: '2026-10-17', direction: 'ขากลับ', amount: 900 }
]), CAT, 750);
ok('Taxi ขากลับ 900 บาท แต่ขากลับอยู่นอกเขต = ไม่ถูกกันด้วยเพดานในเขต',
   !retOut.some(e => /เกินวงเงิน/.test(e.message)),
   retOut.filter(e => /เกินวงเงิน/.test(e.message)).map(e => e.message.split('\n')[0]).join(' | ') || 'ผ่าน');

console.log('');
console.log('═══ 5. ใบที่กลับทางเดิม ต้องไม่เปลี่ยนพฤติกรรมเดิม ═══');

const CAT2 = { taxiMaxPerTrip: 750, pdfTemplates: ['REPORT', 'TRANSPORT_RECEIPT'] };
const sameRoute = {
  inputMetadata: {
    _carType: 'ไม่ระบุ',
    _travel: Object.assign({}, baseTravel, {
      returnDifferent: false, returnFromGeo: null, returnGeo: null
    }),
    _costs: { fuelRate: 5, taxiEntries: [{ date: '2026-10-17', direction: 'ขากลับ', amount: 900 }] },
    _activityName: 'ทดสอบ',
    _pdfTemplates: ['REPORT', 'TRANSPORT_RECEIPT']
  },
  requestedBy: 'ทดสอบ', projectId: 'TRAVEL002', amount: 0
};
const r5 = V.validateExpense(sameRoute, CAT2, 750);
ok('กลับทางเดิมและอยู่ในเขต: Taxi ขากลับ 900 ยังถูกกันไว้เหมือนเดิม',
   r5.some(e => /เกินวงเงิน/.test(e.message)),
   r5.filter(e => /เกินวงเงิน/.test(e.message)).map(e => e.message.split('\n')[0]).join(' | ') || '(ไม่ถูกกัน)');

console.log('');
const pass = results.filter(Boolean).length;
console.log('สรุป ' + pass + '/' + results.length + (pass === results.length ? '  ผ่านทั้งหมด' : '  ยังไม่ผ่าน'));
process.exitCode = pass === results.length ? 0 : 1;
