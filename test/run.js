/**
 * run.js — ชุดทดสอบตรรกะหลักของ CWK DutyFlow
 * รัน: node test/run.js
 */
const { loadAll } = require('./harness');

let pass = 0, fail = 0;
const failures = [];

function eq(name, actual, expected) {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a === b) { pass++; return; }
  fail++;
  failures.push(name + '\n    ได้:      ' + a + '\n    ควรได้: ' + b);
}
function ok(name, cond, detail) {
  if (cond) { pass++; return; }
  fail++;
  failures.push(name + (detail ? '\n    ' + detail : ''));
}
function throws(name, fn, contains) {
  try {
    fn();
    fail++; failures.push(name + '\n    ควร throw แต่ไม่ throw');
  } catch (e) {
    if (contains && String(e.message).indexOf(contains) < 0) {
      fail++; failures.push(name + '\n    ข้อความผิด: ' + e.message);
    } else pass++;
  }
}
function section(t) { console.log('\n── ' + t); }

const G = loadAll({ _props: { SPREADSHEET_ID: 'x' }, _email: 'admin@test.ac.th' });

/* ================= 1. ตัวช่วยพื้นฐาน ================= */
section('1. Utils');
eq('num ค่าว่างคืนค่า default', G.num('', 5), 5);
eq('num null คืนค่า default', G.num(null, 7), 7);
eq('num 0 คืน 0', G.num(0, 9), 0);
eq('num ข้อความตัวเลข', G.num('12.5'), 12.5);
eq('str ตัดช่องว่าง', G.str('  ก  '), 'ก');
eq('bool รองรับภาษาไทย', G.bool('ใช่'), true);
eq('bool TRUE', G.bool('TRUE'), true);
eq('bool ค่าว่างใช้ default', G.bool('', true), true);
eq('mod ให้ผลบวกเสมอ', G.mod(-1, 5), 4);
eq('mod ปกติ', G.mod(7, 5), 2);
eq('mod หารศูนย์', G.mod(3, 0), 0);
eq('sanitizeText ลบอักขระควบคุม', G.sanitizeText('ก\u0001ข\u001Fค'), 'กขค');
eq('sanitizeText คงข้อความไทย', G.sanitizeText('ครูสมชาย ใจดี'), 'ครูสมชาย ใจดี');
eq('truncate', G.truncate('abcdefghij', 5), 'abcd…');
eq('isEmail ถูกต้อง', G.isEmail('a@b.ac.th'), true);
eq('isEmail ผิด', G.isEmail('a@b'), false);
eq('pct', G.pct(1, 3), 33.3);
eq('pct หารศูนย์', G.pct(1, 0), 0);

section('2. วันที่และ พ.ศ.');
eq('toDateStr เติมศูนย์', G.toDateStr('2026-9-5'), '2026-09-05');
eq('weekdayOf จันทร์', G.weekdayOf('2026-09-28'), 1);
eq('weekdayOf ศุกร์', G.weekdayOf('2026-10-02'), 5);
eq('weekdayOf อาทิตย์', G.weekdayOf('2026-10-04'), 7);
eq('addDays ข้ามเดือน', G.addDays('2026-09-30', 1), '2026-10-01');
eq('addDays ย้อนหลัง', G.addDays('2026-10-01', -1), '2026-09-30');
eq('diffDays', G.diffDays('2026-09-01', '2026-09-30'), 29);
eq('thaiDate แปลง พ.ศ.', G.thaiDate('2026-09-30'), '30 กันยายน 2569');
eq('thaiDate แบบย่อ', G.thaiDate('2026-09-30', { short: true }), '30 ก.ย. 2569');
eq('thaiDate พร้อมวัน', G.thaiDate('2026-09-30', { weekday: true }), 'วันพุธที่ 30 กันยายน 2569');
eq('buddhistYear', G.buddhistYear('2026-09-30'), 2569);
eq('thaiWeekday', G.thaiWeekday(4), 'พฤหัสบดี');
eq('minutesOfDay', G.minutesOfDay('07:30'), 450);
eq('minutesOfDay ผิดรูปแบบ', G.minutesOfDay('abc'), -1);
eq('hhmm จาก ISO', G.hhmm('2026-09-30T07:05:12'), '07:05');

section('3. ระยะทาง GPS');
eq('haversine จุดเดียวกัน = 0', G.haversineMeters(19.3459, 100.1389, 19.3459, 100.1389), 0);
ok('haversine 100 เมตรโดยประมาณ',
  Math.abs(G.haversineMeters(19.3459, 100.1389, 19.3468, 100.1389) - 100) < 6,
  'ได้ ' + G.haversineMeters(19.3459, 100.1389, 19.3468, 100.1389));

section('4. CSV');
eq('parseCsv พื้นฐาน', G.parseCsv('a,b\n1,2'), [['a', 'b'], ['1', '2']]);
eq('parseCsv มีเครื่องหมายคำพูด', G.parseCsv('a,"b,c"\n1,2'), [['a', 'b,c'], ['1', '2']]);
eq('parseCsv CRLF', G.parseCsv('a,b\r\n1,2'), [['a', 'b'], ['1', '2']]);
eq('parseCsv แท็บ', G.parseCsv('a\tb\n1\t2'), [['a', 'b'], ['1', '2']]);
eq('parseCsv ข้ามบรรทัดว่าง', G.parseCsv('a,b\n\n1,2\n').length, 2);

/* ================= 5. หมุนวัน ================= */
section('5. หมุนวัน จันทร์→อังคาร→...→จันทร์');
eq('จันทร์ + 1 = อังคาร', G.rotateWeekday(1, 1), 2);
eq('พฤหัสบดี + 1 = ศุกร์', G.rotateWeekday(4, 1), 5);
eq('ศุกร์ + 1 = จันทร์ (วนกลับ)', G.rotateWeekday(5, 1), 1);
eq('ศุกร์ + 2 = อังคาร', G.rotateWeekday(5, 2), 2);
eq('จันทร์ + 5 = จันทร์ (ครบรอบ)', G.rotateWeekday(1, 5), 1);
eq('จันทร์ - 1 = ศุกร์', G.rotateWeekday(1, -1), 5);
eq('เสาร์ไม่ถูกหมุน', G.rotateWeekday(6, 1), 6);
eq('ค่าผิดคืนค่าเดิม', G.rotateWeekday(0, 1), 0);
(function () {
  const seen = {};
  let w = 1;
  for (let i = 0; i < 5; i++) { seen[w] = true; w = G.rotateWeekday(w, 1); }
  eq('หมุน 5 ครั้งครบทุกวันทำการ', Object.keys(seen).map(Number).sort(), [1, 2, 3, 4, 5]);
  eq('หมุน 5 ครั้งกลับที่เดิม', w, 1);
})();

/* ================= 6. หมุนจุดภายในวัน ================= */
section('6. หมุนจุดภายในวัน');

function seats(n, opts) {
  const o = opts || {};
  const out = [];
  for (let i = 1; i <= n; i++) {
    out.push({
      id: 's' + i, teacher_id: 't' + i, seat_no: i, rotation_order: i,
      slot_id: 'AM', rotation_group: 'G1',
      rotation_scope: (o.scope && o.scope[i]) || 'BOTH',
      pin_mode: (o.pin && o.pin[i]) || 'NONE'
    });
  }
  return out;
}
const names = arr => arr.map(s => s.teacher_id);

