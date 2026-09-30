/**
 * Diagnostics.gs — ตรวจสอบและซ่อมแซมระบบ
 *
 * ออกแบบมาเพื่อตอบคำถาม "ทำไมหน้าจอขึ้นว่าง" ได้ในคลิกเดียว
 */

/** ตรวจสอบความสมบูรณ์ของระบบ */
function DIAG_selfTest(ctx) {
  AUTH_require(ctx);
  var checks = [];

  function add(name, ok, detail, fix) {
    checks.push({ name: name, ok: !!ok, level: ok ? 'OK' : 'ERROR', detail: str(detail), fix: str(fix) });
  }
  function warn(name, ok, detail, fix) {
    checks.push({ name: name, ok: !!ok, level: ok ? 'OK' : 'WARN', detail: str(detail), fix: str(fix) });
  }

  // 1. Script Properties
  var ssId = PROP_get('SPREADSHEET_ID');
  add('ตั้งค่า SPREADSHEET_ID', !!ssId, ssId ? 'ตั้งค่าแล้ว' : 'ยังไม่ได้ตั้งค่า',
    'รัน ติดตั้งระบบ() ในตัวแก้ไข Apps Script');
  warn('ตั้งค่าโฟลเดอร์ภาพหลักฐาน', !!PROP_photoFolderId(), '', 'รัน ติดตั้งระบบ()');

  // 2. ชีตครบหรือไม่
  var missingSheets = [];
  var missingCols = [];
  try {
    var ss = DB_ss();
    DB_TABLES.forEach(function (t) {
      var def = DB_SCHEMA[t];
      var sh = ss.getSheetByName(def.sheet);
      if (!sh) { missingSheets.push(def.sheet); return; }
      var lastCol = Math.max(1, sh.getLastColumn());
      var header = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return str(h); });
      var miss = def.columns.filter(function (c) { return header.indexOf(c) < 0; });
      if (miss.length) missingCols.push(def.sheet + ': ' + miss.join(', '));
    });
  } catch (e) {
    missingSheets.push('อ่านสเปรดชีตไม่ได้ — ' + e.message);
  }
  add('ชีตครบทั้ง ' + DB_TABLES.length + ' ตาราง', !missingSheets.length,
    missingSheets.length ? 'ขาด: ' + missingSheets.join(', ') : 'ครบ', 'รัน ติดตั้งระบบ()');
  add('คอลัมน์ครบตามสคีมา', !missingCols.length,
    missingCols.length ? missingCols.join(' | ') : 'ครบ', 'รัน ติดตั้งระบบ()');

  // 3. ข้อมูลหลัก
  var teachers = dbFind('TEACHERS', { status: 'ACTIVE' }).length;
  var points = dbFind('DUTY_POINTS', { status: 'ACTIVE' }).length;
  var slots = dbFind('TIME_SLOTS', { status: 'ACTIVE' }).length;
  add('มีข้อมูลครู', teachers > 0, teachers + ' คน', 'ไปที่ ข้อมูลหลัก > ครู เพื่อเพิ่มหรือนำเข้า');
  add('มีช่วงเวลาเวร', slots > 0, slots + ' ช่วง', 'ไปที่ ข้อมูลหลัก > ช่วงเวลา');
  add('มีจุดเวร', points > 0, points + ' จุด', 'ไปที่ ข้อมูลหลัก > จุดเวร');

  // 4. ภาคเรียน
  var active = SEMESTER_active();
  add('มีภาคเรียนที่เปิดใช้งาน', !!active,
    active ? str(active.name) : 'ยังไม่ได้เปิดใช้ภาคเรียนใด', 'ไปที่ ข้อมูลหลัก > ภาคเรียน');
  if (active) {
    var yearOk = num(active.year_be) >= 2500 && [1, 2].indexOf(num(active.term)) >= 0;
    warn('ข้อมูลภาคเรียนถูกต้อง', yearOk,
      'ปี พ.ศ. ' + num(active.year_be) + ' ภาคเรียนที่ ' + num(active.term),
      'แก้ไขปีการศึกษาให้เป็น พ.ศ. และภาคเรียนเป็น 1 หรือ 2');
    var dateOk = !!toDateStr(active.start_date) && !!toDateStr(active.end_date);
    add('ภาคเรียนมีวันเปิด-ปิด', dateOk, toDateStr(active.start_date) + ' ถึง ' + toDateStr(active.end_date),
      'แก้ไขวันเปิด-ปิดภาคเรียน');
  }

  // 5. การจัดเวรและตาราง
  if (active) {
    var assigns = dbFind('ASSIGNMENTS', { semester_id: active.id, status: 'ACTIVE' }).length;
    var scheds = dbFind('DAILY_SCHEDULE', { semester_id: active.id }).length;
    add('จัดเวรประจำภาคเรียนแล้ว', assigns > 0, assigns + ' ที่นั่ง', 'ไปที่ จัดเวร > กระดานจัดเวร');
    warn('สร้างตารางรายวันแล้ว', scheds > 0, scheds + ' รายการ', 'ไปที่ จัดเวร > สร้างตารางรายวัน');
  }

  // 6. ข้อมูลที่เชื่อมไม่ติด (สาเหตุหลักของช่องว่าง)
  var orphan = DIAG_orphans_();
  add('ตารางรายวันเชื่อมกับข้อมูลหลักครบ', orphan.total === 0,
    orphan.total ? ('พบ ' + orphan.total + ' รายการที่อ้างถึงข้อมูลที่ไม่มีอยู่ — ' +
      'ครู ' + orphan.teacher + ' · จุด ' + orphan.point + ' · ช่วงเวลา ' + orphan.slot) : 'ครบถ้วน',
    'กดปุ่ม "ซ่อมข้อมูล" เพื่อล้างรายการที่เสียและสร้างตารางใหม่');

  // 7. โดเมน
  var domain = CFG_schoolDomain();
  warn('กำหนดโดเมนอีเมลโรงเรียน', !!domain,
    domain ? '@' + domain : 'ยังไม่กำหนด — ทุกบัญชีที่ลงทะเบียนเข้าใช้ได้',
    'ไปที่ ตั้งค่า > โรงเรียน');

  var errors = checks.filter(function (c) { return c.level === 'ERROR'; }).length;
  var warns = checks.filter(function (c) { return c.level === 'WARN'; }).length;

  return {
    ok: errors === 0,
    errors: errors,
    warnings: warns,
    checkedAt: nowIso(),
    user: { email: ctx.email, name: ctx.name, role: ctx.role, roleName: ctx.roleName },
    checks: checks,
    stats: {
      teachers: teachers, points: points, slots: slots,
      sheetReads: DB_STATS.sheetReads, memHits: DB_STATS.memHits, cacheHits: DB_STATS.cacheHits
    }
  };
}

