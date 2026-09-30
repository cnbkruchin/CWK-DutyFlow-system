/**
 * Setup.gs — ติดตั้งระบบ สร้างชีต และตัวช่วยตั้งค่าเริ่มต้น
 *
 * เรียกจากเมนูในตัวแก้ไข Apps Script: ติดตั้งระบบ()
 */

/** เมนูในสเปรดชีต */
function onOpen() {
  try {
    SpreadsheetApp.getUi()
      .createMenu('CWK DutyFlow')
      .addItem('ติดตั้ง / ซ่อมแซมชีต', 'ติดตั้งระบบ')
      .addItem('ตรวจสอบระบบ', 'ตรวจสอบระบบ')
      .addItem('ซ่อมข้อมูลที่เชื่อมไม่ติด', 'ซ่อมข้อมูล')
      .addItem('ล้างแคชทั้งหมด', 'ล้างแคช')
      .addSeparator()
      .addItem('ใส่ข้อมูลตัวอย่าง', 'ใส่ข้อมูลตัวอย่าง')
      .addToUi();
  } catch (e) { /* ไม่ได้เปิดจากสเปรดชีต */ }
}

/**
 * ติดตั้งระบบ — สร้างชีตที่ขาด เติมคอลัมน์ที่ขาด ตั้ง Script Properties
 * รันซ้ำได้ ข้อมูลเดิมไม่หาย
 */
function ติดตั้งระบบ() {
  var props = PropertiesService.getScriptProperties();
  var ss;

  var id = props.getProperty('SPREADSHEET_ID');
  if (id) {
    ss = SpreadsheetApp.openById(id);
  } else {
    try {
      ss = SpreadsheetApp.getActiveSpreadsheet();
    } catch (e) { ss = null; }
    if (!ss) ss = SpreadsheetApp.create('CWK DutyFlow Database');
    props.setProperty('SPREADSHEET_ID', ss.getId());
  }

  var report = { created: [], patched: [], ok: [] };

  DB_TABLES.forEach(function (table) {
    var def = DB_SCHEMA[table];
    var sh = ss.getSheetByName(def.sheet);
    if (!sh) {
      sh = ss.insertSheet(def.sheet);
      sh.getRange(1, 1, 1, def.columns.length).setValues([def.columns]);
      SETUP_styleHeader_(sh, def.columns.length);
      report.created.push(def.sheet);
      return;
    }
    var lastCol = Math.max(1, sh.getLastColumn());
    var header = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return str(h); });
    var missing = def.columns.filter(function (c) { return header.indexOf(c) < 0; });
    if (missing.length) {
      // เติมคอลัมน์ที่ขาดต่อท้าย แล้วจัดลำดับใหม่ให้ตรงสคีมา
      SETUP_reorderColumns_(sh, def.columns, header);
      report.patched.push(def.sheet + ' (+' + missing.join(', ') + ')');
    } else {
      report.ok.push(def.sheet);
    }
    SETUP_styleHeader_(sh, def.columns.length);
  });

  // โฟลเดอร์ Drive
  if (!props.getProperty('PHOTO_FOLDER_ID') || !props.getProperty('REPORT_FOLDER_ID')) {
    var root = SETUP_folder_(null, 'CWK DutyFlow');
    if (!props.getProperty('PHOTO_FOLDER_ID')) {
      props.setProperty('PHOTO_FOLDER_ID', SETUP_folder_(root, 'ภาพหลักฐานการอยู่เวร').getId());
    }
    if (!props.getProperty('REPORT_FOLDER_ID')) {
      props.setProperty('REPORT_FOLDER_ID', SETUP_folder_(root, 'รายงาน').getId());
    }
  }

  // ผู้ติดตั้งเป็นผู้ดูแลระบบคนแรก
  if (!props.getProperty('BOOTSTRAP_ADMIN_EMAIL')) {
    var me = '';
    try { me = str(Session.getEffectiveUser().getEmail()).toLowerCase(); } catch (e) { me = ''; }
    if (me) props.setProperty('BOOTSTRAP_ADMIN_EMAIL', me);
  }

  DB_invalidateAll();
  SETUP_seedConfig_();

  var msg = 'ติดตั้งระบบเรียบร้อย\n\n' +
    'สเปรดชีต: ' + ss.getName() + '\n' +
    'สร้างชีตใหม่: ' + (report.created.length ? report.created.join(', ') : 'ไม่มี') + '\n' +
    'ปรับคอลัมน์: ' + (report.patched.length ? report.patched.join('; ') : 'ไม่มี') + '\n' +
    'ครบถ้วนอยู่แล้ว: ' + report.ok.length + ' ชีต\n\n' +
    'ผู้ดูแลระบบเริ่มต้น: ' + (props.getProperty('BOOTSTRAP_ADMIN_EMAIL') || '(ไม่ทราบ)');

  SETUP_toast_(msg);
  return msg;
}

