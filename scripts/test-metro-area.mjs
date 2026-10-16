// การตัดสิน "ใน กทม.ปริมณฑล / นอกเขต" ต้องดูจากจุดที่เดินทางจริง ไม่ใช่ที่อยู่ในโปรไฟล์
//
// 15 ต.ค. 2569 — เจ้าของงานส่งภาพมาว่า นนทบุรี -> พระประแดง 28.60 กม.
// ถูกคิดเป็น "เหมาจ่ายนอกเขต 1,200 บาท/เที่ยว" (ไป-กลับ 2,400)
// ทั้งที่ประกาศ บัญชี ๘ ข้อ ๕ ระบุว่า 21.00-30.99 กม. ในเขต = 350 บาท/เที่ยว
// และ ปริมณฑล ได้แก่ นนทบุรี ปทุมธานี สมุทรปราการ สมุทรสาคร นครปฐม
//
// ต้นเหตุ: จังหวัดต้นทางถูกอ่านจาก fromAddr.prov ซึ่งเติมจากที่อยู่ในโปรไฟล์เท่านั้น
// ไม่เคยอัปเดตตามจุดที่พิมพ์หรือหมุดที่ลาก ผู้เดินทางที่บ้านอยู่ต่างจังหวัด
// จึงถูกตีว่า "นอกเขต" ทุกครั้ง แม้เดินทางอยู่ในปริมณฑลล้วน ๆ
//
// ทดสอบฝั่ง backend ซึ่งเป็นตัวตัดสินจริงตอนบันทึก
//   node scripts/test-metro-area.mjs
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

// พิกัดจริงของสองจุดในภาพ ทั้งคู่อยู่ในกรอบ กทม.ปริมณฑล
const NONTHABURI   = { lat: 13.8591, lng: 100.5217 };
const PHRAPRADAENG = { lat: 13.6591, lng: 100.5330 };
// จุดนอกเขตชัดเจน
const SARABURI     = { lat: 14.5289, lng: 100.9100 };
const LOEI         = { lat: 17.4860, lng: 101.7223 };

const trip = (o) => Object.assign({
  fromGeo: NONTHABURI, toGeo: PHRAPRADAENG, toProv: 'สมุทรปราการ', fromAddr: { prov: 'นนทบุรี' }
}, o);

console.log('═══ 1. เคสที่เจ้าของงานเจอ ═══');

ok('ที่อยู่โปรไฟล์อยู่ต่างจังหวัด แต่เดินทางในปริมณฑลล้วน ต้องนับเป็นในเขต',
   V.isMetroTrip(trip({ fromAddr: { prov: 'สระบุรี' } })).inMetro === true,
   V.isMetroTrip(trip({ fromAddr: { prov: 'สระบุรี' } })).reason);

ok('ไม่มีที่อยู่ในโปรไฟล์เลย ก็ยังตัดสินจากหมุดได้',
   V.isMetroTrip(trip({ fromAddr: null })).inMetro === true,
   V.isMetroTrip(trip({ fromAddr: null })).reason);

ok('ที่อยู่โปรไฟล์อยู่ในปริมณฑลอยู่แล้ว ผลต้องไม่เปลี่ยน',
   V.isMetroTrip(trip({})).inMetro === true);

/* 15 ต.ค. 2569 — เจ้าของงานยกเคสนี้ขึ้นมา และเป็นเคสที่หักล้างกติกาเดิม
   นั่งรถจากบ้านไปสนามบินดอนเมือง แล้วบินไปปฏิบัติงานต่างจังหวัด
   ช่อง "ไปปฏิบัติงาน ณ จังหวัด" จะเป็นจังหวัดปลายทางของงาน เช่น เลย
   แต่รถวิ่งอยู่ในกรุงเทพล้วน ๆ ไม่ได้ออกนอกเขตเลย

   เดิมระบบให้จังหวัดนั้นตัดสินแล้วตีเป็นนอกเขตทันที ซึ่งผิด
   เพราะประกาศ บัญชี ๘ พูดถึง "การเดินทาง" ของพาหนะที่เบิก ไม่ใช่ที่ตั้งของงาน
   จึงเลิกใช้จังหวัดปฏิบัติงานเป็นตัวตัดสิน ให้หมุดบนแผนที่ตัดสินอย่างเดียว */
const airport = trip({ toGeo: { lat: 13.9126, lng: 100.6068 }, toProv: 'เลย' });
ok('นั่งรถไปสนามบินดอนเมือง แล้วบินไปทำงานต่างจังหวัด = รถวิ่งในเขต',
   V.isMetroTrip(airport).inMetro === true, V.isMetroTrip(airport).reason);