eq('offset 0 ไม่เปลี่ยน', names(G.PR_applyToSeats_(seats(4), 0, true)), ['t1', 't2', 't3', 't4']);
eq('offset 1 เลื่อนหนึ่งตำแหน่ง', names(G.PR_applyToSeats_(seats(4), 1, true)), ['t4', 't1', 't2', 't3']);
eq('offset 2', names(G.PR_applyToSeats_(seats(4), 2, true)), ['t3', 't4', 't1', 't2']);
eq('offset ครบรอบกลับที่เดิม', names(G.PR_applyToSeats_(seats(4), 4, true)), ['t1', 't2', 't3', 't4']);
eq('offset ติดลบ', names(G.PR_applyToSeats_(seats(4), -1, true)), ['t2', 't3', 't4', 't1']);
eq('ที่นั่งเดียวไม่หมุน', names(G.PR_applyToSeats_(seats(1), 3, true)), ['t1']);

(function () {
  const r = G.PR_applyToSeats_(seats(4, { pin: { 2: 'POINT' } }), 1, true);
  eq('ปักหมุด POINT อยู่กับที่', r[1].teacher_id, 't2');
  const movedIds = [r[0].teacher_id, r[2].teacher_id, r[3].teacher_id];
  eq('ที่นั่งที่เหลือหมุนกันเอง', movedIds, ['t4', 't1', 't3']);
  ok('ไม่มีครูซ้ำในวงหมุน', new Set(names(r)).size === 4, names(r).join(','));
})();

(function () {
  const r = G.PR_applyToSeats_(seats(4, { pin: { 2: 'POINT' } }), 1, false);
  eq('ไม่เคารพปักหมุด → หมุนทุกที่นั่ง', names(r), ['t4', 't1', 't2', 't3']);
})();

(function () {
  const r = G.PR_applyToSeats_(seats(4, { scope: { 3: 'LOCKED' } }), 1, true);
  eq('LOCKED ไม่ถูกหมุน', r[2].teacher_id, 't3');
})();

(function () {
  const r = G.PR_applyToSeats_(seats(4, { scope: { 2: 'DAY_ONLY' } }), 1, true);
  eq('DAY_ONLY ไม่เข้าวงหมุนจุด', r[1].teacher_id, 't2');
})();

(function () {
  const r = G.PR_applyToSeats_(seats(4, { pin: { 1: 'DAY' } }), 1, true);
  eq('ปักหมุด DAY ยังหมุนจุดได้', r[0].teacher_id, 't4');
})();

(function () {
  const all = seats(3, { pin: { 1: 'ALL', 2: 'ALL', 3: 'ALL' } });
  eq('ปักหมุดทั้งหมด → ไม่มีอะไรเปลี่ยน', names(G.PR_applyToSeats_(all, 1, true)), ['t1', 't2', 't3']);
})();

(function () {
  // ลำดับวงหมุนต้องยึด rotation_order ไม่ใช่ลำดับใน array
  const s = seats(3);
  s[0].rotation_order = 3; s[1].rotation_order = 1; s[2].rotation_order = 2;
  const r = G.PR_applyToSeats_(s, 1, true);
  // วงหมุน: t2(1) -> t3(2) -> t1(3); เลื่อน 1: t2 ได้ t1, t3 ได้ t2, t1 ได้ t3
  eq('เรียงตาม rotation_order', [r[0].teacher_id, r[1].teacher_id, r[2].teacher_id], ['t3', 't1', 't2']);
})();

(function () {
  // แยกวงหมุนตาม slot + rotation_group
  const list = [
    { id: 'a', teacher_id: 'A', slot_id: 'AM', rotation_group: 'G1', rotation_order: 1, seat_no: 1 },
    { id: 'b', teacher_id: 'B', slot_id: 'AM', rotation_group: 'G1', rotation_order: 2, seat_no: 2 },
    { id: 'c', teacher_id: 'C', slot_id: 'PM', rotation_group: 'G1', rotation_order: 1, seat_no: 1 },
    { id: 'd', teacher_id: 'D', slot_id: 'PM', rotation_group: 'G1', rotation_order: 2, seat_no: 2 },
    { id: 'e', teacher_id: 'E', slot_id: 'AM', rotation_group: 'G2', rotation_order: 1, seat_no: 1 }
  ];
  const r = G.PR_applyToDay_(list, 1, true);
  eq('คงลำดับเดิมของ array', r.map(x => x.id), ['a', 'b', 'c', 'd', 'e']);
  eq('วง AM/G1 สลับกัน', [r[0].teacher_id, r[1].teacher_id], ['B', 'A']);
  eq('วง PM/G1 สลับกัน', [r[2].teacher_id, r[3].teacher_id], ['D', 'C']);
  eq('วง AM/G2 มีคนเดียวไม่หมุน', r[4].teacher_id, 'E');
})();

(function () {
  // ไม่มีครูหายหรือซ้ำไม่ว่า offset เท่าไร
  for (let off = 0; off < 12; off++) {
    const r = G.PR_applyToSeats_(seats(7, { pin: { 3: 'POINT', 6: 'ALL' } }), off, true);
    const set = new Set(names(r));
    if (set.size !== 7) {
      ok('offset ' + off + ' ครูไม่ซ้ำ/ไม่หาย', false, names(r).join(','));
      return;
    }
  }
  ok('ทุก offset 0-11 ครูไม่ซ้ำและไม่หาย', true);
})();

section('7. โหมดการหมุนจุด');
eq('โหมดเริ่มต้นจากค่า config', G.PR_mode_(), 'WEEKLY');
ok('มีครบ 5 โหมด', Object.keys(G.PR_MODES).length === 5, Object.keys(G.PR_MODES).join(','));
eq('mondayOf วันพุธ', G.PR_mondayOf_('2026-09-30'), '2026-09-28');
eq('mondayOf วันจันทร์', G.PR_mondayOf_('2026-09-28'), '2026-09-28');
eq('weekIndex สัปดาห์แรก = 0',
  G.PR_weekIndex_('2026-09-30', { start_date: '2026-09-28' }), 0);
eq('weekIndex สัปดาห์ถัดไป = 1',
  G.PR_weekIndex_('2026-10-06', { start_date: '2026-09-28' }), 1);
eq('weekIndex ข้าม 3 สัปดาห์',
  G.PR_weekIndex_('2026-10-19', { start_date: '2026-09-28' }), 3);

section('8. บทบาทและระดับการอนุมัติ');
eq('หัวหน้าเวรประจำวัน = ระดับ 1', G.AUTH_approvalLevel('DAILY_HEAD'), 1);
eq('หัวหน้างานเวร = ระดับ 2', G.AUTH_approvalLevel('DUTY_ADMIN'), 2);
eq('ผู้บริหาร = ระดับ 3', G.AUTH_approvalLevel('EXECUTIVE'), 3);
eq('ผู้ดูแลระบบ = ระดับ 3', G.AUTH_approvalLevel('SYS_ADMIN'), 3);
eq('ครูธรรมดา = ระดับ 0', G.AUTH_approvalLevel('TEACHER'), 0);
eq('ชื่อระดับ 1', G.AUTH_approvalLevelName(1), 'หัวหน้าเวรประจำวัน');
eq('ชื่อระดับ 3', G.AUTH_approvalLevelName(3), 'ผู้บริหาร');
eq('ชื่อระดับ 0 = ว่าง', G.AUTH_approvalLevelName(0), '');
eq('มี 5 บทบาท', Object.keys(G.ROLES).length, 5);
ok('ลำดับสิทธิ์ถูกต้อง',
  G.ROLES.SYS_ADMIN.level > G.ROLES.EXECUTIVE.level &&
  G.ROLES.EXECUTIVE.level > G.ROLES.DUTY_ADMIN.level &&
  G.ROLES.DUTY_ADMIN.level > G.ROLES.DAILY_HEAD.level &&
  G.ROLES.DAILY_HEAD.level > G.ROLES.TEACHER.level);