function SETUP_styleHeader_(sh, cols) {
  try {
    sh.getRange(1, 1, 1, cols)
      .setFontWeight('bold')
      .setBackground('#7A1F2B')
      .setFontColor('#FFFFFF');
    sh.setFrozenRows(1);
  } catch (e) { /* ignore */ }
}

/** จัดคอลัมน์ให้ตรงสคีมาโดยรักษาข้อมูลเดิม */
function SETUP_reorderColumns_(sh, columns, header) {
  var last = sh.getLastRow();
  var lastCol = Math.max(1, sh.getLastColumn());
  var data = last > 1 ? sh.getRange(2, 1, last - 1, lastCol).getValues() : [];

  var out = data.map(function (row) {
    return columns.map(function (c) {
      var i = header.indexOf(c);
      return i >= 0 ? row[i] : '';
    });
  });

  sh.clear();
  sh.getRange(1, 1, 1, columns.length).setValues([columns]);
  if (out.length) sh.getRange(2, 1, out.length, columns.length).setValues(out);
}

function SETUP_folder_(parent, name) {
  var it = parent ? parent.getFoldersByName(name) : DriveApp.getFoldersByName(name);
  if (it.hasNext()) return it.next();
  return parent ? parent.createFolder(name) : DriveApp.createFolder(name);
}

/** เติมค่าตั้งค่าเริ่มต้นลงชีต CONFIG ถ้ายังไม่มี */
function SETUP_seedConfig_() {
  var existing = {};
  dbReadAll('CONFIG').forEach(function (r) { existing[str(r.key)] = true; });
  var creates = [];
  Object.keys(CFG_DEFAULTS).forEach(function (k) {
    if (existing[k]) return;
    var d = CFG_DEFAULTS[k];
    creates.push({
      key: k,
      value: (d.t === 'bool') ? (d.v ? 'TRUE' : 'FALSE') : String(d.v),
      value_type: d.t, group_name: d.g, label: d.l,
      updated_at: nowIso(), updated_by: 'setup'
    });
  });
  if (creates.length) dbInsertMany('CONFIG', creates);
  CFG_MEM = null;
  return creates.length;
}

function SETUP_toast_(msg) {
  try { SpreadsheetApp.getUi().alert(msg); }
  catch (e) { Logger.log(msg); }
}

/** ล้างแคชทั้งหมด */
function ล้างแคช() {
  DB_invalidateAll();
  PR_INDEX_CACHE = {};
  SETUP_toast_('ล้างแคชเรียบร้อย');
  return 'ล้างแคชเรียบร้อย';
}

/* ================================================================= */
/* ตัวช่วยตั้งค่าเริ่มต้นในหน้าเว็บ                                     */
/* ================================================================= */

/** สถานะความพร้อมของระบบ — ใช้แสดงขั้นตอนที่ยังขาด */
function SETUP_status(ctx) {
  AUTH_require(ctx);
  var steps = [];

  var teachers = 0, points = 0, slots = 0, semesters = 0, assignments = 0, schedules = 0;
  try { teachers = dbFind('TEACHERS', { status: 'ACTIVE' }).length; } catch (e) { }
  try { points = dbFind('DUTY_POINTS', { status: 'ACTIVE' }).length; } catch (e) { }
  try { slots = dbFind('TIME_SLOTS', { status: 'ACTIVE' }).length; } catch (e) { }
  try { semesters = dbReadAll('SEMESTERS').length; } catch (e) { }

  var active = SEMESTER_active();
  if (active) {
    assignments = dbFind('ASSIGNMENTS', { semester_id: active.id, status: 'ACTIVE' }).length;
    schedules = dbFind('DAILY_SCHEDULE', { semester_id: active.id }).length;
  }

  steps.push({ key: 'teachers', label: 'เพิ่มข้อมูลครู', count: teachers, done: teachers > 0, nav: 'master' });
  steps.push({ key: 'slots', label: 'กำหนดช่วงเวลาเวร', count: slots, done: slots > 0, nav: 'master' });
  steps.push({ key: 'points', label: 'กำหนดจุดเวร', count: points, done: points > 0, nav: 'master' });
  steps.push({ key: 'semester', label: 'สร้างและเปิดใช้ภาคเรียน', count: semesters, done: !!active, nav: 'master' });
  steps.push({ key: 'assign', label: 'จัดเวรประจำภาคเรียน', count: assignments, done: assignments > 0, nav: 'assign' });
  steps.push({ key: 'schedule', label: 'สร้างตารางเวรรายวัน', count: schedules, done: schedules > 0, nav: 'assign' });

  var doneCount = steps.filter(function (s) { return s.done; }).length;
  return {
    ready: doneCount === steps.length,
    doneCount: doneCount,
    totalSteps: steps.length,
    steps: steps,
    canSetup: ctx.level >= ROLES.DUTY_ADMIN.level,
    activeSemester: active ? SEMESTER_dto_(active) : null
  };
}

