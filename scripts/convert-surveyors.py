# แปลงทะเบียนผู้เยี่ยมสำรวจ (Excel แผ่น "sur") เป็น JSON สำหรับ API /dw/surveyor*
#
# 28 ต.ค. 2569 — HA PORTAL ต้องใช้ข้อมูลผู้เยี่ยมสำรวจผ่าน DW/DS
# แต่ DW รับ Excel ได้เฉพาะตามเทมเพลต ไฟล์นี้จึงให้พร้อมเบิกเปิดเป็น API ให้ DW มาดึงแทน
# เป็นของแก้ขัดจนกว่า Smart Survey จะต่อ DW ได้เอง ไฟล์ต้นทางไม่อัปเดต
#
# ไฟล์ต้นทางและไฟล์ที่ได้มีเลขบัตรประชาชน ที่อยู่บ้าน เบอร์โทร — ห้ามเข้า git (repo เป็น public)
# ตัวแปลงจึงไม่มีค่าตายตัวของใครอยู่ในตัว และเขียนผลไปที่ไหนก็ได้ตามที่สั่ง
#
# กันข้อมูลหล่น:
#   - หัวคอลัมน์ทุกช่องต้องตรงกับที่ออกแบบไว้ ไม่ตรงหยุดทันที (ไฟล์เปลี่ยนรูปแบบต้องมีคนดู)
#   - คอลัมน์ไหนมีข้อมูลแต่ไม่ได้ถูกนำไปใช้ หยุดทันที
#   - ทุกการปรับค่าถูกบันทึกลง issues (อ้างด้วยรหัสผู้เยี่ยม ไม่มีชื่อ)
#
#   python -I scripts/convert-surveyors.py <ไฟล์.xlsx> <ผลลัพธ์.json>
import datetime
import json
import re
import sys

import openpyxl


def norm(s):
    return re.sub(r'\s+', ' ', str(s if s is not None else '')).strip()


def text(v):
    """ค่าที่ต้องเป็นข้อความ ตัวเลขที่ Excel เก็บเป็น 123.0 ต้องได้ '123' ไม่ใช่ '123.0'"""
    if v is None:
        return None
    if isinstance(v, float) and v.is_integer():
        v = int(v)
    if isinstance(v, datetime.datetime):
        return v.date().isoformat()
    s = norm(v)
    return s or None


PLACEHOLDERS = {'-', '–', '—', '--'}


def thai_id_ok(d):
    """หลักสุดท้ายของเลขบัตรประชาชนคำนวณจาก 12 หลักแรก"""
    if not re.fullmatch(r'\d{13}', d):
        return False
    s = sum(int(d[i]) * (13 - i) for i in range(12))
    return (11 - s % 11) % 10 == int(d[12])


def num(v):
    if v is None or (isinstance(v, str) and not v.strip()):
        return None
    if isinstance(v, (int, float)):
        return int(v) if float(v).is_integer() else float(v)
    raise ValueError('ไม่ใช่ตัวเลข')


def date(v):
    if v is None or (isinstance(v, str) and not v.strip()):
        return None
    if isinstance(v, datetime.datetime):
        return v.date().isoformat()
    raise ValueError('ไม่ใช่วันที่')


def flag(v):
    return v not in (None, '', 0)