section('9. การตรวจสิทธิ์');
// ctx จริงสร้างโดยเซิร์ฟเวอร์และมี AUTH_SEAL เสมอ
const seal = c => Object.assign({ _seal: G.AUTH_SEAL }, c);
const ctxTeacher = seal({ ok: true, role: 'TEACHER', level: 1, teacherId: 't1', roleName: 'ครู' });
const ctxHead = seal({ ok: true, role: 'DAILY_HEAD', level: 2, teacherId: 't2', roleName: 'หัวหน้าเวร' });
const ctxAdmin = seal({ ok: true, role: 'DUTY_ADMIN', level: 3, teacherId: 't3', roleName: 'หัวหน้างานเวร' });
throws('ครูเรียก requireAdmin ไม่ได้', () => G.AUTH_requireAdmin(ctxTeacher), 'สิทธิ์ไม่เพียงพอ');
throws('หัวหน้าเวรเรียก requireAdmin ไม่ได้', () => G.AUTH_requireAdmin(ctxHead), 'สิทธิ์ไม่เพียงพอ');
ok('หัวหน้างานเวรเรียก requireAdmin ได้', !!G.AUTH_requireAdmin(ctxAdmin));
ok('หัวหน้าเวรเป็น reviewer ได้', !!G.AUTH_requireReviewer(ctxHead));
throws('ครูไม่ใช่ reviewer', () => G.AUTH_requireReviewer(ctxTeacher), 'สิทธิ์ไม่เพียงพอ');
throws('ผู้ไม่ผ่านการยืนยันตัวตน', () => G.AUTH_require(seal({ ok: false, reason: 'ยังไม่เข้าสู่ระบบ' })), 'ยังไม่เข้าสู่ระบบ');
throws('ctx ที่ไม่ได้สร้างโดยเซิร์ฟเวอร์ถูกปฏิเสธ',
  () => G.AUTH_requireAdmin({ ok: true, role: 'SYS_ADMIN', level: 5, roleName: 'ผู้ดูแลระบบ' }), 'กรุณาเข้าสู่ระบบ');
eq('ครูไม่เห็นข้อมูลคนอื่น', G.AUTH_canSeeOthers(ctxTeacher), false);
eq('หัวหน้าเวรเห็นข้อมูลคนอื่น', G.AUTH_canSeeOthers(ctxHead), true);
ok('เมนูครูมี 2 รายการ', G.AUTH_menuFor(ctxTeacher).length === 2, JSON.stringify(G.AUTH_menuFor(ctxTeacher)));
ok('เมนูหัวหน้าเวรมีหน้าจัดเวร',
  G.AUTH_menuFor(ctxHead).some(m => m.key === 'assign'));
ok('เมนูหัวหน้าเวรไม่มีหน้าตั้งค่า',
  !G.AUTH_menuFor(ctxHead).some(m => m.key === 'settings'));
ok('เมนูหัวหน้างานเวรมีหน้าตั้งค่า',
  G.AUTH_menuFor(ctxAdmin).some(m => m.key === 'settings'));
ok('เมนูไม่มีคีย์ซ้ำ (ผู้บริหาร)', (function () {
  const m = G.AUTH_menuFor({ ok: true, role: 'EXECUTIVE', level: 4 }).map(x => x.key);
  return new Set(m).size === m.length;
})());

section('10. ข้อความผิดพลาดต้องไม่ว่าง');
ok('Error ปกติ', G.API_errorMessage_(new Error('ทดสอบ')) === 'ทดสอบ');
ok('Error ว่างได้ข้อความมาตรฐาน', G.API_errorMessage_(new Error('')).length > 20);
ok('null ได้ข้อความมาตรฐาน', G.API_errorMessage_(null).length > 20);
ok('undefined ได้ข้อความมาตรฐาน', G.API_errorMessage_(undefined).length > 20);
ok('object ว่างได้ข้อความมาตรฐาน', G.API_errorMessage_({}).length > 20);
ok('ตัด prefix Error:', G.API_errorMessage_('Error: ผิดพลาด') === 'ผิดพลาด');
ok('แปลข้อความ timeout',
  G.API_errorMessage_(new Error('Exceeded maximum execution time')).indexOf('ใช้เวลานานเกิน') >= 0);
ok('แปลข้อความสิทธิ์',
  G.API_errorMessage_(new Error('You do not have permission')).indexOf('ไม่มีสิทธิ์') >= 0);

section('11. ตารางเส้นทาง API');
const routes = G.API_ROUTES_();
const routeKeys = Object.keys(routes);
ok('มี action มากกว่า 60 รายการ', routeKeys.length > 60, 'มี ' + routeKeys.length);
ok('ทุก route เป็นฟังก์ชัน', routeKeys.every(k => typeof routes[k] === 'function'));
['ping', 'bootstrap', 'today.summary', 'schedule.adjust', 'pin.set',
 'rotation.pointPreview', 'report.daily', 'report.group', 'report.drill',
 'system.selfTest', 'system.repair'].forEach(k => {
  ok('มี route ' + k, routeKeys.indexOf(k) >= 0);
});

section('12. สคีมาฐานข้อมูล');
eq('มี 14 ตาราง', G.DB_TABLES.length, 14);
G.DB_TABLES.forEach(t => {
  const def = G.DB_SCHEMA[t];
  ok(t + ' มี id เป็นคอลัมน์แรก', def.columns[0] === 'id', def.columns[0]);
  ok(t + ' ไม่มีคอลัมน์ซ้ำ', new Set(def.columns).size === def.columns.length);
  ok(t + ' มีชื่อชีต', !!def.sheet);
});
['pin_mode', 'pin_reason', 'pin_by', 'pin_at'].forEach(c => {
  ok('ASSIGNMENTS มีคอลัมน์ ' + c, G.DB_SCHEMA.ASSIGNMENTS.columns.indexOf(c) >= 0);
});
['original_teacher_id', 'effective_teacher_id', 'source', 'point_rotation_offset'].forEach(c => {
  ok('DAILY_SCHEDULE มีคอลัมน์ ' + c, G.DB_SCHEMA.DAILY_SCHEDULE.columns.indexOf(c) >= 0);
});
['approver_role', 'approval_level'].forEach(c => {
  ok('SWAP_REQUESTS มีคอลัมน์ ' + c, G.DB_SCHEMA.SWAP_REQUESTS.columns.indexOf(c) >= 0);
});

section('13. กฎเหล็ก: ห้ามเขียนทับ original_teacher_id');
(function () {
  const fs = require('fs');
  const path = require('path');
  const dir = path.join(__dirname, '..', 'src');
  const offenders = [];
  fs.readdirSync(dir).filter(f => f.endsWith('.gs')).forEach(f => {
    const code = fs.readFileSync(path.join(dir, f), 'utf8');
    const re = /db(?:Update|UpdateMany)\(\s*'DAILY_SCHEDULE'[\s\S]{0,600}?\}\s*\)/g;
    let m;
    while ((m = re.exec(code)) !== null) {
      if (/(^|[^_\w])original_teacher_id\s*:/.test(m[0])) offenders.push(f);
    }
  });
  eq('ไม่มีจุดใดเขียนทับ original_teacher_id', offenders, []);
})();
(function () {
  const fs = require('fs');
  const path = require('path');
  const code = fs.readFileSync(path.join(__dirname, '..', 'src', 'ScheduleService.gs'), 'utf8');
  ok('SCHEDULE_adjustDaily เปลี่ยนเฉพาะ effective_teacher_id',
    /effective_teacher_id:\s*newT\.id/.test(code));
  ok('การปรับเวรบันทึกลง SWAP_REQUESTS พร้อมผู้อนุมัติ',
    /approval_level:\s*level/.test(code) && /approver_role:\s*ctx\.role/.test(code));
  ok('หัวหน้าเวรปรับย้อนหลังถูกจำกัด', /daily_adjust_backdays/.test(code));
  ok('ห้ามปรับเวรที่เช็คอินแล้ว', /มีการบันทึกการอยู่เวรของที่นั่งนี้ไปแล้ว/.test(code));
})();

