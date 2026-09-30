/**
 * TeacherService.gs — ทะเบียนครูและบุคลากร
 * ห้ามลบข้อมูลครูแบบถาวร หากมีประวัติการอยู่เวรให้เปลี่ยนเป็น INACTIVE
 */

/** รายชื่อครู — ครูทั่วไปเห็นเฉพาะข้อมูลพื้นฐาน */
function TEACHER_list(ctx, opts) {
  AUTH_require(ctx);
  var o = opts || {};
  var rows = dbReadAll('TEACHERS');

  var full = AUTH_canSeeOthers(ctx);

  var filtered = rows.filter(function (t) {
    if (!o.includeInactive && str(t.status) !== 'ACTIVE') return false;
    if (o.department && str(t.department) !== o.department) return false;
    if (o.role && str(t.role) !== o.role) return false;
    if (o.q) {
      var q = str(o.q).toLowerCase();
      var hay = (teacherFullName(t) + str(t.code) + str(t.email) + str(t.department)).toLowerCase();
      if (hay.indexOf(q) < 0) return false;
    }
    return true;
  });

  filtered = sortBy(filtered, ['department', 'first_name']);

  return filtered.map(function (t) {
    var base = {
      id: t.id, code: str(t.code), name: teacherFullName(t),
      department: str(t.department), status: str(t.status)
    };
    if (full || t.id === ctx.teacherId) {
      base.prefix = str(t.prefix);
      base.firstName = str(t.first_name);
      base.lastName = str(t.last_name);
      base.email = str(t.email);
      base.position = str(t.position);
      base.phone = str(t.phone);
      base.role = str(t.role);
      base.roleName = ROLES[str(t.role)] ? ROLES[str(t.role)].name : '';
      base.note = str(t.note);
    }
    return base;
  });
}

/** รายชื่อแบบย่อสำหรับ dropdown (ทุกคนเรียกได้ ใช้ตอนขอเปลี่ยนเวร) */
function TEACHER_options(ctx) {
  AUTH_require(ctx);
  return dbFind('TEACHERS', { status: 'ACTIVE' }).map(function (t) {
    return { id: t.id, name: teacherFullName(t), department: str(t.department), code: str(t.code) };
  }).sort(function (a, b) { return a.name < b.name ? -1 : 1; });
}

function TEACHER_get(ctx, id) {
  AUTH_requireSelfOrReviewer(ctx, id);
  var t = dbGetById('TEACHERS', id);
  if (!t) throw new Error('ไม่พบข้อมูลครูรายนี้');
  return {
    id: t.id, code: str(t.code), prefix: str(t.prefix),
    firstName: str(t.first_name), lastName: str(t.last_name), name: teacherFullName(t),
    email: str(t.email), department: str(t.department), position: str(t.position),
    phone: str(t.phone), role: str(t.role),
    roleName: ROLES[str(t.role)] ? ROLES[str(t.role)].name : '',
    status: str(t.status), note: str(t.note)
  };
}

function TEACHER_validate_(data, existingId) {
  var errors = [];
  if (!str(data.firstName)) errors.push('กรุณากรอกชื่อ');
  if (!str(data.lastName)) errors.push('กรุณากรอกนามสกุล');
  var email = str(data.email).toLowerCase();
  if (!email) errors.push('กรุณากรอกอีเมล');
  else if (!isEmail(email)) errors.push('รูปแบบอีเมลไม่ถูกต้อง');

  var domain = CFG_schoolDomain();
  if (domain && email && email.indexOf('@' + domain) < 0) {
    errors.push('อีเมลต้องอยู่ในโดเมน @' + domain);
  }

  if (data.role && !ROLES[str(data.role)]) errors.push('บทบาทไม่ถูกต้อง');

  if (email) {
    var dup = dbGetBy('TEACHERS', { email: email });
    if (dup && dup.id !== existingId) errors.push('อีเมลนี้ถูกใช้แล้วโดย ' + teacherFullName(dup));
  }
  var code = str(data.code);
  if (code) {
    var dupC = dbGetBy('TEACHERS', { code: code });
    if (dupC && dupC.id !== existingId) errors.push('รหัสครู ' + code + ' ซ้ำกับ ' + teacherFullName(dupC));
  }
  return errors;
}