# ── หัวคอลัมน์ที่ออกแบบไว้ (ตำแหน่ง: หัวแถวแรกหลังยุบช่องว่าง) ──
BASIC = [
    (0, 'เลข ทะเบียน', 'surveyor_id', text), (1, 'คำนำหน้า', 'title', text),
    (2, 'ชื่อ-สกุล', 'full_name', text), (3, 'ชื่อภาษาอังกฤษ', 'name_en', text),
    (4, 'ชื่อเล่น', 'nickname', text), (5, 'ปฎิบัติ งาน', 'work_status', text),
    (6, 'หน่วยงาน', 'organization', text), (7, 'Hcode', 'hcode', text),
    (8, 'สังกัด', 'affiliation', text), (9, 'จังหวัดที่ปฏิบัติงาน', 'province', text),
    (10, 'ภูมิภาค', 'region', text), (11, 'เขตสุขภาพ', 'health_zone', num),
    (12, 'ผู้เยี่ยมมาตรฐานอื่น', 'other_standards', text), (13, 'วิชาชีพ', 'profession', text),
    (14, 'วิชาชีพ filter', 'profession_group', text),
    (15, 'ตำแหน่งบริหารปัจจุบัน (รวมอดีต)', 'admin_position', text),
    (16, 'เลขประกอบวิชาชีพ เลขสมาชิกแพทย์สภา/ สภาการพยาบาล', 'license_no', text),
    (17, 'เยี่ยม AS/RS', 'program_asrs', flag), (18, 'เยี่ยม AHA', 'program_aha', flag),
    (19, 'เยี่ยม PDSC', 'program_pdsc', flag), (20, 'เยี่ยม HNA', 'program_hna', flag),
    (21, 'เยี่ยม DHSA', 'program_dhsa', flag), (22, 'เยี่ยม PHCA', 'program_phca', flag),
    (23, 'Clinical team', 'team_clinical', flag), (24, 'Nurse team', 'team_nurse', flag),
    (25, 'Admin team', 'team_admin', flag), (26, 'Phamacy team', 'team_pharmacy', flag),
    (27, 'สถานะ', 'status', text),
    (95, 'Exist SUR', 'exist_sur_year', num), (96, 'จำนวนปี', 'years_registered', num),
    (119, 'จำนวนปี หน.ทีม', 'team_leader_years', num), (132, 'จำนวนปี ครู', 'trainer_years', num),
    (141, 'โทร', 'phone', None), (142, 'Line ID', 'line_id', text),
    (143, 'e-mail ผู้เยี่ยมสำรวจ', 'email', text),
    (144, 'e-mail สารบรรณอิเล็กทรอนิกส์', 'email_saraban', text),
    (145, 'ที่อยู่ที่ทำงาน', 'work_address', text), (146, 'แขวง/ตำบล', 'work_subdistrict', text),
    (147, 'อำเภอ/เขต', 'work_district', text), (148, 'จังหวัด', 'work_province', text),
    (149, 'รหัสไปรษณีย์', 'work_postcode', text),
    (150, 'ที่อยู่บ้านพัก', 'home_address', text), (151, 'ตำบล/แขวง', 'home_subdistrict', text),
    (152, 'อำเภอ/เขต', 'home_district', text), (153, 'จังหวัด', 'home_province', text),
    (154, 'รหัสไปรษณีย์', 'home_postcode', text),
    (155, 'ทะเบียนรถ', 'car_plate', text), (156, 'ประเภทรถ', 'car_type', text),
    (157, 'Royal orcrid plus', 'member_thai_airways', text), (158, 'แอร์เอเชีย', 'member_air_asia', text),
    (159, 'นกแอร์', 'member_nok_air', text), (160, 'บางกอกแอร์', 'member_bangkok_airways', text),
    (163, 'คศ.', 'birth_date', date),
    (164, 'หมายเลขบัตรประชาชน', 'national_id', text),
    (165, 'หมายเหตุ', 'note', text), (166, 'หมายเหตุการแจ้งต้นสังกัด', 'note_affiliation', text),
]
# คอลัมน์ที่ตั้งใจไม่ส่งออก พร้อมเหตุผล — ต้องอยู่ในรายการนี้ ไม่งั้นตัวตรวจ "ข้อมูลหล่น" จะหยุด
SKIPPED = {
    161: ('วันเกิด', 'บางคนกรอกปี พ.ศ. ลงช่อง ค.ศ. ใช้คอลัมน์ "คศ." ที่ถูกครบทุกคนแทน'),
    162: ('อายุ', 'ค่านิ่งตามวันทำไฟล์ API คำนวณจาก birth_date ตามวันที่ดึงแทน'),
}
# สายการขึ้นทะเบียน: (สาย, ชื่อไทย, [(คอลัมน์วันเริ่ม, หัวที่ต้องเป็น, ลำดับครั้ง)])
TRACKS = [
    ('surveyor', 'ผู้เยี่ยมสำรวจ', [
        (97, 'ขึ้นทะเบียน New surveyor', 0), (99, 'ต่ออายุ กรณีพิเศษ', 1),
        (101, 'ต่ออายุ ครั้งที่ 2 กรณีพิเศษ', 2), (103, 'ต่ออายุ Experience ปีที่ 1', 3),
        (105, 'ต่ออายุครั้งที่ 2', 4), (107, 'ต่ออายุครั้งที่ 3', 5), (109, 'ต่ออายุครั้งที่ 4', 6),
        (111, 'ต่ออายุครั้งที่ 5', 7), (113, 'ต่ออายุครั้งที่ 6', 8), (115, 'ต่ออายุครั้งที่ 7', 9),
        # ต้นทางไม่มีหัว มีค่าอยู่หนึ่งคน วางต่อจากครั้งที่ 7 พร้อมคู่วันหมดอายุ จึงถือเป็นครั้งที่ 8
        (117, '', 10)]),
    ('team_leader', 'หัวหน้าทีม', [
        (120, 'ขึ้นทะเบียน หน.ทีม', 0), (122, 'ต่ออายุครั้งที่ 1', 1), (124, 'ต่ออายุครั้งที่ 2', 2),
        (126, 'ต่ออายุครั้งที่ 3', 3), (128, 'ต่ออายุครั้งที่ 4', 4)]),
    ('trainer', 'ครูฝึก', [
        (133, 'ขึ้นทะเบียน ครู', 0), (135, 'ต่ออายุครั้งที่ 1', 1), (137, 'ต่ออายุครั้งที่ 2', 2)]),
]
UNLABELED_EVENT = 'ต่ออายุครั้งที่ 8 (ต้นทางไม่มีหัวคอลัมน์)'
VISIT_COLS = range(28, 79)
TRAIN_COLS = range(79, 95)
ROLE_NAME = {'SUR': 'ผู้เยี่ยมสำรวจ', 'LS': 'หัวหน้าทีม', 'ST': 'ครูฝึก'}