section('14. การจัดกลุ่มรายงาน');
eq('มี 5 มิติการจัดกลุ่ม', Object.keys(G.GROUP_DIMENSIONS).length, 5);
['DEPARTMENT', 'DUTY_POINT', 'TIME_SLOT', 'WEEKDAY', 'ROLE'].forEach(d => {
  ok('มีมิติ ' + d, !!G.GROUP_DIMENSIONS[d]);
  ok('keyFn ของ ' + d + ' ใช้งานได้', typeof G.REPORT_groupKeyFn_(d) === 'function');
});
(function () {
  const rows = [
    { department: 'วิทย์', pointName: 'ประตูหน้า', slotName: 'เช้า', weekday: 1, role: 'TEACHER',
      attend: 'PRESENT', evidence: 'FULL', changed: false, photoCount: 1, incidentCount: 0, status: 'SCHEDULED' },
    { department: 'วิทย์', pointName: 'ประตูหลัง', slotName: 'เช้า', weekday: 1, role: 'TEACHER',
      attend: 'ABSENT', evidence: 'NONE', changed: false, photoCount: 0, incidentCount: 0, status: 'SCHEDULED' },
    { department: 'คณิต', pointName: 'ประตูหน้า', slotName: 'เย็น', weekday: 2, role: 'TEACHER',
      attend: 'LATE', evidence: 'PARTIAL', changed: true, photoCount: 1, incidentCount: 1, status: 'SCHEDULED' }
  ];
  const s = G.REPORT_summarize_(rows);
  eq('สรุป total', s.total, 3);
  eq('สรุป present', s.present, 1);
  eq('สรุป absent', s.absent, 1);
  eq('สรุป late', s.late, 1);
  eq('สรุป changed', s.changed, 1);
  eq('อัตราการปฏิบัติงาน', s.attendRate, 66.7);

  ['DEPARTMENT', 'DUTY_POINT', 'TIME_SLOT', 'WEEKDAY', 'ROLE'].forEach(dim => {
    const keyFn = G.REPORT_groupKeyFn_(dim);
    const groups = G.groupBy(rows, keyFn);
    const total = Object.keys(groups).reduce((a, k) => a + groups[k].length, 0);
    eq('ยอดรวมทุกกลุ่มของมิติ ' + dim + ' เท่ากับทั้งหมด', total, rows.length);
  });
})();

section('15. ค่าตั้งค่าและตัวเลือก');
ok('มีค่าตั้งค่าอย่างน้อย 30 รายการ', Object.keys(G.CFG_DEFAULTS).length >= 30,
  'มี ' + Object.keys(G.CFG_DEFAULTS).length);
['point_rotation_mode', 'point_rotation_n_days', 'point_rotation_respect_pin',
 'attendance_group_default', 'evidence_min_photos', 'late_grace_minutes',
 'daily_adjust_backdays', 'school_domain'].forEach(k => {
  ok('มีค่าตั้งค่า ' + k, !!G.CFG_DEFAULTS[k]);
});
Object.keys(G.CFG_DEFAULTS).forEach(k => {
  const d = G.CFG_DEFAULTS[k];
  ok('ค่าตั้งค่า ' + k + ' มี label/group/type', !!d.l && !!d.g && !!d.t);
});
eq('โหมดหมุนจุดเริ่มต้น', G.CFG_DEFAULTS.point_rotation_mode.v, 'WEEKLY');
eq('มิติจัดกลุ่มเริ่มต้น', G.CFG_DEFAULTS.attendance_group_default.v, 'DEPARTMENT');
eq('มี 4 โหมดปักหมุด', Object.keys(G.PIN_MODES).length, 4);
eq('มี 5 ขอบเขตการหมุน', Object.keys(G.ROTATION_SCOPES).length, 5);
eq('มี 6 สถานะ GPS', Object.keys(G.GEO_STATUS).length, 6);
eq('มี 4 ประเภทวันในปฏิทิน', Object.keys(G.DAY_TYPES).length, 4);
eq('มี 4 ประเภทคำขอเปลี่ยนเวร', Object.keys(G.SWAP_TYPES).length, 4);
eq('มี 5 สถานะคำขอ', Object.keys(G.SWAP_STATUS).length, 5);

section('16. ป้ายสถานะภาษาไทย');
eq('PRESENT', G.SCHEDULE_attendLabel_('PRESENT'), 'อยู่ครบ');
eq('LATE', G.SCHEDULE_attendLabel_('LATE'), 'สาย');
eq('PARTIAL', G.SCHEDULE_attendLabel_('PARTIAL'), 'อยู่ไม่ครบ');
eq('ABSENT', G.SCHEDULE_attendLabel_('ABSENT'), 'ไม่อยู่');
eq('หลักฐานครบ', G.SCHEDULE_evidenceLabel_('FULL'), 'หลักฐานครบ');
eq('ไม่มีหลักฐาน', G.SCHEDULE_evidenceLabel_('NONE'), 'ไม่มีหลักฐาน');
eq('ป้ายประเภทคำขอ', G.SWAP_typeLabel_('HEAD_ADJUST'), 'หัวหน้าเวรปรับครูประจำจุด');

section('17. ประเมินพิกัด');
(function () {
  const point = { lat: 19.3459, lng: 100.1389, radius_m: 80 };
  eq('อยู่ในรัศมี', G.CHECKIN_evaluateGeo_(point, 19.3459, 100.1389, 10).status, 'IN_RANGE');
  eq('ไม่มีพิกัด', G.CHECKIN_evaluateGeo_(point, null, null, 0).status, 'NO_GPS');
  const far = G.CHECKIN_evaluateGeo_(point, 19.3559, 100.1389, 10);
  eq('อยู่นอกพื้นที่', far.status, 'OUT_OF_RANGE');
  ok('คำนวณระยะทางได้', far.distance > 1000, String(far.distance));
  const near = G.CHECKIN_evaluateGeo_(point, 19.34695, 100.1389, 10);
  ok('อยู่ใกล้พื้นที่', ['NEAR', 'IN_RANGE'].indexOf(near.status) >= 0, near.status);
})();

section('18. ตัวช่วยจัดกลุ่ม/เรียง');
eq('groupBy', Object.keys(G.groupBy([{ a: 1 }, { a: 2 }, { a: 1 }], x => x.a)).sort(), ['1', '2']);
eq('indexBy', G.indexBy([{ id: 'x', v: 1 }], 'id').x.v, 1);
eq('sortBy น้อยไปมาก', G.sortBy([{ n: 3 }, { n: 1 }, { n: 2 }], ['n']).map(x => x.n), [1, 2, 3]);
eq('sortBy มากไปน้อย', G.sortBy([{ n: 3 }, { n: 1 }, { n: 2 }], ['-n']).map(x => x.n), [3, 2, 1]);
eq('range', G.range(3), [0, 1, 2]);
eq('teacherFullName', G.teacherFullName({ prefix: 'นาย', first_name: 'สมชาย', last_name: 'ใจดี' }), 'นายสมชาย ใจดี');
eq('teacherFullName ค่าว่าง', G.teacherFullName(null), '');

section('19. การนำเข้าครู');
eq('แปลงบทบาทภาษาไทย', G.TEACHER_normalizeRole_('หัวหน้าเวร'), 'DAILY_HEAD');
eq('แปลงบทบาทผู้บริหาร', G.TEACHER_normalizeRole_('ผู้บริหาร'), 'EXECUTIVE');
eq('แปลงบทบาทว่าง = ครู', G.TEACHER_normalizeRole_(''), 'TEACHER');
eq('แปลงบทบาทอังกฤษ', G.TEACHER_normalizeRole_('SYS_ADMIN'), 'SYS_ADMIN');
ok('ตัวอย่างไฟล์นำเข้ามีหัวตารางไทย', G.TEACHER_importTemplate().indexOf('ชื่อผู้ใช้') >= 0 &&
  G.TEACHER_importTemplate().indexOf('รหัสผ่าน') >= 0);