function TEACHER_save(ctx, data) {
  AUTH_requireAdmin(ctx);
  var d = data || {};
  var id = str(d.id);

  var errors = TEACHER_validate_(d, id);
  if (errors.length) throw new Error(errors.join('\n'));

  var payload = {
    code: sanitizeText(d.code),
    prefix: sanitizeText(d.prefix),
    first_name: sanitizeText(d.firstName),
    last_name: sanitizeText(d.lastName),
    email: str(d.email).toLowerCase(),
    department: sanitizeText(d.department),
    position: sanitizeText(d.position),
    phone: sanitizeText(d.phone),
    role: str(d.role) || 'TEACHER',
    status: str(d.status) || 'ACTIVE',
    note: sanitizeText(d.note)
  };

  return withLock(function () {
    if (id) {
      var before = dbGetById('TEACHERS', id);
      if (!before) throw new Error('ไม่พบข้อมูลครูที่ต้องการแก้ไข');

      // กันการลดสิทธิ์ผู้ดูแลระบบคนสุดท้าย
      if (str(before.role) === 'SYS_ADMIN' && payload.role !== 'SYS_ADMIN') {
        var admins = dbFind('TEACHERS', { role: 'SYS_ADMIN', status: 'ACTIVE' });
        if (admins.length <= 1) throw new Error('ไม่สามารถลดสิทธิ์ผู้ดูแลระบบคนสุดท้ายได้');
      }

      var after = dbUpdate('TEACHERS', id, payload);
      AUDIT_log(ctx, 'TEACHER_UPDATE', 'TEACHERS', id, before, payload);
      return { id: id, name: teacherFullName(after) };
    }
    var created = dbInsert('TEACHERS', payload);
    AUDIT_log(ctx, 'TEACHER_CREATE', 'TEACHERS', created.id, null, payload);
    return { id: created.id, name: teacherFullName(created) };
  });
}

/** ระงับการใช้งาน (ไม่ลบถาวร) */
function TEACHER_setStatus(ctx, id, status) {
  AUTH_requireAdmin(ctx);
  var t = dbGetById('TEACHERS', id);
  if (!t) throw new Error('ไม่พบข้อมูลครูรายนี้');
  var s = str(status) === 'ACTIVE' ? 'ACTIVE' : 'INACTIVE';

  if (s === 'INACTIVE') {
    if (str(t.role) === 'SYS_ADMIN') {
      var admins = dbFind('TEACHERS', { role: 'SYS_ADMIN', status: 'ACTIVE' });
      if (admins.length <= 1) throw new Error('ไม่สามารถระงับผู้ดูแลระบบคนสุดท้ายได้');
    }
    var upcoming = SCHEDULE_upcomingCountForTeacher_(id);
    if (upcoming > 0) {
      AUDIT_log(ctx, 'TEACHER_INACTIVE_WITH_DUTY', 'TEACHERS', id, null,
        { upcoming: upcoming }, 'ครูรายนี้ยังมีเวรค้างอยู่ ' + upcoming + ' รายการ');
    }
  }

  dbUpdate('TEACHERS', id, { status: s });
  AUDIT_log(ctx, 'TEACHER_STATUS', 'TEACHERS', id, { status: t.status }, { status: s });
  return { id: id, status: s };
}

/** รายชื่อกลุ่มสาระ/ฝ่ายทั้งหมดที่มีอยู่ */
function TEACHER_departments(ctx) {
  AUTH_require(ctx);
  var seen = {};
  dbReadAll('TEACHERS').forEach(function (t) {
    var d = str(t.department);
    if (d) seen[d] = true;
  });
  return Object.keys(seen).sort();
}

/**
 * นำเข้าครูหลายรายการจากข้อความ CSV/TSV
 * หัวตาราง: รหัส, คำนำหน้า, ชื่อ, นามสกุล, อีเมล, กลุ่มสาระ, ตำแหน่ง, โทรศัพท์, บทบาท
 */
var TEACHER_IMPORT_HEADERS = [
  { key: 'code', aliases: ['รหัส', 'รหัสครู', 'code', 'id'] },
  { key: 'prefix', aliases: ['คำนำหน้า', 'prefix', 'title'] },
  { key: 'firstName', aliases: ['ชื่อ', 'firstname', 'first_name', 'name'] },
  { key: 'lastName', aliases: ['นามสกุล', 'สกุล', 'lastname', 'last_name', 'surname'] },
  { key: 'email', aliases: ['อีเมล', 'อีเมล์', 'email', 'e-mail'] },
  { key: 'department', aliases: ['กลุ่มสาระ', 'กลุ่ม', 'ฝ่าย', 'department', 'dept'] },
  { key: 'position', aliases: ['ตำแหน่ง', 'position'] },
  { key: 'phone', aliases: ['โทรศัพท์', 'เบอร์', 'โทร', 'phone', 'tel'] },
  { key: 'role', aliases: ['บทบาท', 'สิทธิ์', 'role'] }
];

