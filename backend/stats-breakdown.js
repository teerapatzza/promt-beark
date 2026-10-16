/* ══════════════════════════════════════════════════════════════════
   แยกยอดเงินของใบเบิกออกเป็นประเภทค่าใช้จ่าย — ใช้ทำสถิติหน้า Dashboard
   ──────────────────────────────────────────────────────────────────
   แยกออกมาจาก server.js เพื่อให้ทดสอบได้ ของเดิมเป็นฟังก์ชันใน server.js
   ซึ่งเรียกมาทดสอบไม่ได้เลยถ้าไม่สตาร์ท express เปิดฐานข้อมูล และจองพอร์ต
   บั๊กค่าน้ำมันสองตัวจึงอยู่มาได้นานโดยไม่มีเทสต์ไหนแตะถึง

   ค่าน้ำมันต้องคิดด้วยกฎเดียวกับที่พิมพ์ลงเอกสารจริง
   (public/history.html บรรทัด 694-700) เพราะนั่นคือยอดที่ผู้ใช้เห็น
   กดยืนยัน และได้รับจริง ตัวเลขบน Dashboard ที่ไม่ตรงกับเอกสาร
   ทำให้ผู้บริหารอ่านรายงานผิดโดยไม่มีใครจับได้
   ══════════════════════════════════════════════════════════════════ */
'use strict';

const num = v => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };

/**
 * @param {object} md  inputMetadata ของใบเบิก
 * @returns {{fuel:number,hotel:number,taxi:number,air:number,toll:number,parking:number,other:number,km:number}}
 */
function costBreakdown(md) {
  const c = (md && md._costs) || {};
  const t = (md && md._travel) || {};
  const km = num(t.distOut) + num(t.distRet);

  /* ค่าน้ำมันคิดเฉพาะขาที่เบิกรถส่วนตัวจริง
     ช่องระยะทางถูกเติมจากแผนที่ทุกครั้งแม้ไม่มีใครเบิกขานั้น
     ของเดิมบวกสองขาเสมอโดยไม่ดู carType ใบที่นั่ง Taxi ล้วน
     (carType = ไม่ระบุ) จึงถูกรายงานว่ามีค่าน้ำมันทั้งที่ไม่มีใครขับรถ */
  const carType = (md && md._carType) || 'ไม่ระบุ';
  let fuelDist = 0;
  if (carType === 'ขาไป')          fuelDist = num(t.distOut);
  else if (carType === 'ขากลับ')   fuelDist = num(t.distRet);
  else if (carType === 'ไป-กลับ')  fuelDist = num(t.distOut) + num(t.distRet);

  /* ใบที่เลือกเหมาจ่าย (บัญชี ๘ ข้อ ๕) คิดตามช่วงระยะทาง ไม่ใช่ ระยะ x อัตรา
     ต้องใช้ยอดก้อนที่เก็บไว้ตอนกรอก ซึ่งเป็นยอดที่ผู้ใช้กดยืนยันและได้รับจริง
     ถ้าคิดใหม่ตรงนี้ ตัวเลขบน Dashboard จะไม่ตรงกับที่พิมพ์บนเอกสาร
     เงื่อนไขเดียวกับ public/history.html บรรทัด 698 */
  const flat = (md && md._fuelMethod === 'flat' && md._flatRate) ? md._flatRate : null;
  const fuel = flat ? num(flat.total) : fuelDist * num(c.fuelRate);

  let hotel = 0;
  const h = c.hotelEntries;
  if (Array.isArray(h)) {
    h.forEach(x => (x && Array.isArray(x.entries) ? x.entries : [x]).forEach(e => {
      if (e) hotel += num(e.rate) * num(e.nights);
    }));
  } else if (h && Array.isArray(h.entries)) {
    h.entries.forEach(e => { if (e) hotel += num(e.rate) * num(e.nights); });
  }

  let taxi = 0;
  (Array.isArray(c.taxiEntries) ? c.taxiEntries : []).forEach(e => { taxi += num(e && e.amount); });

  return {
    fuel, hotel, taxi,
    air:     num(c.airAmount),
    toll:    num(c.tollAmount),
    parking: num(c.parkingAmount),
    other:   num(c.otherAmount),
    km
  };
}

module.exports = { costBreakdown, num };
