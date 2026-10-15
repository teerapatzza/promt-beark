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
const pass = results.filter(Boolean).length;
console.log('สรุป ' + pass + '/' + results.length + (pass === results.length ? '  ผ่านทั้งหมด' : '  ยังไม่ผ่าน'));
process.exitCode = pass === results.length ? 0 : 1;
