/**
 * MasterService.gs — ข้อมูลหลัก: จุดเวร ช่วงเวลา ภาคเรียน ปฏิทิน
 */

/* ================================================================= */
/* จุดเวร                                                             */
/* ================================================================= */

function POINT_list(ctx, opts) {
  AUTH_require(ctx);
  var o = opts || {};
  var rows = dbReadAll('DUTY_POINTS').filter(function (p) {
    return o.includeInactive || str(p.status) === 'ACTIVE';
  });
  rows = sortBy(rows, ['sort_order', 'name']);
  return rows.map(function (p) {
    return {
      id: p.id, code: str(p.code), name: str(p.name), description: str(p.description),
      lat: num(p.lat), lng: num(p.lng),
      radius: num(p.radius_m, CFG_num('default_radius_m')),
      seatCount: num(p.seat_count, 1),
      rotationGroup: str(p.rotation_group) || 'DEFAULT',
      sortOrder: num(p.sort_order), status: str(p.status)
    };
  });
}

function POINT_save(ctx, data) {
  AUTH_requireAdmin(ctx);
  var d = data || {};
  var errors = [];
  if (!str(d.name)) errors.push('กรุณากรอกชื่อจุดเวร');
  if (num(d.seatCount, 0) < 1) errors.push('จำนวนที่นั่งต้องอย่างน้อย 1');
  if (num(d.seatCount, 0) > 20) errors.push('จำนวนที่นั่งต้องไม่เกิน 20');
  var lat = num(d.lat, 999), lng = num(d.lng, 999);
  if (lat < -90 || lat > 90) errors.push('ละติจูดไม่ถูกต้อง');
  if (lng < -180 || lng > 180) errors.push('ลองจิจูดไม่ถูกต้อง');
  if (num(d.radius, 0) < 10) errors.push('รัศมีต้องอย่างน้อย 10 เมตร');
  if (errors.length) throw new Error(errors.join('\n'));

  var payload = {
    code: sanitizeText(d.code),
    name: sanitizeText(d.name),
    description: sanitizeText(d.description),
    lat: lat, lng: lng,
    radius_m: num(d.radius, CFG_num('default_radius_m')),
    seat_count: num(d.seatCount, 1),
    rotation_group: sanitizeText(d.rotationGroup) || 'DEFAULT',
    sort_order: num(d.sortOrder, 99),
    status: str(d.status) || 'ACTIVE'
  };

  return withLock(function () {
    if (str(d.id)) {
      var before = dbGetById('DUTY_POINTS', d.id);
      if (!before) throw new Error('ไม่พบจุดเวรที่ต้องการแก้ไข');
      if (num(payload.seat_count) < num(before.seat_count)) {
        var used = dbFind('ASSIGNMENTS', { point_id: d.id, status: 'ACTIVE' })
          .filter(function (a) { return num(a.seat_no) > num(payload.seat_count); });
        if (used.length) {
          throw new Error('ลดจำนวนที่นั่งไม่ได้ — ยังมีการจัดเวรอยู่ที่ที่นั่งลำดับเกิน ' +
            payload.seat_count + ' จำนวน ' + used.length + ' รายการ');
        }
      }
      dbUpdate('DUTY_POINTS', d.id, payload);
      AUDIT_log(ctx, 'POINT_UPDATE', 'DUTY_POINTS', d.id, before, payload);
      return { id: d.id };
    }
    var created = dbInsert('DUTY_POINTS', payload);
    AUDIT_log(ctx, 'POINT_CREATE', 'DUTY_POINTS', created.id, null, payload);
    return { id: created.id };
  });
}

function POINT_setStatus(ctx, id, status) {
  AUTH_requireAdmin(ctx);
  var p = dbGetById('DUTY_POINTS', id);
  if (!p) throw new Error('ไม่พบจุดเวรนี้');
  var s = str(status) === 'ACTIVE' ? 'ACTIVE' : 'INACTIVE';
  dbUpdate('DUTY_POINTS', id, { status: s });
  AUDIT_log(ctx, 'POINT_STATUS', 'DUTY_POINTS', id, { status: p.status }, { status: s });
  return { id: id, status: s };
}

/** กลุ่มการหมุนจุดทั้งหมด */
function POINT_rotationGroups(ctx) {
  AUTH_require(ctx);
  var seen = {};
  dbFind('DUTY_POINTS', { status: 'ACTIVE' }).forEach(function (p) {
    seen[str(p.rotation_group) || 'DEFAULT'] = true;
  });
  return Object.keys(seen).sort();
}