/** ใส่ข้อมูลตัวอย่างเพื่อทดลองใช้ (ช่วงเวลา + จุดเวร + ภาคเรียน) */
function SETUP_seedSample(ctx) {
  AUTH_requireAdmin(ctx);
  return withLock(function () {
    var created = { slots: 0, points: 0, semester: 0 };

    if (!dbFind('TIME_SLOTS', { status: 'ACTIVE' }).length) {
      dbInsertMany('TIME_SLOTS', [
        { code: 'AM', name: 'เวรเช้า', start_time: '07:00', end_time: '08:20', sort_order: 1, status: 'ACTIVE' },
        { code: 'NOON', name: 'เวรพักกลางวัน', start_time: '11:30', end_time: '12:40', sort_order: 2, status: 'ACTIVE' },
        { code: 'PM', name: 'เวรเย็น', start_time: '15:40', end_time: '16:40', sort_order: 3, status: 'ACTIVE' }
      ]);
      created.slots = 3;
    }

    if (!dbFind('DUTY_POINTS', { status: 'ACTIVE' }).length) {
      dbInsertMany('DUTY_POINTS', [
        { code: 'P01', name: 'ประตูหน้าโรงเรียน', lat: 19.3459, lng: 100.1389, radius_m: 80, seat_count: 2, rotation_group: 'GATE', sort_order: 1, status: 'ACTIVE' },
        { code: 'P02', name: 'ประตูหลังโรงเรียน', lat: 19.3465, lng: 100.1401, radius_m: 80, seat_count: 2, rotation_group: 'GATE', sort_order: 2, status: 'ACTIVE' },
        { code: 'P03', name: 'อาคารเรียน 1', lat: 19.3462, lng: 100.1395, radius_m: 60, seat_count: 2, rotation_group: 'BUILDING', sort_order: 3, status: 'ACTIVE' },
        { code: 'P04', name: 'โรงอาหาร', lat: 19.3460, lng: 100.1398, radius_m: 60, seat_count: 2, rotation_group: 'BUILDING', sort_order: 4, status: 'ACTIVE' },
        { code: 'P05', name: 'สนามกีฬา', lat: 19.3468, lng: 100.1392, radius_m: 100, seat_count: 1, rotation_group: 'FIELD', sort_order: 5, status: 'ACTIVE' }
      ]);
      created.points = 5;
    }

    if (!SEMESTER_active()) {
      var y = new Date().getFullYear() + 543;
      var m = new Date().getMonth() + 1;
      var term = (m >= 5 && m <= 10) ? 1 : 2;
      var s = dbInsert('SEMESTERS', {
        year_be: y, term: term,
        name: 'ภาคเรียนที่ ' + term + '/' + y,
        start_date: term === 1 ? y - 543 + '-05-16' : y - 543 + '-11-01',
        end_date: term === 1 ? y - 543 + '-10-10' : (y - 543 + 1) + '-03-31',
        is_active: 'TRUE', status: 'ACTIVE'
      });
      created.semester = 1;
      AUDIT_log(ctx, 'SETUP_SEED_SEMESTER', 'SEMESTERS', s.id, null, null);
    }

    DB_invalidateAll();
    AUDIT_log(ctx, 'SETUP_SEED_SAMPLE', 'SYSTEM', '', null, created);
    return created;
  }, 60000);
}

/** เรียกจากเมนูในตัวแก้ไข */
function ใส่ข้อมูลตัวอย่าง() {
  var ctx = AUTH_context();
  if (!ctx.ok) { SETUP_toast_('กรุณาติดตั้งระบบก่อน: ' + ctx.reason); return; }
  var r = SETUP_seedSample(ctx);
  AUDIT_flush();
  SETUP_toast_('ใส่ข้อมูลตัวอย่างเรียบร้อย\nช่วงเวลา ' + r.slots + ' · จุดเวร ' + r.points +
    ' · ภาคเรียน ' + r.semester);
}

/** เพิ่มผู้ดูแลระบบคนแรกจากอีเมลผู้ติดตั้ง */
function SETUP_claimAdmin(ctx, data) {
  AUTH_require(ctx);
  var bootstrap = PROP_bootstrapAdmin();
  if (!bootstrap || ctx.email !== bootstrap) {
    throw new Error('เฉพาะผู้ติดตั้งระบบเท่านั้นที่ใช้คำสั่งนี้ได้');
  }
  if (ctx.teacherId) throw new Error('บัญชีนี้มีข้อมูลครูอยู่แล้ว');

  var d = data || {};
  var created = dbInsert('TEACHERS', {
    code: sanitizeText(d.code) || 'ADMIN',
    prefix: sanitizeText(d.prefix) || '',
    first_name: sanitizeText(d.firstName) || 'ผู้ดูแล',
    last_name: sanitizeText(d.lastName) || 'ระบบ',
    email: ctx.email,
    department: sanitizeText(d.department) || 'ฝ่ายบริหารทั่วไป',
    position: sanitizeText(d.position) || 'ผู้ดูแลระบบ',
    role: 'SYS_ADMIN',
    status: 'ACTIVE'
  });
  AUTH_MEM = null;
  AUDIT_log(ctx, 'SETUP_CLAIM_ADMIN', 'TEACHERS', created.id, null, { email: ctx.email });
  return { id: created.id };
}