/** นับรายการตารางรายวันที่อ้างถึงข้อมูลหลักที่ไม่มีอยู่ */
function DIAG_orphans_() {
  var teachers = indexBy(dbReadAll('TEACHERS'), 'id');
  var points = indexBy(dbReadAll('DUTY_POINTS'), 'id');
  var slots = indexBy(dbReadAll('TIME_SLOTS'), 'id');

  var res = { teacher: 0, point: 0, slot: 0, total: 0, ids: [] };
  dbReadAll('DAILY_SCHEDULE').forEach(function (r) {
    var bad = false;
    if (!teachers[str(r.effective_teacher_id)]) { res.teacher++; bad = true; }
    if (!points[str(r.point_id)]) { res.point++; bad = true; }
    if (!slots[str(r.slot_id)]) { res.slot++; bad = true; }
    if (bad) { res.total++; if (res.ids.length < 5000) res.ids.push(r.id); }
  });
  return res;
}

/**
 * ซ่อมข้อมูล — ลบตารางรายวันที่เชื่อมไม่ติดและยังไม่มีการเช็คอิน
 * ข้อมูลที่มีการเช็คอินแล้วจะไม่ถูกแตะต้อง
 */
function DIAG_repair(ctx) {
  AUTH_requireAdmin(ctx);
  return withLock(function () {
    var orphan = DIAG_orphans_();
    if (!orphan.total) return { removed: 0, kept: 0, message: 'ไม่พบข้อมูลที่ต้องซ่อม' };

    var hasLog = {};
    dbReadAll('DUTY_LOGS').forEach(function (l) { hasLog[l.schedule_id] = true; });

    var removable = orphan.ids.filter(function (id) { return !hasLog[id]; });
    var kept = orphan.ids.length - removable.length;

    var removed = 0;
    for (var i = 0; i < removable.length; i += 2000) {
      removed += dbHardDelete('DAILY_SCHEDULE', removable.slice(i, i + 2000));
    }

    DB_invalidateAll();
    AUDIT_log(ctx, 'DIAG_REPAIR', 'DAILY_SCHEDULE', '', null,
      { orphans: orphan.total, removed: removed, kept: kept });

    return {
      removed: removed, kept: kept,
      message: 'ลบรายการที่เชื่อมไม่ติด ' + removed + ' รายการ' +
        (kept ? ' (คงไว้ ' + kept + ' รายการที่มีการเช็คอินแล้ว)' : '') +
        ' — กรุณาสร้างตารางรายวันใหม่อีกครั้ง'
    };
  }, 120000);
}

/** ล้างแคชจากหน้าเว็บ */
function DIAG_clearCache(ctx) {
  AUTH_requireReviewer(ctx);
  DB_invalidateAll();
  PR_INDEX_CACHE = {};
  AUDIT_log(ctx, 'DIAG_CLEAR_CACHE', 'SYSTEM', '', null, null);
  return { ok: true, message: 'ล้างแคชเรียบร้อย' };
}

/* ---------------- เรียกจากตัวแก้ไข Apps Script ---------------- */

function ตรวจสอบระบบ() {
  var ctx = AUTH_context();
  if (!ctx.ok) { SETUP_toast_('เข้าสู่ระบบไม่สำเร็จ: ' + ctx.reason); return; }
  var r = DIAG_selfTest(ctx);
  var lines = r.checks.map(function (c) {
    return (c.ok ? '✓ ' : (c.level === 'WARN' ? '! ' : '✗ ')) + c.name +
      (c.detail ? ' — ' + c.detail : '');
  });
  SETUP_toast_('ผลการตรวจสอบระบบ\n\n' + lines.join('\n') +
    '\n\nข้อผิดพลาด ' + r.errors + ' · คำเตือน ' + r.warnings);
  AUDIT_flush();
}

function ซ่อมข้อมูล() {
  var ctx = AUTH_context();
  if (!ctx.ok) { SETUP_toast_('เข้าสู่ระบบไม่สำเร็จ: ' + ctx.reason); return; }
  var r = DIAG_repair(ctx);
  AUDIT_flush();
  SETUP_toast_(r.message);
}
