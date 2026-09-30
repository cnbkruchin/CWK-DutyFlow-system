/**
 * frontend-check.js — ตรวจความสอดคล้องระหว่างหน้าเว็บกับฝั่งเซิร์ฟเวอร์
 * รัน: node test/frontend-check.js
 */
const fs = require('fs');
const path = require('path');
const { SRC, loadAll } = require('./harness');

const G = loadAll({ _props: { SPREADSHEET_ID: 'x' } });
const routes = Object.keys(G.API_ROUTES_());

const HTML = ['Index.html', 'Styles.html', 'Scripts.html', 'Views.html', 'Actions.html'];
const src = {};
HTML.forEach(f => { src[f] = fs.readFileSync(path.join(SRC, f), 'utf8'); });
const client = src['Scripts.html'] + '\n' + src['Views.html'] + '\n' + src['Actions.html'];

const problems = [];
const notes = [];
function check(name, cond, detail) {
  if (cond) { notes.push('✓ ' + name); return; }
  problems.push(name + (detail ? ' — ' + detail : ''));
}

/* 1. ทุก action ที่หน้าเว็บเรียก ต้องมีใน API_ROUTES_ */
const used = new Set();
const re = /\b(?:cachedCall|call)\(\s*'([^']+)'/g;
let m;
while ((m = re.exec(client)) !== null) used.add(m[1]);
const missing = [...used].filter(a => routes.indexOf(a) < 0);
check('ทุก action ที่หน้าเว็บเรียกมีอยู่ในเซิร์ฟเวอร์ (' + used.size + ' action)',
  missing.length === 0, 'ขาด: ' + missing.join(', '));