ok('จังหวัดปฏิบัติงานไม่ใช่ตัวตัดสินอีกต่อไป หมุดในเขตก็คือในเขต',
   V.isMetroTrip(trip({ toProv: 'เชียงใหม่' })).inMetro === true);

console.log('');
console.log('═══ 2. เคสที่ยังต้องเป็นนอกเขตเหมือนเดิม ═══');

ok('หมุดต้นทางอยู่นอกกรอบ = นอกเขต',
   V.isMetroTrip(trip({ fromGeo: SARABURI, toProv: '' })).inMetro === false);

ok('หมุดปลายทางอยู่นอกกรอบ = นอกเขต',
   V.isMetroTrip(trip({ toGeo: LOEI, toProv: '' })).inMetro === false);

ok('ยังไม่ได้ปักหมุดต้นทาง = ยังไม่ถือว่าในเขต',
   V.isMetroTrip(trip({ fromGeo: null, fromAddr: null, toProv: '' })).inMetro === false);

ok('ยังไม่ได้ปักหมุดปลายทาง = ยังไม่ถือว่าในเขต',
   V.isMetroTrip(trip({ toGeo: null, toProv: '' })).inMetro === false);

console.log('');
console.log('═══ 3. เงินที่ออกมาต้องตรงกับประกาศ บัญชี ๘ ข้อ ๕ ═══');

const cfg = {
  enabled: true, maxKm: 200, outsideMetro: 1200,
  bands: [
    { upTo: 10.99, amount: 150 }, { upTo: 20.99, amount: 250 },
    { upTo: 30.99, amount: 350 }, { upTo: 40.99, amount: 450 },
    { upTo: 50.99, amount: 550 }, { upTo: 60.99, amount: 650 },
    { upTo: null, amount: 750 }
  ]
};

const inMetro = V.isMetroTrip(trip({ fromAddr: { prov: 'สระบุรี' } })).inMetro;
const leg = FlatRate.legAmount(28.60, cfg, inMetro);
ok('28.60 กม. ในปริมณฑล ได้ 350 บาทต่อเที่ยว',
   leg.amount === 350, leg.amount + ' บาท · ' + (leg.label || leg.why));

const both = FlatRate.legAmount(28.60, cfg, inMetro).amount * 2;
ok('ไป-กลับ รวม 700 บาท ไม่ใช่ 2,400',
   both === 700, both + ' บาท');

const out = FlatRate.legAmount(28.60, cfg, false);
ok('ถ้านอกเขตจริง ยังได้ 1,200 บาทต่อเที่ยวตามประกาศ',
   out.amount === 1200, out.amount + ' บาท · ' + (out.label || out.why));

console.log('');
console.log('═══ 4. ขอบเขตต้องเป็นรูปจังหวัดจริง ไม่ใช่กล่องสี่เหลี่ยม ═══');

/* 16 ต.ค. 2569 — ของเดิมใช้กล่องสี่เหลี่ยมอันเดียวครอบหกจังหวัด
   ซึ่งกินพื้นที่จังหวัดข้างเคียงไปด้วย ทดสอบกับพิกัดจริงแล้วตัดสินผิด 4 จาก 10 จุด
   และผิดไปทางเดียวกันหมด คือตีจุดนอกเขตว่าอยู่ในเขต ผู้เดินทางแถบชายขอบ
   จึงได้เหมาจ่ายตามช่วงระยะทางแทนที่จะได้ ๑,๒๐๐ ตามข้อ ๕ คือได้น้อยกว่าที่ควร

   จังหวัดที่เขียนไว้ด้านล่างมาจากการถามแผนที่ย้อนพิกัดทีละจุด ไม่ได้เดาเอง
   สี่จุดที่ทำเครื่องหมาย (ของเดิมผิด) ไว้ คือจุดที่กล่องสี่เหลี่ยมตัดสินพลาด */