def main(src, dst):
    wb = openpyxl.load_workbook(src, read_only=True, data_only=True)
    if [ws.title for ws in wb.worksheets] != ['sur']:
        sys.exit('แผ่นงานไม่ตรงที่ออกแบบ: %s' % [ws.title for ws in wb.worksheets])
    rows = list(wb.worksheets[0].iter_rows(values_only=True))
    h1 = [norm(x) for x in rows[0]]
    h2 = [norm(x) for x in rows[1]]
    width = len(h1)

    # ── ตรวจหัวคอลัมน์ ──
    bad = []
    for i, head, _k, _f in BASIC:
        if h1[i] != head:
            bad.append((i, head, h1[i]))
    for i, (head, _why) in SKIPPED.items():
        if h1[i] != head:
            bad.append((i, head, h1[i]))
    for _t, _n, evs in TRACKS:
        for i, head, _r in evs:
            if h1[i] != head:
                bad.append((i, head, h1[i]))
            if h1[i + 1] != ('หมดอายุ' if head else ''):
                bad.append((i + 1, 'หมดอายุ', h1[i + 1]))
    if not h1[28].startswith('ประวัติการเยี่ยม'):
        bad.append((28, 'ประวัติการเยี่ยม...', h1[28]))
    if not h1[79].startswith('ประวัติการเข้าการอบรม'):
        bad.append((79, 'ประวัติการเข้าการอบรม...', h1[79]))
    visit_head = {}
    for i in VISIT_COLS:
        m = re.fullmatch(r'(25\d\d) (SUR|LS|ST)', h2[i])
        if not m:
            bad.append((i, 'ปี + SUR/LS/ST', h2[i]))
        else:
            visit_head[i] = (int(m.group(1)), m.group(2))
    train_head = {}
    for i in TRAIN_COLS:
        if not re.fullmatch(r'25\d\d', h2[i]):
            bad.append((i, 'ปี พ.ศ.', h2[i]))
        else:
            train_head[i] = int(h2[i])
    if bad:
        for b in bad:
            print('หัวคอลัมน์ไม่ตรง [%d] ต้องเป็น %r ได้ %r' % b)
        sys.exit(2)

    used = {i for i, *_ in BASIC} | set(SKIPPED) | set(VISIT_COLS) | set(TRAIN_COLS)
    for _t, _n, evs in TRACKS:
        for i, _h, _r in evs:
            used |= {i, i + 1}

    issues = []
    surveyors, visits, trainings, regs = [], [], [], []
    seen = set()

    for excel_row, r in enumerate(rows[2:], start=3):
        if not r or not any(c not in (None, '') for c in r):
            continue
        r = list(r) + [None] * (width - len(r))
        sid = text(r[0])
        if not sid:
            # เศษค้างท้ายตาราง (ต้นทางมีหนึ่งแถว: Hcode = 0 กับอักษรตัวเดียว) ข้ามได้
            # แต่ถ้ามีชื่อหรือมีค่าหลายช่อง คือคนที่ลืมใส่เลขทะเบียน ต้องหยุดให้คนดู
            filled = [j for j, c in enumerate(r) if c not in (None, '')]
            if r[2] in (None, '') and len(filled) <= 2:
                issues.append({'surveyor_id': None, 'field': 'row',
                               'issue': 'แถว Excel %d ไม่มีเลขทะเบียนและชื่อ มีค่าแค่คอลัมน์ %s ข้ามไป' % (excel_row, filled)})
                continue
            sys.exit('แถว Excel %d มีข้อมูลแต่ไม่มีเลขทะเบียน' % excel_row)
        if sid in seen:
            sys.exit('เลขทะเบียนซ้ำ: %s' % sid)
        seen.add(sid)
        # ข้อมูลหล่น: ช่องที่มีค่าแต่ไม่อยู่ในแบบ
        for j, v in enumerate(r):
            if j not in used and v not in (None, ''):
                sys.exit('คอลัมน์ [%d] %r มีข้อมูล (%s) แต่ไม่อยู่ในแบบ — ต้องออกแบบเพิ่มก่อน'
                         % (j, h1[j] if j < len(h1) else '', sid))

        s = {}
        for i, _head, key, fn in BASIC:
            v = r[i]
            if key == 'phone':
                if isinstance(v, (int, float)):
                    s[key] = '0' + str(int(v))
                    issues.append({'surveyor_id': sid, 'field': key,
                                   'issue': 'Excel ตัดเลข 0 หน้าเบอร์ทิ้ง เติมคืนแล้ว'})
                else:
                    s[key] = text(v)
                continue
            try:
                s[key] = fn(v)
            except ValueError as e:
                sys.exit('%s คอลัมน์ [%d] %s: %s' % (sid, i, key, e))
            if fn is text and isinstance(v, str) and v != v.strip():
                issues.append({'surveyor_id': sid, 'field': key, 'issue': 'ตัดช่องว่างหัว/ท้ายข้อความ'})
            # "-" ในต้นทางแปลว่าไม่มี ส่งเป็นค่าว่าง ไม่งั้น DS จะนับ "-" เป็นค่าจริง (เช่น Hcode "-" ไป join ผิด)
            if fn is text and s[key] in PLACEHOLDERS:
                s[key] = None
                issues.append({'surveyor_id': sid, 'field': key, 'issue': 'ค่า "-" แปลว่าไม่มี ส่งเป็นค่าว่าง'})

        # เลขที่ใช้ค้นหาหรือ join ต้องมีรูปแบบเดียว ต้นทางเขียนปนทั้งมีและไม่มีเว้นวรรค/ขีด
        if s['national_id']:
            d = re.sub(r'[\s-]', '', s['national_id'])
            if d != s['national_id']:
                s['national_id'] = d
            if not thai_id_ok(d):
                issues.append({'surveyor_id': sid, 'field': 'national_id',
                               'issue': 'เลขบัตรประชาชนไม่ผ่านการตรวจหลักสุดท้าย (ส่งตามต้นทาง)'})
        if s['phone']:
            d = re.sub(r'[\s-]', '', s['phone'])
            if re.fullmatch(r'0\d{8,9}', d):
                s['phone'] = d
            else:
                issues.append({'surveyor_id': sid, 'field': 'phone',
                               'issue': 'เบอร์โทรไม่ใช่รูปแบบเบอร์เดียว 9-10 หลัก (ส่งตามต้นทาง)'})
        for key in ('work_postcode', 'home_postcode'):
            parts = (s[key] or '').split()
            if len(parts) > 1:
                if len(set(parts)) == 1:
                    s[key] = parts[0]
                    issues.append({'surveyor_id': sid, 'field': key, 'issue': 'รหัสไปรษณีย์ซ้ำสองชุดเหมือนกัน เหลือชุดเดียว'})
                else:
                    issues.append({'surveyor_id': sid, 'field': key, 'issue': 'มีรหัสไปรษณีย์หลายชุดที่ต่างกัน (ส่งตามต้นทาง)'})

        # ทะเบียนแต่ละสาย
        for track, track_name, evs in TRACKS:
            first = latest = None
            for i, head, order in evs:
                try:
                    start, expire = date(r[i]), date(r[i + 1])
                except ValueError as e:
                    sys.exit('%s คอลัมน์ [%d]: %s' % (sid, i, e))
                if not start and not expire:
                    continue
                regs.append({'surveyor_id': sid, 'track': track, 'track_name': track_name,
                             'event_order': order, 'event_name': head or UNLABELED_EVENT,
                             'start_date': start, 'expire_date': expire})
                if not head:
                    issues.append({'surveyor_id': sid, 'field': 'registration',
                                   'issue': 'คอลัมน์ไม่มีหัว [%d-%d] ถือเป็นต่ออายุครั้งที่ 8' % (i, i + 1)})
                if start and not expire:
                    issues.append({'surveyor_id': sid, 'field': 'registration',
                                   'issue': '%s / %s มีวันเริ่มแต่ไม่มีวันหมดอายุ' % (track_name, head or UNLABELED_EVENT)})
                if expire and not start:
                    issues.append({'surveyor_id': sid, 'field': 'registration',
                                   'issue': '%s / %s มีวันหมดอายุแต่ไม่มีวันเริ่ม' % (track_name, head or UNLABELED_EVENT)})
                if expire and start and expire < start:
                    issues.append({'surveyor_id': sid, 'field': 'registration',
                                   'issue': '%s / %s วันหมดอายุ %s มาก่อนวันเริ่ม %s — น่าจะพิมพ์ปีผิดในต้นทาง (ส่งตามต้นทาง)'
                                            % (track_name, head or UNLABELED_EVENT, expire, start)})
                if order == 0 and start:
                    first = start
                if expire and (latest is None or expire > latest):
                    latest = expire
            s[track + '_registered_date'] = first
            s[track + '_expire_date'] = latest

        for i in VISIT_COLS:
            v = num(r[i])
            if v is None:
                continue
            y, role = visit_head[i]
            visits.append({'surveyor_id': sid, 'year_be': y, 'year_ce': y - 543,
                           'role': role, 'role_name': ROLE_NAME[role], 'mandays': v})
        for i in TRAIN_COLS:
            v = num(r[i])
            if v is None:
                continue
            y = train_head[i]
            trainings.append({'surveyor_id': sid, 'year_be': y, 'year_ce': y - 543, 'trainings': v})
        surveyors.append(s)

    out = {
        'source': {'file': src.replace('\\', '/').split('/')[-1], 'sheet': 'sur',
                   'converted_at': datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds')},
        'skipped_columns': [{'column': i, 'header': h, 'reason': why} for i, (h, why) in SKIPPED.items()],
        'counts': {'surveyors': len(surveyors), 'visits': len(visits),
                   'trainings': len(trainings), 'registrations': len(regs)},
        'surveyors': surveyors, 'visits': visits, 'trainings': trainings, 'registrations': regs,
        'issues': issues,
    }
    with open(dst, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False)
    print(json.dumps(out['counts'], ensure_ascii=False))
    print('issues', len(issues))


if __name__ == '__main__':
    if len(sys.argv) != 3:
        sys.exit('ใช้: python -I scripts/convert-surveyors.py <ไฟล์.xlsx> <ผลลัพธ์.json>')
    main(sys.argv[1], sys.argv[2])