function TEACHER_importPreview(ctx, text) {
  AUTH_requireAdmin(ctx);
  var rows = parseCsv(text);
  if (rows.length < 2) throw new Error('ข้อมูลไม่ครบ ต้องมีบรรทัดหัวตารางและอย่างน้อย 1 บรรทัดข้อมูล');

  var header = rows[0].map(function (h) { return str(h).toLowerCase(); });
  var colOf = {};
  TEACHER_IMPORT_HEADERS.forEach(function (h) {
    for (var i = 0; i < header.length; i++) {
      if (h.aliases.indexOf(header[i]) >= 0) { colOf[h.key] = i; return; }
    }
  });

  if (colOf.firstName === undefined || colOf.lastName === undefined || colOf.email === undefined) {
    throw new Error('ไม่พบคอลัมน์ที่จำเป็น — ต้องมี ชื่อ, นามสกุล, อีเมล');
  }

  var seenEmail = {};
  var out = rows.slice(1).map(function (r, idx) {
    var rec = {};
    Object.keys(colOf).forEach(function (k) { rec[k] = sanitizeText(r[colOf[k]]); });
    rec.email = str(rec.email).toLowerCase();
    rec.role = TEACHER_normalizeRole_(rec.role);
    rec._line = idx + 2;

    var errs = TEACHER_validate_(rec, '');
    if (rec.email && seenEmail[rec.email]) errs.push('อีเมลซ้ำกับบรรทัดที่ ' + seenEmail[rec.email]);
    else if (rec.email) seenEmail[rec.email] = rec._line;

    var existing = rec.email ? dbGetBy('TEACHERS', { email: rec.email }) : null;
    if (existing) {
      rec._mode = 'UPDATE';
      rec._existingId = existing.id;
      errs = errs.filter(function (e) { return e.indexOf('ถูกใช้แล้ว') < 0; });
    } else {
      rec._mode = 'CREATE';
    }

    rec._errors = errs;
    return rec;
  });

  return {
    total: out.length,
    ok: out.filter(function (r) { return !r._errors.length; }).length,
    error: out.filter(function (r) { return r._errors.length; }).length,
    create: out.filter(function (r) { return r._mode === 'CREATE' && !r._errors.length; }).length,
    update: out.filter(function (r) { return r._mode === 'UPDATE' && !r._errors.length; }).length,
    rows: out
  };
}

function TEACHER_normalizeRole_(v) {
  var s = str(v).toUpperCase();
  if (ROLES[s]) return s;
  var map = {
    'ผู้ดูแลระบบ': 'SYS_ADMIN', 'แอดมิน': 'SYS_ADMIN', 'ADMIN': 'SYS_ADMIN',
    'ผู้บริหาร': 'EXECUTIVE', 'ผอ': 'EXECUTIVE', 'รองผอ': 'EXECUTIVE',
    'หัวหน้างานเวร': 'DUTY_ADMIN', 'หัวหน้างาน': 'DUTY_ADMIN',
    'หัวหน้าเวร': 'DAILY_HEAD', 'หัวหน้าเวรประจำวัน': 'DAILY_HEAD',
    'ครู': 'TEACHER', '': 'TEACHER'
  };
  return map[str(v)] || 'TEACHER';
}

function TEACHER_importCommit(ctx, text) {
  AUTH_requireAdmin(ctx);
  var preview = TEACHER_importPreview(ctx, text);
  var valid = preview.rows.filter(function (r) { return !r._errors.length; });
  if (!valid.length) throw new Error('ไม่มีข้อมูลที่ผ่านการตรวจสอบ');

  return withLock(function () {
    var toCreate = [], toUpdate = [];
    valid.forEach(function (r) {
      var payload = {
        code: r.code, prefix: r.prefix, first_name: r.firstName, last_name: r.lastName,
        email: r.email, department: r.department, position: r.position,
        phone: r.phone, role: r.role || 'TEACHER', status: 'ACTIVE'
      };
      if (r._mode === 'UPDATE') toUpdate.push({ id: r._existingId, patch: payload });
      else toCreate.push(payload);
    });

    if (toCreate.length) dbInsertMany('TEACHERS', toCreate);
    if (toUpdate.length) dbUpdateMany('TEACHERS', toUpdate);

    AUDIT_log(ctx, 'TEACHER_IMPORT', 'TEACHERS', '', null,
      { created: toCreate.length, updated: toUpdate.length });

    return { created: toCreate.length, updated: toUpdate.length, skipped: preview.error };
  }, 60000);
}

/** ตัวอย่างไฟล์นำเข้า */
function TEACHER_importTemplate() {
  return 'รหัส,คำนำหน้า,ชื่อ,นามสกุล,อีเมล,กลุ่มสาระ,ตำแหน่ง,โทรศัพท์,บทบาท\n' +
    'T001,นาย,สมชาย,ใจดี,somchai@example.ac.th,วิทยาศาสตร์และเทคโนโลยี,ครูชำนาญการ,0812345678,ครู\n' +
    'T002,นาง,สมหญิง,ตั้งใจ,somying@example.ac.th,ภาษาไทย,ครูชำนาญการพิเศษ,0823456789,หัวหน้าเวร\n';
}