const POINTS = [
  // ชื่อ, lat, lng, จังหวัดจริง, อยู่ในหกจังหวัดไหม, กล่องเดิมเคยตัดสินผิดไหม
  ['วังน้อย',            14.1906, 100.7217, 'ปทุมธานี',        true,  false],
  ['บางปะอิน',           14.1950, 100.5800, 'พระนครศรีอยุธยา', false, true ],
  ['บ้านโป่ง',           13.8119,  99.9200, 'ราชบุรี',         false, true ],
  ['เมืองสมุทรสงคราม',   13.4600, 100.0000, 'สมุทรสงคราม',     false, true ],
  ['บางปะกง',            13.5307, 100.9400, 'ฉะเชิงเทรา',      false, true ],
  ['ศรีราชา',            13.1700, 100.9300, 'ชลบุรี',          false, false],
  ['ดอนเมือง',           13.9126, 100.6068, 'กรุงเทพมหานคร',   true,  false],
  ['พระประแดง',          13.6591, 100.5330, 'สมุทรปราการ',     true,  false],
  ['เมืองนนทบุรี',       13.8591, 100.5217, 'นนทบุรี',         true,  false],
  ['เมืองนครปฐม',        13.8196, 100.0620, 'นครปฐม',          true,  false],
  ['สยามสแควร์',         13.7456, 100.5331, 'กรุงเทพมหานคร',   true,  false],
  ['สนามบินสุวรรณภูมิ',  13.6900, 100.7501, 'สมุทรปราการ',     true,  false],
  ['เมืองสมุทรสาคร',     13.5475, 100.2745, 'สมุทรสาคร',       true,  false],
  ['เมืองปทุมธานี',      14.0208, 100.5250, 'ปทุมธานี',        true,  false],
  ['เมืองอยุธยา',        14.3532, 100.5689, 'พระนครศรีอยุธยา', false, false],
  ['หัวหิน',             12.5684,  99.9577, 'ประจวบคีรีขันธ์', false, false],
];

for (const [name, lat, lng, prov, inside, wasWrong] of POINTS) {
  const got = MetroArea.provinceAt(lat, lng);
  // อยู่ในหกจังหวัด = ต้องบอกชื่อจังหวัดถูกด้วย ไม่ใช่แค่ตอบว่าอยู่ในเขต
  // นอกหกจังหวัด = ต้องตอบ null เพราะไฟล์นี้เก็บแค่หกจังหวัด
  const pass = inside ? got === prov : got === null;
  ok(name + ' → ' + prov + (inside ? ' (ในเขต)' : ' (นอกเขต)')
       + (wasWrong ? '  [กล่องเดิมตัดสินผิดจุดนี้]' : ''),
     pass, got === null ? 'ไม่อยู่ในหกจังหวัด' : got);
}

console.log('');
console.log('═══ 5. สี่จุดที่กล่องเดิมพลาด ต้องได้เงินถูกต้องแล้ว ═══');

/* จุดเหล่านี้อยู่นอกเขตจริง ต้องได้เหมาจ่าย ๑,๒๐๐ ต่อเที่ยวตามข้อ ๕
   ของเดิมตีเป็นในเขตแล้วให้ตามช่วงระยะทาง ซึ่งน้อยกว่าทุกช่วง */
const BKK = { lat: 13.7456, lng: 100.5331 };
for (const [name, lat, lng] of POINTS.filter(p => p[5])) {
  const t = { fromGeo: BKK, toGeo: { lat, lng } };
  const area = V.isMetroTrip(t);
  const money = FlatRate.legAmount(45, cfg, area.inMetro);
  ok('กรุงเทพ → ' + name + ' นับเป็นนอกเขต และได้ 1,200 ต่อเที่ยว',
     area.inMetro === false && money.amount === 1200,
     area.reason + ' · ' + money.amount + ' บาท');
}

console.log('');
console.log('═══ 6. เหตุผลที่แสดงต้องบอกชื่อจังหวัดที่อ่านได้จากหมุด ═══');

const named = V.isMetroTrip({ fromGeo: NONTHABURI, toGeo: PHRAPRADAENG });
ok('ในเขต: บอกทั้งจังหวัดต้นทางและปลายทาง',
   named.fromProvince === 'นนทบุรี' && named.toProvince === 'สมุทรปราการ'
   && /นนทบุรี/.test(named.reason) && /สมุทรปราการ/.test(named.reason),
   named.reason);

const halfOut = V.isMetroTrip({ fromGeo: NONTHABURI, toGeo: LOEI });
ok('หลุดฝั่งเดียว: บอกว่าเป็นฝั่งปลายทางที่หลุด',
   halfOut.inMetro === false && /ปลายทาง/.test(halfOut.reason)
   && halfOut.fromProvince === 'นนทบุรี' && halfOut.toProvince === null,
   halfOut.reason);

console.log('');
const pass = results.filter(Boolean).length;
console.log('สรุป ' + pass + '/' + results.length + (pass === results.length ? '  ผ่านทั้งหมด' : '  ยังไม่ผ่าน'));
process.exitCode = pass === results.length ? 0 : 1;