/* ================================================================= */
/* ช่วงเวลา                                                           */
/* ================================================================= */

function SLOT_list(ctx, opts) {
  AUTH_require(ctx);
  var o = opts || {};
  var rows = dbReadAll('TIME_SLOTS').filter(function (s) {
    return o.includeInactive || str(s.status) === 'ACTIVE';
  });
  rows = sortBy(rows, ['sort_order', 'start_time']);
  return rows.map(function (s) {
    return {
      id: s.id, code: str(s.code), name: str(s.name),
      startTime: str(s.start_time), endTime: str(s.end_time),
      sortOrder: num(s.sort_order), status: str(s.status)
    };
  });
}

function SLOT_save(ctx, data) {
  AUTH_requireAdmin(ctx);
  var d = data || {};
  var errors = [];
  if (!str(d.name)) errors.push('กรุณากรอกชื่อช่วงเวลา');
  var a = minutesOfDay(d.startTime), b = minutesOfDay(d.endTime);
  if (a < 0) errors.push('เวลาเริ่มไม่ถูกต้อง (รูปแบบ HH:mm)');
  if (b < 0) errors.push('เวลาสิ้นสุดไม่ถูกต้อง (รูปแบบ HH:mm)');
  if (a >= 0 && b >= 0 && b <= a) errors.push('เวลาสิ้นสุดต้องหลังเวลาเริ่ม');
  if (errors.length) throw new Error(errors.join('\n'));

  var payload = {
    code: sanitizeText(d.code),
    name: sanitizeText(d.name),
    start_time: str(d.startTime),
    end_time: str(d.endTime),
    sort_order: num(d.sortOrder, 99),
    status: str(d.status) || 'ACTIVE'
  };

  return withLock(function () {
    if (str(d.id)) {
      var before = dbGetById('TIME_SLOTS', d.id);
      if (!before) throw new Error('ไม่พบช่วงเวลาที่ต้องการแก้ไข');
      dbUpdate('TIME_SLOTS', d.id, payload);
      AUDIT_log(ctx, 'SLOT_UPDATE', 'TIME_SLOTS', d.id, before, payload);
      return { id: d.id };
    }
    var created = dbInsert('TIME_SLOTS', payload);
    AUDIT_log(ctx, 'SLOT_CREATE', 'TIME_SLOTS', created.id, null, payload);
    return { id: created.id };
  });
}

function SLOT_setStatus(ctx, id, status) {
  AUTH_requireAdmin(ctx);
  var s = dbGetById('TIME_SLOTS', id);
  if (!s) throw new Error('ไม่พบช่วงเวลานี้');
  var v = str(status) === 'ACTIVE' ? 'ACTIVE' : 'INACTIVE';
  dbUpdate('TIME_SLOTS', id, { status: v });
  AUDIT_log(ctx, 'SLOT_STATUS', 'TIME_SLOTS', id, { status: s.status }, { status: v });
  return { id: id, status: v };
}

/* ================================================================= */
/* ภาคเรียน                                                           */
/* ================================================================= */

function SEMESTER_list(ctx) {
  AUTH_require(ctx);
  var rows = dbReadAll('SEMESTERS');
  rows = sortBy(rows, ['-year_be', '-term']);
  return rows.map(SEMESTER_dto_);
}

function SEMESTER_dto_(s) {
  var y = num(s.year_be), t = num(s.term);
  var valid = y >= 2500 && (t === 1 || t === 2);
  var fallback = valid ? ('ภาคเรียนที่ ' + t + '/' + y) : 'ภาคเรียน (ข้อมูลยังไม่ครบ)';
  return {
    id: s.id, yearBe: y, term: t, valid: valid,
    name: str(s.name) || fallback,
    startDate: toDateStr(s.start_date), endDate: toDateStr(s.end_date),
    startDateThai: thaiDate(toDateStr(s.start_date)),
    endDateThai: thaiDate(toDateStr(s.end_date)),
    isActive: bool(s.is_active), prevSemesterId: str(s.prev_semester_id),
    status: str(s.status)
  };
}

/** ภาคเรียนที่ใช้งานอยู่ */
function SEMESTER_active() {
  var rows = dbReadAll('SEMESTERS');
  for (var i = 0; i < rows.length; i++) {
    if (bool(rows[i].is_active)) return rows[i];
  }
  return null;
}