['session_timeout_min', 'login_max_attempts', 'login_lock_min', 'password_min_length',
 'password_force_change'].forEach(k => ok('มีค่าตั้งค่า ' + k, !!G.CFG_DEFAULTS[k]));

/* ================= 20. รหัสผ่านและชื่อผู้ใช้ ================= */
section('20. รหัสผ่านและชื่อผู้ใช้');
const crypto = require('crypto');
(function () {
  const salt = '00112233445566778899aabbccddeeff';
  const h = G.AUTH_hashPassword('ครูสมชาย#2569', salt, 1000);
  const parts = h.split('$');
  eq('รูปแบบ hash', parts.slice(0, 3), ['pbkdf2_sha256', '1000', salt]);
  eq('ตรงกับ PBKDF2-HMAC-SHA256 มาตรฐาน (Node crypto)', parts[3],
    crypto.pbkdf2Sync('ครูสมชาย#2569', Buffer.from(salt, 'hex'), 1000, 32, 'sha256').toString('hex'));
  ok('รหัสผ่านถูกต้อง', G.AUTH_verifyPassword('ครูสมชาย#2569', h));
  ok('รหัสผ่านผิด', !G.AUTH_verifyPassword('ครูสมชาย#2568', h));
  ok('รหัสผ่านว่าง', !G.AUTH_verifyPassword('', h));
  ok('hash เสีย', !G.AUTH_verifyPassword('x', 'garbage'));
  ok('ไม่มี hash', !G.AUTH_verifyPassword('x', ''));
  ok('hash ถูกแก้ไข', !G.AUTH_verifyPassword('ครูสมชาย#2569', h.slice(0, -1) + (h.slice(-1) === '0' ? '1' : '0')));
  const a = G.AUTH_hashPassword('same-pass'), b = G.AUTH_hashPassword('same-pass');
  ok('salt สุ่มทุกครั้ง', a !== b);
  ok('ใช้จำนวนรอบค่าเริ่มต้น', a.split('$')[1] === String(G.AUTH_PW_ITER));
  throws('ห้าม hash รหัสผ่านว่าง', () => G.AUTH_hashPassword(''), 'ว่าง');
})();
(function () {
  const seen = new Set();
  for (let i = 0; i < 30; i++) {
    const p = G.AUTH_tempPassword_();
    if (p.length < 8 || /[^abcdefghjkmnpqrstuvwxyz23456789]/.test(p)) {
      ok('รหัสผ่านชั่วคราวรูปแบบถูกต้อง', false, p);
      return;
    }
    seen.add(p);
  }
  ok('รหัสผ่านชั่วคราวยาว ≥ 8 และไม่มีตัวที่สับสน', true);
  ok('รหัสผ่านชั่วคราวไม่ซ้ำกัน', seen.size === 30);
})();
eq('ชื่อผู้ใช้ถูกต้อง', G.AUTH_usernameProblem('somchai.j'), '');
eq('ชื่อผู้ใช้แปลงเป็นตัวเล็กและตัดช่องว่าง', G.AUTH_normalizeUsername('  SomChai '), 'somchai');
ok('ชื่อผู้ใช้สั้นเกิน', G.AUTH_usernameProblem('ab') !== '');
ok('ชื่อผู้ใช้ภาษาไทยไม่ได้', G.AUTH_usernameProblem('สมชาย') !== '');
ok('ชื่อผู้ใช้ขึ้นต้นด้วยตัวเลขไม่ได้ (ชีตจะแปลงเป็นตัวเลข)', G.AUTH_usernameProblem('001') !== '');
ok('ชื่อผู้ใช้มีช่องว่างไม่ได้', G.AUTH_usernameProblem('som chai') !== '');
ok('ชื่อผู้ใช้ว่างไม่ได้', G.AUTH_usernameProblem('') !== '');
eq('รหัสผ่านผ่านนโยบาย', G.AUTH_passwordProblems('abc123', 'somchai'), []);
eq('รหัสผ่านสั้นเกิน', G.AUTH_passwordProblems('abc', 'somchai').length, 1);
eq('รหัสผ่านเหมือนชื่อผู้ใช้', G.AUTH_passwordProblems('Somchai', 'somchai').length, 1);
eq('รหัสผ่านมีช่องว่างท้าย', G.AUTH_passwordProblems('abc123 ', 'x').length, 1);
eq('แนะนำชื่อผู้ใช้จากอีเมล', G.TEACHER_suggestUsername_({ email: 'Somchai.J@school.ac.th', code: 'T001' }), 'somchai.j');
eq('แนะนำชื่อผู้ใช้จากรหัสครู', G.TEACHER_suggestUsername_({ email: '', code: 'T001' }), 't001');
eq('รหัสครูเป็นตัวเลขเติม t นำหน้า', G.TEACHER_suggestUsername_({ code: '0042' }), 't0042');
eq('ชื่อผู้ใช้ซ้ำเติมตัวเลขต่อท้าย', G.TEACHER_uniqueUsername_('somchai', { somchai: true, somchai2: true }), 'somchai3');
ok('ประวัติไม่เก็บ password_hash', (function () {
  const v = G.TEACHER_auditView_({ id: 'x', username: 'a', password_hash: 'pbkdf2_sha256$1$aa$bb' });
  return v.password_hash === undefined && v.password_set === true && v.username === 'a';
})());