/* 2. ฟังก์ชันฝั่งหน้าเว็บที่ถูกเรียก ต้องถูกประกาศ */
const declared = new Set();
let d;
const decl = /function\s+([A-Za-z_$][\w$]*)\s*\(/g;
while ((d = decl.exec(client)) !== null) declared.add(d[1]);

const calledLocal = new Set();
const localCall = /\b((?:bind|render|open|do)[A-Z]\w*)\s*\(/g;
while ((d = localCall.exec(client)) !== null) calledLocal.add(d[1]);
const undef = [...calledLocal].filter(f => !declared.has(f));
check('ฟังก์ชันฝั่งหน้าเว็บที่ถูกเรียกถูกประกาศครบ (' + calledLocal.size + ' ฟังก์ชัน)',
  undef.length === 0, 'ขาด: ' + undef.join(', '));

/* 3. ทุกคีย์เมนูมีหน้าจอรองรับ */
const viewKeys = new Set();
const vk = /VIEWS\.(\w+)\s*=/g;
while ((d = vk.exec(src['Views.html'])) !== null) viewKeys.add(d[1]);
const menuKeys = new Set();
['TEACHER', 'DAILY_HEAD', 'DUTY_ADMIN', 'EXECUTIVE', 'SYS_ADMIN'].forEach(role => {
  G.AUTH_menuFor({ ok: true, role: role, level: G.ROLES[role].level })
    .forEach(x => menuKeys.add(x.key));
});
const noView = [...menuKeys].filter(k => !viewKeys.has(k));
check('ทุกเมนูมีหน้าจอรองรับ (' + menuKeys.size + ' เมนู / ' + viewKeys.size + ' หน้าจอ)',
  noView.length === 0, 'ขาดหน้าจอ: ' + noView.join(', '));

/* 4. ไม่ใช้ browser storage (ไม่รองรับใน iframe ของ Apps Script บางกรณี) */
check('ไม่ใช้ localStorage/sessionStorage',
  !/\b(localStorage|sessionStorage|indexedDB)\b/.test(client));

/* 5. กันหน้าค้าง: ตรวจ readyState + fallback timeout */
check('มีการตรวจ document.readyState ก่อนเริ่มระบบ',
  /document\.readyState\s*===\s*'loading'/.test(src['Scripts.html']));
check('มี fallback timeout กันหน้าค้าง',
  /setTimeout\(start,\s*\d+\)/.test(src['Scripts.html']));
check('มี timeout ของการเรียกเซิร์ฟเวอร์',
  /CALL_TIMEOUT\s*=\s*\d+/.test(src['Scripts.html']));
check('มี withFailureHandler', /withFailureHandler/.test(src['Scripts.html']));
check('ดักจับ unhandledrejection', /unhandledrejection/.test(src['Scripts.html']));
check('ดักจับ window error', /addEventListener\('error'/.test(src['Scripts.html']));

/* 6. กล่องข้อความต้องไม่ว่างเปล่า */
check('modal แทนข้อความว่างด้วยข้อความมาตรฐาน',
  /if\s*\(!text\)\s*text\s*=/.test(src['Scripts.html']));
check('showError แทนข้อความว่างด้วยข้อความมาตรฐาน',
  /if\s*\(!msg\)\s*\{[\s\S]{0,200}เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ/.test(src['Scripts.html']));
check('bootError แทนข้อความว่างด้วยข้อความมาตรฐาน',
  /เริ่มระบบไม่สำเร็จโดยไม่ทราบสาเหตุ/.test(src['Scripts.html']));
check('call() ไม่ reject ด้วยข้อความว่าง',
  /res\.error\s*\|\|\s*'เกิดข้อผิดพลาด/.test(src['Scripts.html']));

/* 7. ไม่หลุด ID ที่อ่อนไหวไปฝั่งหน้าเว็บ */
check('ไม่มี SPREADSHEET_ID ในไฟล์หน้าเว็บ',
  !/SPREADSHEET_ID/.test(client));
check('ไม่มี PHOTO_FOLDER_ID ในไฟล์หน้าเว็บ',
  !/PHOTO_FOLDER_ID/.test(client));

/* 8. หน้าว่างต้องมีคำแนะนำ ไม่ใช่จอเปล่า */
check('มีสถานะว่างพร้อมคำแนะนำ', /function\s+emptyState/.test(src['Views.html']));
check('หน้าวันนี้มีตัวช่วยตั้งค่าเมื่อข้อมูลยังไม่ครบ',
  /setupOrEmptyHtml/.test(src['Views.html']));
check('มีปุ่มตรวจสอบระบบเมื่อเกิดข้อผิดพลาด',
  /errDiag/.test(src['Scripts.html']));

/* 9. Index.html เรียก include ครบ */
['Styles', 'Views', 'Actions', 'Scripts'].forEach(f => {
  check('Index.html include ' + f,
    new RegExp("include\\('" + f + "'\\)").test(src['Index.html']));
});
check('Scripts ถูก include เป็นลำดับสุดท้าย',
  src['Index.html'].indexOf("include('Scripts')") >
  src['Index.html'].indexOf("include('Actions')"));

/* 10. ความสามารถใหม่ต้องมีทางเข้าใช้งานจริง */
check('มีหน้าตั้งค่าการหมุนจุด', /rotation\.saveSettings/.test(client));
check('มีการพรีวิวการหมุนจุด', /rotation\.pointPreview/.test(client));
check('มีการปักหมุดจุดเฉพาะบุคคล', /pin\.set/.test(client));
check('มีรายงานปฏิบัติงานรายวัน', /report\.daily/.test(client));
check('มีสรุปแยกกลุ่ม', /report\.group/.test(client));
check('มีการเจาะดูรายชื่อในกลุ่ม', /report\.drill/.test(client));
check('มีการเปลี่ยนครูเวรรายวัน', /schedule\.adjust/.test(client));
check('มีการสลับจุดรายวัน', /schedule\.swap/.test(client));
check('แสดงระดับผู้อนุมัติ', /approvalLevelName/.test(client));

/* 11. เข้าสู่ระบบด้วยชื่อผู้ใช้/รหัสผ่าน */
check('แอตทริบิวต์ hidden ซ่อนได้จริง (ชนะ display ของคลาส)',
  /\[hidden\]\s*\{\s*display:\s*none\s*!important/.test(src['Styles.html']));
check('มีฟอร์มเข้าสู่ระบบ (ชื่อผู้ใช้ + รหัสผ่าน)',
  /id="loginForm"/.test(src['Index.html']) && /id="loginUser"/.test(src['Index.html']));
check('ช่องรหัสผ่านเป็น type=password พร้อม autocomplete',
  /id="loginPass"[^>]*type="password"[^>]*autocomplete="current-password"/.test(src['Index.html'].replace(/\s+/g, ' ')));
check('ส่ง token ไปกับทุกคำขอ',
  /\.api\(action,\s*payload \|\| \{\},\s*App\.token/.test(src['Scripts.html']));
check('เข้าสู่ระบบผ่าน auth.login', used.has('auth.login'));
check('มีปุ่มบัญชีของฉันและออกจากระบบ', used.has('auth.logout') && /id="accountBtn"/.test(src['Index.html']));
check('ผู้ใช้เปลี่ยนรหัสผ่านเองได้', used.has('auth.changePassword'));
check('บังคับตั้งรหัสผ่านใหม่เมื่อเซิร์ฟเวอร์สั่ง',
  /MUST_CHANGE_PASSWORD/.test(src['Scripts.html']) && /id="pwForm"/.test(src['Index.html']));
check('เซสชันหมดอายุแล้วกลับหน้าเข้าสู่ระบบ', /AUTH_REQUIRED[\s\S]{0,40}onAuthLost/.test(src['Scripts.html']));
check('ผู้ดูแลรีเซ็ต/ออกรหัสผ่านชั่วคราวได้',
  used.has('teacher.resetPassword') && used.has('teacher.issuePasswords'));
check('ไม่เหลือโค้ดเข้าระบบด้วยอีเมลแบบเดิม',
  !/claimAdmin|NOT_REGISTERED|WRONG_DOMAIN|NO_EMAIL/.test(client));
(function () {
  const manifest = JSON.parse(fs.readFileSync(path.join(SRC, 'appsscript.json'), 'utf8'));
  check('เว็บแอปเปิดได้โดยไม่ต้องลงชื่อเข้า Google และรันในนามผู้ติดตั้ง',
    manifest.webapp.access === 'ANYONE_ANONYMOUS' && manifest.webapp.executeAs === 'USER_DEPLOYING');
})();

console.log('ผลการตรวจฝั่งหน้าเว็บ');
notes.forEach(n => console.log('  ' + n));
if (problems.length) {
  console.log('\nพบปัญหา ' + problems.length + ' รายการ:');
  problems.forEach(p => console.log('  ✗ ' + p));
  process.exit(1);
}
console.log('\n✓ ผ่านทั้งหมด ' + notes.length + ' รายการ');