/** ภาคเรียนที่ครอบคลุมวันที่นี้ (ถ้าไม่มี ใช้ภาคเรียนที่ใช้งานอยู่) */
function SEMESTER_forDate(ds) {
  var d = toDateStr(ds);
  var rows = dbReadAll('SEMESTERS');
  for (var i = 0; i < rows.length; i++) {
    var s = rows[i];
    if (d >= toDateStr(s.start_date) && d <= toDateStr(s.end_date)) return s;
  }
  return SEMESTER_active();
}

function SEMESTER_save(ctx, data) {
  AUTH_requireAdmin(ctx);
  var d = data || {};
  var errors = [];
  if (num(d.yearBe, 0) < 2500) errors.push('ปีการศึกษาต้องเป็น พ.ศ. เช่น 2569');
  if ([1, 2].indexOf(num(d.term, 0)) < 0) errors.push('ภาคเรียนต้องเป็น 1 หรือ 2');
  var sd = toDateStr(d.startDate), ed = toDateStr(d.endDate);
  if (!sd) errors.push('กรุณาระบุวันเปิดภาคเรียน');
  if (!ed) errors.push('กรุณาระบุวันปิดภาคเรียน');
  if (sd && ed && ed <= sd) errors.push('วันปิดภาคเรียนต้องหลังวันเปิด');
  if (errors.length) throw new Error(errors.join('\n'));

  var payload = {
    year_be: num(d.yearBe), term: num(d.term),
    name: sanitizeText(d.name) || ('ภาคเรียนที่ ' + num(d.term) + '/' + num(d.yearBe)),
    // ชื่อถูกสร้างหลังผ่านการตรวจความถูกต้องแล้ว จึงไม่มีทางเป็น "1/0"
    start_date: sd, end_date: ed,
    prev_semester_id: str(d.prevSemesterId),
    is_active: bool(d.isActive) ? 'TRUE' : 'FALSE',
    status: str(d.status) || 'ACTIVE'
  };

  return withLock(function () {
    var id = str(d.id);
    if (id) {
      var before = dbGetById('SEMESTERS', id);
      if (!before) throw new Error('ไม่พบภาคเรียนที่ต้องการแก้ไข');
      dbUpdate('SEMESTERS', id, payload);
      AUDIT_log(ctx, 'SEMESTER_UPDATE', 'SEMESTERS', id, before, payload);
    } else {
      var dup = dbGetBy('SEMESTERS', { year_be: num(d.yearBe), term: num(d.term) });
      if (dup) throw new Error('มีภาคเรียนที่ ' + d.term + '/' + d.yearBe + ' อยู่แล้ว');
      var created = dbInsert('SEMESTERS', payload);
      id = created.id;
      AUDIT_log(ctx, 'SEMESTER_CREATE', 'SEMESTERS', id, null, payload);
    }
    if (bool(d.isActive)) SEMESTER_activate_(ctx, id);
    return { id: id };
  });
}

function SEMESTER_activate(ctx, id) {
  AUTH_requireAdmin(ctx);
  return withLock(function () { return SEMESTER_activate_(ctx, id); });
}

function SEMESTER_activate_(ctx, id) {
  var rows = dbReadAll('SEMESTERS');
  var items = rows.map(function (s) {
    return { id: s.id, patch: { is_active: s.id === id ? 'TRUE' : 'FALSE' } };
  });
  dbUpdateMany('SEMESTERS', items);
  AUDIT_log(ctx, 'SEMESTER_ACTIVATE', 'SEMESTERS', id, null, null);
  return { id: id };
}

/* ================================================================= */
/* ปฏิทิน (วันหยุด / วันพิเศษ)                                        */
/* ================================================================= */

var DAY_TYPES = {
  SCHOOL:  'วันเรียนปกติ',
  HOLIDAY: 'วันหยุด',
  EVENT:   'กิจกรรมพิเศษ (มีเวร)',
  CLOSED:  'ปิดเรียน (ไม่มีเวร)'
};

function CAL_list(ctx, semesterId) {
  AUTH_require(ctx);
  var sid = str(semesterId) || (SEMESTER_active() || {}).id;
  if (!sid) return [];
  var rows = dbFind('CALENDAR_DAYS', { semester_id: sid });
  rows = sortBy(rows, ['date']);
  return rows.map(function (c) {
    return {
      id: c.id, semesterId: c.semester_id, date: toDateStr(c.date),
      dateThai: thaiDate(toDateStr(c.date), { weekday: true }),
      dayType: str(c.day_type), dayTypeName: DAY_TYPES[str(c.day_type)] || str(c.day_type),
      note: str(c.note)
    };
  });
}