/* ================= 21. กันการเรียกฟังก์ชันโดยตรง ================= */
section('21. กันการเรียกฟังก์ชันฝั่ง Server โดยตรงจากหน้าเว็บ');
(function () {
  // ผู้เยี่ยมชมเว็บแอปที่ไม่ได้ลงชื่อเข้า Google: อ่านอีเมลไม่ได้ ส่วนสคริปต์รันในนามเจ้าของ
  const W = loadAll({ _props: { SPREADSHEET_ID: 'x' }, _sheets: {}, _email: '', _effectiveEmail: 'owner@school.test', _quiet: true });
  throws('อ่านตารางโดยตรงไม่ได้', () => W.dbReadAll('TEACHERS'), 'ไม่อนุญาต');
  throws('เขียนตารางโดยตรงไม่ได้', () => W.dbUpdate('TEACHERS', 'x', { role: 'SYS_ADMIN' }), 'ไม่อนุญาต');
  throws('อ่าน Script Properties ไม่ได้', () => W.PROP_get('SPREADSHEET_ID'), 'ไม่อนุญาต');
  throws('เขียนแคชโดยตรงไม่ได้', () => W.CACHE_put('sess:x', {}), 'ไม่อนุญาต');
  const forged = { ok: true, role: 'SYS_ADMIN', level: 5, teacherId: 'x', roleName: 'ผู้ดูแลระบบ' };
  throws('ctx ปลอมเรียกบริการไม่ได้', () => W.TEACHER_save(forged, { firstName: 'a' }), 'กรุณาเข้าสู่ระบบ');
  throws('ctx ปลอมดูภาพไม่ได้', () => W.PHOTO_data(forged, 'x'), 'กรุณาเข้าสู่ระบบ');
  throws('ผู้เยี่ยมชมรัน ติดตั้งระบบ ไม่ได้', () => W['ติดตั้งระบบ'](), 'เจ้าของสคริปต์');
  throws('ผู้เยี่ยมชมรีเซ็ตรหัสผ่านผู้ดูแลไม่ได้', () => W['รีเซ็ตรหัสผ่านผู้ดูแลระบบ'](), 'เจ้าของสคริปต์');
  throws('ผู้เยี่ยมชมซ่อมข้อมูลไม่ได้', () => W['ซ่อมข้อมูล'](), 'เจ้าของสคริปต์');
  throws('ผู้เยี่ยมชมล้างแคชไม่ได้', () => W['ล้างแคช'](), 'เจ้าของสคริปต์');

  const r = W.api('teacher.list', {}, '');
  eq('api ต้องเข้าสู่ระบบก่อน', [r.ok, r.code], [false, 'AUTH_REQUIRED']);
  const r2 = W.api('constructor', {}, '');
  ok('ชื่อคำสั่งแปลก ๆ ไม่หลุดไปถึง Object', r2.ok === false && /ไม่รู้จักคำสั่ง/.test(r2.error), r2.error);
  const b = W.api('bootstrap', {}, '');
  ok('bootstrap แจ้งให้เข้าสู่ระบบ', b.ok && b.data.authorized === false && b.data.loginRequired === true);
  ok('bootstrap ก่อนเข้าสู่ระบบไม่มีข้อมูลผู้ใช้', !b.data.user && !b.data.menu);
  const bad = W.api('bootstrap', {}, 'f'.repeat(64));
  eq('token ปลอมถือว่าหมดอายุ', bad.data.reasonCode, 'SESSION_EXPIRED');
})();
(function () {
  const store = { _props: {}, _email: '', _effectiveEmail: 'owner@school.test' };
  eq('งานอัตโนมัติที่ถูกเรียกจากภายนอกทำได้ครั้งแรกของวัน', loadAll(store).EXEC_beginJob_('REMIND'), true);
  eq('ถูกเรียกซ้ำในวันเดียวกันไม่ทำงาน', loadAll(store).EXEC_beginJob_('REMIND'), false);
  store._email = 'owner@school.test';
  eq('เจ้าของสคริปต์ (ทริกเกอร์) ทำงานได้เสมอ', loadAll(store).EXEC_beginJob_('REMIND'), true);
})();

/* ================= 22. เข้าสู่ระบบครบวงจร ================= */
section('22. เข้าสู่ระบบด้วยชื่อผู้ใช้และรหัสผ่าน (ครบวงจร)');

/** ระบบจำลองบนสเปรดชีตในหน่วยความจำ — ทุกคำขอโหลดโค้ดใหม่เหมือนการประมวลผลจริงของ Apps Script */
function makeSystem(sheets) {
  const store = { _props: { PHOTO_FOLDER_ID: 'p', REPORT_FOLDER_ID: 'r' }, _sheets: sheets || {}, _email: 'owner@school.test', _quiet: true };
  const fresh = () => loadAll(store);
  return {
    store, fresh,
    api: (a, p, t) => fresh().api(a, p || {}, t || ''),
    rows: table => { const S = fresh(); S.EXEC_trust_(); return S.dbReadAll(table); },
    login: function (u, p) { const r = this.api('auth.login', { username: u, password: p }); return r.ok ? r.data.token : ''; }
  };
}
function credsOf(msg) {
  const m = /ชื่อผู้ใช้: (\S+)[\s\S]*รหัสผ่านชั่วคราว: (\S+)/.exec(msg);
  return m ? { username: m[1], password: m[2] } : null;
}

(function () {
  const sys = makeSystem();
  const api = sys.api;
  const setupMsg = sys.fresh()['ติดตั้งระบบ']();
  const admin = credsOf(setupMsg);
  ok('ติดตั้งระบบสร้างบัญชีผู้ดูแลพร้อมรหัสผ่านชั่วคราว', !!admin, setupMsg);
  if (!admin) return;
  eq('ชื่อผู้ใช้ผู้ดูแลเริ่มต้น', admin.username, 'admin');
  const adminRow = sys.rows('TEACHERS').find(t => t.username === 'admin');
  ok('เก็บรหัสผ่านเป็น hash เท่านั้น', adminRow && /^pbkdf2_sha256\$/.test(adminRow.password_hash) &&
    adminRow.password_hash.indexOf(admin.password) < 0);
  ok('ผู้ดูแลต้องตั้งรหัสผ่านใหม่ครั้งแรก', adminRow && adminRow.must_change_password === 'TRUE');
  ok('รันติดตั้งซ้ำไม่สร้างผู้ดูแลเพิ่ม', /มีผู้ดูแลระบบที่เข้าสู่ระบบได้แล้ว/.test(sys.fresh()['ติดตั้งระบบ']()) &&
    sys.rows('TEACHERS').length === 1);

  let r = api('auth.login', { username: 'admin', password: 'wrong-pass' });
  eq('รหัสผ่านผิด', [r.ok, r.code], [false, 'LOGIN_FAILED']);
  ok('ข้อความไม่บอกว่าผิดที่ชื่อผู้ใช้หรือรหัสผ่าน', /ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง/.test(r.error), r.error);
  r = api('auth.login', { username: 'nobody', password: 'wrong-pass' });
  ok('ชื่อผู้ใช้ที่ไม่มีอยู่ได้ข้อความเดียวกัน', /ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง/.test(r.error), r.error);
  r = api('auth.login', { username: 'admin', password: '' });
  ok('ไม่กรอกรหัสผ่าน', !r.ok && /กรุณากรอก/.test(r.error));

  r = api('auth.login', { username: ' ADMIN ', password: admin.password });
  ok('เข้าสู่ระบบสำเร็จ (ไม่สนตัวพิมพ์ใหญ่และช่องว่าง)', r.ok, r.error);
  if (!r.ok) return;
  const tok = r.data.token;
  ok('token สุ่มยาว 64 ตัว', /^[0-9a-f]{64}$/.test(tok));
  eq('ข้อมูลผู้ใช้หลังเข้าสู่ระบบ',
    [r.data.boot.authorized, r.data.boot.user.username, r.data.boot.user.role, r.data.boot.user.mustChangePassword],
    [true, 'admin', 'SYS_ADMIN', true]);

  r = api('teacher.list', {}, tok);
  eq('ต้องตั้งรหัสผ่านใหม่ก่อนใช้งาน', r.code, 'MUST_CHANGE_PASSWORD');
  r = api('auth.changePassword', { currentPassword: 'nope', newPassword: 'Admin#2569' }, tok);
  ok('รหัสผ่านปัจจุบันผิด', !r.ok && /ปัจจุบันไม่ถูกต้อง/.test(r.error), r.error);
  r = api('auth.changePassword', { currentPassword: admin.password, newPassword: '123' }, tok);
  ok('รหัสผ่านใหม่สั้นเกิน', !r.ok && /อย่างน้อย 6/.test(r.error), r.error);
  r = api('auth.changePassword', { currentPassword: admin.password, newPassword: admin.password }, tok);
  ok('รหัสผ่านใหม่ซ้ำรหัสเดิม', !r.ok && /ไม่ซ้ำกับรหัสผ่านเดิม/.test(r.error), r.error);
  r = api('auth.changePassword', { currentPassword: admin.password, newPassword: 'Admin#2569' }, tok);
  ok('เปลี่ยนรหัสผ่านสำเร็จ', r.ok, r.error);
  r = api('teacher.list', {}, tok);
  ok('เซสชันเดิมใช้ต่อได้หลังเปลี่ยนรหัสผ่าน', r.ok, r.error);
  ok('รายชื่อครูไม่ส่ง hash ออกไป', r.ok && JSON.stringify(r.data).indexOf('pbkdf2') < 0);
  ok('ใช้รหัสผ่านชั่วคราวเดิมไม่ได้แล้ว', !sys.login('admin', admin.password));
  const otherTok = sys.login('admin', 'Admin#2569');
  ok('เข้าด้วยรหัสผ่านใหม่ได้', !!otherTok);

  // ผู้ดูแลเพิ่มครู
  r = api('teacher.save', { firstName: 'สมชาย', lastName: 'ใจดี', username: 'SomChai', role: 'TEACHER' }, tok);
  ok('เพิ่มครูโดยไม่กรอกรหัสผ่านได้รหัสผ่านชั่วคราว', r.ok && !!r.data.tempPassword && r.data.username === 'somchai', r.error);
  const somId = r.data.id, somTemp = r.data.tempPassword;
  r = api('teacher.save', { firstName: 'ซ้ำ', lastName: 'ซ้ำ', username: 'somchai' }, tok);
  ok('ชื่อผู้ใช้ซ้ำถูกปฏิเสธ', !r.ok && /ถูกใช้แล้ว/.test(r.error), r.error);
  r = api('teacher.save', { firstName: 'ไม่มี', lastName: 'ชื่อผู้ใช้' }, tok);
  ok('ต้องกรอกชื่อผู้ใช้', !r.ok && /กรุณากรอกชื่อผู้ใช้/.test(r.error), r.error);
  r = api('teacher.save', { firstName: 'สมหญิง', lastName: 'ตั้งใจ', username: 'somying', password: 'Somying#1', role: 'DAILY_HEAD' }, tok);
  ok('เพิ่มครูพร้อมกำหนดรหัสผ่านเอง', r.ok && !r.data.tempPassword, r.error);
  r = api('teacher.get', { id: somId }, tok);
  ok('แก้ไขครูโดยไม่ส่งรหัสผ่าน รหัสเดิมยังอยู่', (function () {
    const d = r.data;
    const u = api('teacher.save', { id: d.id, firstName: d.firstName, lastName: d.lastName, username: d.username,
      department: 'คณิตศาสตร์', role: d.role, status: d.status }, tok);
    return u.ok && !!sys.login('somchai', somTemp);
  })());

  // ครูเข้าสู่ระบบด้วยรหัสผ่านชั่วคราวแล้วตั้งรหัสใหม่
  r = api('auth.login', { username: 'somchai', password: somTemp });
  ok('ครูเข้าด้วยรหัสผ่านชั่วคราว', r.ok && r.data.boot.user.mustChangePassword === true, r.error);
  let tTok = r.data.token;
  r = api('auth.changePassword', { currentPassword: somTemp, newPassword: 'SOMCHAI' }, tTok);
  ok('รหัสผ่านต้องไม่เหมือนชื่อผู้ใช้', !r.ok && /ไม่เหมือนชื่อผู้ใช้/.test(r.error), r.error);
  r = api('auth.changePassword', { currentPassword: somTemp, newPassword: 'Duty2569' }, tTok);
  ok('ครูตั้งรหัสผ่านใหม่', r.ok, r.error);
  r = api('bootstrap', {}, tTok);
  eq('ครูเห็นเมนูตามบทบาทเดิม', r.data.menu.map(x => x.key), ['today', 'mine']);
  r = api('teacher.save', { firstName: 'x', lastName: 'y', username: 'hacker', role: 'SYS_ADMIN' }, tTok);
  ok('ครูเพิ่มบัญชีไม่ได้', !r.ok && /สิทธิ์ไม่เพียงพอ/.test(r.error), r.error);
  r = api('teacher.resetPassword', { id: adminRow.id }, tTok);
  ok('ครูรีเซ็ตรหัสผ่านคนอื่นไม่ได้', !r.ok && /สิทธิ์ไม่เพียงพอ/.test(r.error), r.error);

  // หัวหน้าเวรยังได้สิทธิ์ระดับเดิม
  const hTok = sys.login('somying', 'Somying#1');
  api('auth.changePassword', { currentPassword: 'Somying#1', newPassword: 'Head#2569' }, hTok);
  r = api('bootstrap', {}, hTok);
  ok('หัวหน้าเวรเห็นเมนูจัดเวรและอนุมัติ', r.ok && ['assign', 'approve', 'report'].every(k => r.data.menu.some(m => m.key === k)));
  ok('หัวหน้าเวรไม่เห็นเมนูตั้งค่า', r.ok && !r.data.menu.some(m => m.key === 'settings'));

  // ผู้ดูแลรีเซ็ตรหัสผ่าน → เซสชันเดิมของครูหมดอายุทันที
  r = api('teacher.resetPassword', { id: somId }, tok);
  ok('ผู้ดูแลรีเซ็ตรหัสผ่านครู', r.ok && !!r.data.tempPassword, r.error);
  const somTemp2 = r.data.tempPassword;
  r = api('bootstrap', {}, tTok);
  eq('เซสชันเดิมของครูหมดอายุหลังรีเซ็ต', r.data.reasonCode, 'PASSWORD_CHANGED');
  r = api('schedule.mine', {}, tTok);
  eq('คำสั่งอื่นก็ถูกปฏิเสธ', r.code, 'AUTH_REQUIRED');
  r = api('teacher.resetPassword', { id: adminRow.id }, tok);
  ok('รีเซ็ตรหัสผ่านของตนเองผ่านหน้านี้ไม่ได้', !r.ok && /ของตนเอง/.test(r.error), r.error);

  // พักบัญชีเมื่อใส่รหัสผ่านผิดหลายครั้ง
  for (let i = 0; i < 5; i++) api('auth.login', { username: 'somchai', password: 'bad-pass-' + i });
  r = api('auth.login', { username: 'somchai', password: somTemp2 });
  eq('ใส่ผิดครบ 5 ครั้งถูกพักบัญชีแม้รหัสถูก', r.code, 'LOCKED');
  r = api('teacher.resetPassword', { id: somId }, tok);
  const somTemp3 = r.data.tempPassword;
  tTok = sys.login('somchai', somTemp3);
  ok('รีเซ็ตรหัสผ่านแล้วปลดการพักบัญชี', !!tTok);

  // ระงับบัญชี
  r = api('teacher.status', { id: somId, status: 'INACTIVE' }, tok);
  ok('ระงับครู', r.ok, r.error);
  r = api('bootstrap', {}, tTok);
  eq('บัญชีที่ถูกระงับหลุดจากระบบทันที', r.data.reasonCode, 'INACTIVE');
  r = api('auth.login', { username: 'somchai', password: somTemp3 });
  ok('บัญชีที่ถูกระงับเข้าสู่ระบบไม่ได้', !r.ok && /ระงับ/.test(r.error), r.error);

  // ออกจากระบบ
  r = api('auth.logout', {}, tok);
  ok('ออกจากระบบ', r.ok, r.error);
  r = api('teacher.list', {}, tok);
  eq('token ใช้ไม่ได้หลังออกจากระบบ', r.code, 'AUTH_REQUIRED');
  r = api('teacher.list', {}, otherTok);
  ok('ออกจากระบบเครื่องหนึ่งไม่กระทบอีกเครื่อง', r.ok, r.error);

  // ประวัติการใช้งาน
  const audit = sys.rows('AUDIT_LOG');
  const auditJson = JSON.stringify(audit);
  ok('บันทึกการเข้าสู่ระบบพร้อมชื่อผู้ใช้', audit.some(a => a.action === 'LOGIN' && a.actor_username === 'admin'));
  ok('บันทึกการใส่รหัสผ่านผิด', audit.some(a => a.action === 'LOGIN_FAILED'));
  ok('บันทึกการรีเซ็ตรหัสผ่าน', audit.some(a => a.action === 'PASSWORD_RESET'));
  ok('AUDIT_LOG ไม่มี hash หรือรหัสผ่าน', auditJson.indexOf('pbkdf2') < 0 &&
    [admin.password, 'Admin#2569', somTemp, somTemp3, 'Somying#1'].every(p => auditJson.indexOf(p) < 0));
})();