function CAL_save(ctx, data) {
  AUTH_requireAdmin(ctx);
  var d = data || {};
  var date = toDateStr(d.date);
  if (!date) throw new Error('กรุณาระบุวันที่');
  if (!DAY_TYPES[str(d.dayType)]) throw new Error('ประเภทวันไม่ถูกต้อง');

  var sid = str(d.semesterId) || (SEMESTER_forDate(date) || {}).id;
  if (!sid) throw new Error('ไม่พบภาคเรียนสำหรับวันที่นี้');

  return withLock(function () {
    var existing = dbFind('CALENDAR_DAYS', { semester_id: sid, date: date })[0];
    var payload = {
      semester_id: sid, date: date,
      day_type: str(d.dayType), note: sanitizeText(d.note)
    };
    if (existing) {
      dbUpdate('CALENDAR_DAYS', existing.id, payload);
      AUDIT_log(ctx, 'CALENDAR_UPDATE', 'CALENDAR_DAYS', existing.id, existing, payload);
      return { id: existing.id };
    }
    var created = dbInsert('CALENDAR_DAYS', payload);
    AUDIT_log(ctx, 'CALENDAR_CREATE', 'CALENDAR_DAYS', created.id, null, payload);
    return { id: created.id };
  });
}

function CAL_remove(ctx, id) {
  AUTH_requireAdmin(ctx);
  var row = dbGetById('CALENDAR_DAYS', id);
  if (!row) throw new Error('ไม่พบรายการปฏิทินนี้');
  dbHardDelete('CALENDAR_DAYS', [id]);
  AUDIT_log(ctx, 'CALENDAR_DELETE', 'CALENDAR_DAYS', id, row, null);
  return { id: id };
}

/** เพิ่มวันหยุดหลายวันในครั้งเดียว (ช่วงวันที่) */
function CAL_addRange(ctx, semesterId, from, to, dayType, note) {
  AUTH_requireAdmin(ctx);
  var sid = str(semesterId) || (SEMESTER_active() || {}).id;
  if (!sid) throw new Error('ไม่พบภาคเรียน');
  var a = toDateStr(from), b = toDateStr(to);
  if (!a || !b || b < a) throw new Error('ช่วงวันที่ไม่ถูกต้อง');
  if (diffDays(a, b) > 180) throw new Error('ช่วงวันที่ยาวเกินไป (ไม่เกิน 180 วัน)');
  if (!DAY_TYPES[str(dayType)]) throw new Error('ประเภทวันไม่ถูกต้อง');

  return withLock(function () {
    var existing = indexBy(dbFind('CALENDAR_DAYS', { semester_id: sid }), 'date');
    var creates = [], updates = [];
    for (var d = a; d <= b; d = addDays(d, 1)) {
      var payload = { semester_id: sid, date: d, day_type: str(dayType), note: sanitizeText(note) };
      if (existing[d]) updates.push({ id: existing[d].id, patch: payload });
      else creates.push(payload);
    }
    if (creates.length) dbInsertMany('CALENDAR_DAYS', creates);
    if (updates.length) dbUpdateMany('CALENDAR_DAYS', updates);
    AUDIT_log(ctx, 'CALENDAR_RANGE', 'CALENDAR_DAYS', sid, null,
      { from: a, to: b, dayType: dayType, created: creates.length, updated: updates.length });
    return { created: creates.length, updated: updates.length };
  }, 60000);
}

/** map วันที่ -> ประเภทวัน สำหรับภาคเรียนหนึ่ง */
function CAL_map_(semesterId) {
  var map = {};
  dbFind('CALENDAR_DAYS', { semester_id: semesterId }).forEach(function (c) {
    map[toDateStr(c.date)] = str(c.day_type);
  });
  return map;
}

/** วันนี้เป็นวันที่ต้องมีเวรหรือไม่ */
function CAL_isDutyDay(ds, semesterId, calMap) {
  var d = toDateStr(ds);
  if (!d) return false;
  var w = weekdayOf(d);
  var map = calMap || CAL_map_(semesterId);
  var t = map[d];
  if (t === 'HOLIDAY' || t === 'CLOSED') return false;
  if (t === 'EVENT' || t === 'SCHOOL') return true;
  return w >= 1 && w <= 5;   // ไม่ระบุ = จันทร์-ศุกร์มีเวร
}

function CAL_dayTypeOptions() {
  return Object.keys(DAY_TYPES).map(function (k) {
    return { value: k, label: DAY_TYPES[k] };
  });
}