/* ================= 23. นำเข้าครูหลายรายการ ================= */
section('23. นำเข้าครูพร้อมชื่อผู้ใช้/รหัสผ่าน');
(function () {
  const sys = makeSystem();
  const admin = credsOf(sys.fresh()['ติดตั้งระบบ']());
  const t0 = sys.login(admin.username, admin.password);
  sys.api('auth.changePassword', { currentPassword: admin.password, newPassword: 'Admin#2569' }, t0);

  const csv = 'รหัส,ชื่อ,นามสกุล,ชื่อผู้ใช้,รหัสผ่าน,กลุ่มสาระ,อีเมล\n' +
    'T001,สมชาย,ใจดี,somchai,Somchai#1,วิทย์,\n' +
    'T002,สมหญิง,ตั้งใจ,,,ไทย,somying@school.ac.th\n' +
    'T003,สมศักดิ์,มั่นคง,somsak,,คณิต,\n' +
    'T004,ซ้ำ,ซ้ำ,somchai,,คณิต,\n' +
    'T005,รหัส,สั้น,shortpw,abc,คณิต,\n';
  let r = sys.api('teacher.importPreview', { text: csv }, t0);
  ok('ตรวจข้อมูลนำเข้า', r.ok, r.error);
  eq('สรุปผลตรวจ', [r.data.total, r.data.create, r.data.error], [5, 3, 2]);
  eq('ตั้งชื่อผู้ใช้จากอีเมลเมื่อเว้นว่าง', r.data.rows[1].username, 'somying');
  ok('ผลตรวจไม่ส่งรหัสผ่านกลับไป', JSON.stringify(r.data).indexOf('Somchai#1') < 0);
  ok('แจ้งชื่อผู้ใช้ซ้ำในไฟล์', r.data.rows[3]._errors.some(e => /ซ้ำกับบรรทัดที่ 2/.test(e)));
  ok('แจ้งรหัสผ่านสั้นเกิน', r.data.rows[4]._errors.some(e => /อย่างน้อย/.test(e)));

  r = sys.api('teacher.importCommit', { text: csv }, t0);
  ok('นำเข้าสำเร็จ', r.ok && r.data.created === 3, r.error);
  eq('ได้รหัสผ่านชั่วคราวเฉพาะคนที่ไม่ได้กรอก', r.data.accounts.map(a => a.username).sort(), ['somsak', 'somying']);
  ok('ครูที่กรอกรหัสผ่านเองเข้าสู่ระบบได้', !!sys.login('somchai', 'Somchai#1'));
  const sy = r.data.accounts.find(a => a.username === 'somying');
  ok('ครูที่ได้รหัสผ่านชั่วคราวเข้าสู่ระบบได้', !!sys.login('somying', sy.tempPassword));

  // นำเข้าไฟล์แบบเดิม (มีแต่อีเมล) ต้องอัปเดตคนเดิม ไม่สร้างซ้ำ
  const oldCsv = 'รหัส,ชื่อ,นามสกุล,อีเมล,กลุ่มสาระ\nT002,สมหญิง,ตั้งใจดี,somying@school.ac.th,ภาษาไทย\n';
  r = sys.api('teacher.importCommit', { text: oldCsv }, t0);
  ok('ไฟล์แบบเดิมอัปเดตครูคนเดิม', r.ok && r.data.updated === 1 && r.data.created === 0, r.error || JSON.stringify(r.data));
  ok('อัปเดตแล้วรหัสผ่านเดิมยังใช้ได้', !!sys.login('somying', sy.tempPassword) && r.data.accounts.length === 0);
})();

/* ================= 24. ย้ายจากระบบเดิม ================= */
section('24. ย้ายข้อมูลจากระบบเดิมที่เข้าด้วยอีเมล');
(function () {
  const sys = makeSystem();
  // ชีต TEACHERS แบบเดิม — ยังไม่มีคอลัมน์ชื่อผู้ใช้และรหัสผ่าน
  const oldCols = ['id', 'code', 'prefix', 'first_name', 'last_name', 'email', 'department',
    'position', 'phone', 'role', 'status', 'note', 'created_at', 'updated_at'];
  const ss = sys.fresh().SpreadsheetApp.getActiveSpreadsheet();
  ss.insertSheet('TEACHERS').getRange(1, 1, 4, oldCols.length).setValues([
    oldCols,
    ['t-dir', 'D01', 'นาย', 'ผู้อำนวย', 'การ', 'director@school.ac.th', 'บริหาร', 'ผอ.', '', 'SYS_ADMIN', 'ACTIVE', '', '', ''],
    ['t-som', 'T001', 'นาย', 'สมชาย', 'ใจดี', 'somchai@school.ac.th', 'วิทย์', 'ครู', '', 'DAILY_HEAD', 'ACTIVE', '', '', ''],
    ['t-num', '0042', 'นาง', 'สมใจ', 'รักดี', '', 'ไทย', 'ครู', '', 'TEACHER', 'ACTIVE', '', '', '']
  ]);

  const msg = sys.fresh()['ติดตั้งระบบ']();
  const admin = credsOf(msg);
  ok('ผู้ดูแลระบบเดิมได้รหัสผ่านชั่วคราว (ไม่สร้างบัญชีใหม่)', admin && admin.username === 'director', msg);
  const rows = sys.rows('TEACHERS');
  eq('ครูเดิมได้ชื่อผู้ใช้จากอีเมล/รหัสครู', rows.map(t => t.username), ['director', 'somchai', 't0042']);
  eq('ข้อมูลเดิมไม่หาย', rows.map(t => [t.email, t.role]),
    [['director@school.ac.th', 'SYS_ADMIN'], ['somchai@school.ac.th', 'DAILY_HEAD'], ['', 'TEACHER']]);
  eq('ไม่มีการสร้างครูเพิ่ม', rows.length, 3);

  const tok = sys.login('director', admin.password);
  ok('ผู้ดูแลระบบเดิมเข้าสู่ระบบได้', !!tok);
  sys.api('auth.changePassword', { currentPassword: admin.password, newPassword: 'Director#1' }, tok);
  let r = sys.api('teacher.issuePasswords', {}, tok);
  ok('ออกรหัสผ่านชั่วคราวให้ครูที่ยังไม่มี', r.ok && r.data.count === 2, r.error || JSON.stringify(r.data));
  const som = r.ok && r.data.accounts.find(a => a.username === 'somchai');
  ok('ครูเดิมเข้าสู่ระบบด้วยรหัสผ่านชั่วคราว', !!(som && sys.login('somchai', som.tempPassword)));
  r = sys.api('teacher.issuePasswords', {}, tok);
  eq('ออกซ้ำไม่กระทบคนที่มีรหัสผ่านแล้ว', r.ok && r.data.count, 0);

  const lost = credsOf(sys.fresh()['รีเซ็ตรหัสผ่านผู้ดูแลระบบ']());
  ok('เจ้าของสคริปต์กู้รหัสผ่านผู้ดูแลระบบได้', !!(lost && lost.username === 'director' && sys.login('director', lost.password)));
  r = sys.api('teacher.list', {}, tok);
  eq('รหัสผ่านที่กู้คืนทำให้เซสชันเดิมหมดอายุ', r.code, 'AUTH_REQUIRED');
})();

/* ================= สรุปผล ================= */
console.log('\n' + '─'.repeat(60));
if (failures.length) {
  console.log('\nรายการที่ไม่ผ่าน:');
  failures.forEach((f, i) => console.log('  ' + (i + 1) + ') ' + f));
}
console.log('\nผ่าน ' + pass + ' · ไม่ผ่าน ' + fail);
process.exit(fail ? 1 : 0);
