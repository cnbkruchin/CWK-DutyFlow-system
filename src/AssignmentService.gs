/**
 * AssignmentService.gs — กระดานจัดเวรประจำภาคเรียน และการปักหมุดจุดเฉพาะบุคคล
 *
 * ASSIGNMENTS คือ "แม่แบบ" ของภาคเรียน (วันจันทร์-ศุกร์ × ช่วงเวลา × จุด × ที่นั่ง)
 * DAILY_SCHEDULE คือตารางจริงรายวันที่สร้างจากแม่แบบนี้
 */

var PIN_MODES = {
  NONE:  'ไม่ปักหมุด (หมุนได้อิสระ)',
  POINT: 'ตรึงจุด (หมุนวันได้)',
  DAY:   'ตรึงวัน (หมุนจุดได้)',
  ALL:   'ตรึงทั้งวันและจุด'
};

var ROTATION_SCOPES = {
  BOTH:       'หมุนทั้งวันและจุด',
  DAY_ONLY:   'หมุนเฉพาะวัน',
  POINT_ONLY: 'หมุนเฉพาะจุด',
  NONE:       'ไม่หมุน',
  LOCKED:     'ล็อกถาวร'
};

function ASSIGN_pinOptions() {
  return Object.keys(PIN_MODES).map(function (k) { return { value: k, label: PIN_MODES[k] }; });
}

function ASSIGN_scopeOptions() {
  return Object.keys(ROTATION_SCOPES).map(function (k) { return { value: k, label: ROTATION_SCOPES[k] }; });
}

/**
 * กระดานจัดเวรทั้งภาคเรียน
 * ครูทั่วไปดูได้เฉพาะแถวของตนเอง — ผู้มีสิทธิ์ตรวจดูได้ทั้งหมด
 */
function ASSIGN_board(ctx, opts) {
  AUTH_require(ctx);
  var o = opts || {};
  var semester = o.semesterId ? dbGetById('SEMESTERS', o.semesterId) : SEMESTER_active();
  if (!semester) return { semester: null, slots: [], points: [], rows: [], canEdit: false };

  var canSeeAll = AUTH_canSeeOthers(ctx);
  var canEdit = ctx.level >= ROLES.DUTY_ADMIN.level;

  var teachers = indexBy(dbReadAll('TEACHERS'), 'id');
  var points = sortBy(dbFind('DUTY_POINTS', { status: 'ACTIVE' }), ['sort_order', 'name']);
  var slots = sortBy(dbFind('TIME_SLOTS', { status: 'ACTIVE' }), ['sort_order', 'start_time']);
  var pointById = indexBy(points, 'id');

  var rows = dbFind('ASSIGNMENTS', { semester_id: semester.id, status: 'ACTIVE' });
  if (!canSeeAll) {
    rows = rows.filter(function (a) { return a.teacher_id === ctx.teacherId; });
  }
  if (o.weekday) rows = rows.filter(function (a) { return num(a.weekday) === num(o.weekday); });
  if (o.pointId) rows = rows.filter(function (a) { return a.point_id === o.pointId; });
  if (o.teacherId && canSeeAll) rows = rows.filter(function (a) { return a.teacher_id === o.teacherId; });

  var dto = rows.map(function (a) {
    var p = pointById[a.point_id] || {};
    var t = teachers[a.teacher_id];
    return {
      id: a.id,
      weekday: num(a.weekday),
      weekdayName: thaiWeekday(num(a.weekday)),
      slotId: a.slot_id,
      pointId: a.point_id,
      pointName: str(p.name),
      seatNo: num(a.seat_no),
      teacherId: a.teacher_id,
      teacherName: teacherFullName(t),
      department: t ? str(t.department) : '',
      rotationGroup: str(a.rotation_group) || str(p.rotation_group) || 'DEFAULT',
      rotationOrder: num(a.rotation_order, 999),
      rotationScope: str(a.rotation_scope) || 'BOTH',
      rotationScopeLabel: ROTATION_SCOPES[str(a.rotation_scope) || 'BOTH'],
      pinMode: str(a.pin_mode) || 'NONE',
      pinModeLabel: PIN_MODES[str(a.pin_mode) || 'NONE'],
      pinReason: str(a.pin_reason),
      pinAt: str(a.pin_at),
      pinByName: teacherFullName(teachers[a.pin_by])
    };
  });

  return {
    semester: SEMESTER_dto_(semester),
    canEdit: canEdit,
    canSeeAll: canSeeAll,
    weekdays: [1, 2, 3, 4, 5].map(function (w) { return { value: w, label: thaiWeekday(w) }; }),
    slots: slots.map(function (s) {
      return { id: s.id, name: str(s.name), startTime: str(s.start_time), endTime: str(s.end_time) };
    }),
    points: points.map(function (p) {
      return {
        id: p.id, name: str(p.name), seatCount: num(p.seat_count, 1),
        rotationGroup: str(p.rotation_group) || 'DEFAULT'
      };
    }),
    rows: sortBy(dto, ['weekday', 'slotId', 'pointName', 'seatNo'])
  };
}

function ASSIGN_validate_(d, existingId) {
  var errors = [];
  var w = num(d.weekday, 0);
  if (w < 1 || w > 5) errors.push('วันต้องอยู่ระหว่างจันทร์ถึงศุกร์');
  if (!str(d.slotId)) errors.push('กรุณาเลือกช่วงเวลา');
  if (!str(d.pointId)) errors.push('กรุณาเลือกจุดเวร');
  if (!str(d.teacherId)) errors.push('กรุณาเลือกครู');

  var seat = num(d.seatNo, 0);
  if (seat < 1) errors.push('ลำดับที่นั่งต้องอย่างน้อย 1');

  var point = dbGetById('DUTY_POINTS', d.pointId);
  if (!point) errors.push('ไม่พบจุดเวรที่เลือก');
  else if (seat > num(point.seat_count, 1)) {
    errors.push('จุด "' + point.name + '" มีเพียง ' + num(point.seat_count, 1) + ' ที่นั่ง');
  }

  var teacher = dbGetById('TEACHERS', d.teacherId);
  if (!teacher) errors.push('ไม่พบครูที่เลือก');
  else if (str(teacher.status) !== 'ACTIVE') errors.push('ครูรายนี้ถูกระงับการใช้งาน');

  if (str(d.pinMode) && !PIN_MODES[str(d.pinMode)]) errors.push('โหมดปักหมุดไม่ถูกต้อง');
  if (str(d.rotationScope) && !ROTATION_SCOPES[str(d.rotationScope)]) errors.push('ขอบเขตการหมุนไม่ถูกต้อง');

  var sid = str(d.semesterId);
  var siblings = dbFind('ASSIGNMENTS', { semester_id: sid, weekday: w, slot_id: str(d.slotId), status: 'ACTIVE' });

  // ที่นั่งซ้ำ
  var seatDup = siblings.filter(function (a) {
    return a.point_id === str(d.pointId) && num(a.seat_no) === seat && a.id !== existingId;
  });
  if (seatDup.length) errors.push('ที่นั่งลำดับ ' + seat + ' ของจุดนี้ถูกจัดไว้แล้ว');

  // ครูซ้อนสองจุดในช่วงเวลาเดียวกัน
  var clash = siblings.filter(function (a) {
    return a.teacher_id === str(d.teacherId) && a.id !== existingId;
  });
  if (clash.length) {
    var cp = dbGetById('DUTY_POINTS', clash[0].point_id);
    errors.push('ครูรายนี้มีเวรที่ "' + (cp ? cp.name : 'จุดอื่น') + '" ในวันและช่วงเวลาเดียวกันแล้ว');
  }

  return errors;
}

function ASSIGN_save(ctx, data) {
  AUTH_requireAdmin(ctx);
  var d = data || {};
  if (!str(d.semesterId)) {
    var active = SEMESTER_active();
    if (!active) throw new Error('ยังไม่ได้กำหนดภาคเรียนที่ใช้งาน');
    d.semesterId = active.id;
  }

  var id = str(d.id);
  var errors = ASSIGN_validate_(d, id);
  if (errors.length) throw new Error(errors.join('\n'));

  var point = dbGetById('DUTY_POINTS', d.pointId);
  var payload = {
    semester_id: str(d.semesterId),
    weekday: num(d.weekday),
    slot_id: str(d.slotId),
    point_id: str(d.pointId),
    seat_no: num(d.seatNo, 1),
    teacher_id: str(d.teacherId),
    rotation_group: sanitizeText(d.rotationGroup) || str(point.rotation_group) || 'DEFAULT',
    rotation_order: num(d.rotationOrder, 999),
    rotation_scope: str(d.rotationScope) || 'BOTH',
    status: 'ACTIVE'
  };

  return withLock(function () {
    if (id) {
      var before = dbGetById('ASSIGNMENTS', id);
      if (!before) throw new Error('ไม่พบรายการจัดเวรที่ต้องการแก้ไข');
      dbUpdate('ASSIGNMENTS', id, payload);
      AUDIT_log(ctx, 'ASSIGN_UPDATE', 'ASSIGNMENTS', id, before, payload);
      return { id: id };
    }
    payload.pin_mode = 'NONE';
    var created = dbInsert('ASSIGNMENTS', payload);
    AUDIT_log(ctx, 'ASSIGN_CREATE', 'ASSIGNMENTS', created.id, null, payload);
    return { id: created.id };
  });
}

function ASSIGN_remove(ctx, id) {
  AUTH_requireAdmin(ctx);
  var row = dbGetById('ASSIGNMENTS', id);
  if (!row) throw new Error('ไม่พบรายการจัดเวรนี้');
  dbUpdate('ASSIGNMENTS', id, { status: 'INACTIVE' });
  AUDIT_log(ctx, 'ASSIGN_REMOVE', 'ASSIGNMENTS', id, row, { status: 'INACTIVE' });
  return { id: id };
}

/** เปลี่ยนครูของที่นั่งเดียว (ลากวางบนกระดาน) */
function ASSIGN_setTeacher(ctx, id, teacherId) {
  AUTH_requireAdmin(ctx);
  var row = dbGetById('ASSIGNMENTS', id);
  if (!row) throw new Error('ไม่พบรายการจัดเวรนี้');

  var d = {
    id: id, semesterId: row.semester_id, weekday: row.weekday, slotId: row.slot_id,
    pointId: row.point_id, seatNo: row.seat_no, teacherId: str(teacherId),
    pinMode: row.pin_mode, rotationScope: row.rotation_scope
  };
  var errors = ASSIGN_validate_(d, id);
  if (errors.length) throw new Error(errors.join('\n'));

  dbUpdate('ASSIGNMENTS', id, { teacher_id: str(teacherId) });
  AUDIT_log(ctx, 'ASSIGN_SET_TEACHER', 'ASSIGNMENTS', id,
    { teacher_id: row.teacher_id }, { teacher_id: str(teacherId) });
  return { id: id };
}

/* ================================================================= */
/* การปักหมุดจุดเฉพาะบุคคล                                            */
/* ================================================================= */

/**
 * รายการที่นั่งพร้อมสถานะปักหมุด
 * หัวหน้าเวรประจำวัน "ดูได้" แต่แก้ไม่ได้
 */
function PIN_list(ctx, opts) {
  AUTH_requireReviewer(ctx);
  var o = opts || {};
  var semester = o.semesterId ? dbGetById('SEMESTERS', o.semesterId) : SEMESTER_active();
  if (!semester) return { canEdit: false, rows: [], semester: null };

  var teachers = indexBy(dbReadAll('TEACHERS'), 'id');
  var points = indexBy(dbReadAll('DUTY_POINTS'), 'id');
  var slots = indexBy(dbReadAll('TIME_SLOTS'), 'id');

  var rows = dbFind('ASSIGNMENTS', { semester_id: semester.id, status: 'ACTIVE' });
  if (o.onlyPinned) {
    rows = rows.filter(function (a) { return str(a.pin_mode) && str(a.pin_mode) !== 'NONE'; });
  }

  var dto = rows.map(function (a) {
    var p = points[a.point_id] || {};
    return {
      id: a.id,
      weekday: num(a.weekday), weekdayName: thaiWeekday(num(a.weekday)),
      slotName: str((slots[a.slot_id] || {}).name),
      pointName: str(p.name), seatNo: num(a.seat_no),
      teacherName: teacherFullName(teachers[a.teacher_id]),
      department: str((teachers[a.teacher_id] || {}).department),
      rotationGroup: str(a.rotation_group) || str(p.rotation_group) || 'DEFAULT',
      pinMode: str(a.pin_mode) || 'NONE',
      pinModeLabel: PIN_MODES[str(a.pin_mode) || 'NONE'],
      pinReason: str(a.pin_reason),
      pinAt: str(a.pin_at),
      pinByName: teacherFullName(teachers[a.pin_by]),
      rotationScope: str(a.rotation_scope) || 'BOTH'
    };
  });

  return {
    semester: SEMESTER_dto_(semester),
    canEdit: ctx.level >= ROLES.DUTY_ADMIN.level,
    pinOptions: ASSIGN_pinOptions(),
    scopeOptions: ASSIGN_scopeOptions(),
    summary: {
      total: dto.length,
      pinned: dto.filter(function (r) { return r.pinMode !== 'NONE'; }).length
    },
    rows: sortBy(dto, ['weekday', 'slotName', 'pointName', 'seatNo'])
  };
}

/** ปักหมุด — ต้องกรอกเหตุผลเสมอ */
function PIN_set(ctx, assignmentId, pinMode, reason) {
  AUTH_requireAdmin(ctx);
  var mode = str(pinMode) || 'NONE';
  if (!PIN_MODES[mode]) throw new Error('โหมดปักหมุดไม่ถูกต้อง');

  var row = dbGetById('ASSIGNMENTS', assignmentId);
  if (!row) throw new Error('ไม่พบรายการจัดเวรนี้');

  var r = sanitizeText(reason);
  if (mode !== 'NONE' && r.length < 5) {
    throw new Error('กรุณาระบุเหตุผลการปักหมุดอย่างน้อย 5 ตัวอักษร');
  }

  var patch = {
    pin_mode: mode,
    pin_reason: mode === 'NONE' ? '' : r,
    pin_by: mode === 'NONE' ? '' : ctx.teacherId,
    pin_at: mode === 'NONE' ? '' : nowIso()
  };

  dbUpdate('ASSIGNMENTS', assignmentId, patch);
  AUDIT_log(ctx, mode === 'NONE' ? 'PIN_CLEAR' : 'PIN_SET', 'ASSIGNMENTS', assignmentId,
    { pin_mode: row.pin_mode, pin_reason: row.pin_reason }, patch);
  return { id: assignmentId, pinMode: mode };
}

function PIN_clear(ctx, assignmentId) {
  return PIN_set(ctx, assignmentId, 'NONE', '');
}

/** ปักหมุดหลายรายการพร้อมกัน */
function PIN_setMany(ctx, ids, pinMode, reason) {
  AUTH_requireAdmin(ctx);
  var mode = str(pinMode) || 'NONE';
  if (!PIN_MODES[mode]) throw new Error('โหมดปักหมุดไม่ถูกต้อง');
  var r = sanitizeText(reason);
  if (mode !== 'NONE' && r.length < 5) {
    throw new Error('กรุณาระบุเหตุผลการปักหมุดอย่างน้อย 5 ตัวอักษร');
  }
  var list = (ids || []).filter(function (i) { return !!str(i); });
  if (!list.length) throw new Error('ยังไม่ได้เลือกรายการ');

  return withLock(function () {
    var ts = nowIso();
    var items = list.map(function (id) {
      return {
        id: id,
        patch: {
          pin_mode: mode,
          pin_reason: mode === 'NONE' ? '' : r,
          pin_by: mode === 'NONE' ? '' : ctx.teacherId,
          pin_at: mode === 'NONE' ? '' : ts
        }
      };
    });
    var res = dbUpdateMany('ASSIGNMENTS', items);
    AUDIT_log(ctx, 'PIN_SET_MANY', 'ASSIGNMENTS', '', null,
      { ids: list, pinMode: mode, reason: r, updated: res.length });
    return { updated: res.length, pinMode: mode };
  }, 40000);
}

/** ตั้งขอบเขตการหมุนของที่นั่ง */
function ASSIGN_setScope(ctx, assignmentId, scope) {
  AUTH_requireAdmin(ctx);
  var s = str(scope);
  if (!ROTATION_SCOPES[s]) throw new Error('ขอบเขตการหมุนไม่ถูกต้อง');
  var row = dbGetById('ASSIGNMENTS', assignmentId);
  if (!row) throw new Error('ไม่พบรายการจัดเวรนี้');
  dbUpdate('ASSIGNMENTS', assignmentId, { rotation_scope: s });
  AUDIT_log(ctx, 'ASSIGN_SET_SCOPE', 'ASSIGNMENTS', assignmentId,
    { rotation_scope: row.rotation_scope }, { rotation_scope: s });
  return { id: assignmentId, scope: s };
}

/** ตั้งลำดับในวงหมุนหลายรายการ */
function ASSIGN_setRotationOrder(ctx, items) {
  AUTH_requireAdmin(ctx);
  var list = (items || []).filter(function (i) { return str(i.id); });
  if (!list.length) throw new Error('ไม่มีรายการให้ปรับ');
  var patches = list.map(function (i) {
    return { id: str(i.id), patch: { rotation_order: num(i.order, 999) } };
  });
  var res = dbUpdateMany('ASSIGNMENTS', patches);
  AUDIT_log(ctx, 'ASSIGN_ROTATION_ORDER', 'ASSIGNMENTS', '', null, { count: res.length });
  return { updated: res.length };
}

/** สรุปภาระเวรของครูแต่ละคนในภาคเรียน (ใช้ตรวจความเป็นธรรม) */
function ASSIGN_workload(ctx, semesterId) {
  AUTH_requireReviewer(ctx);
  var semester = str(semesterId) ? dbGetById('SEMESTERS', semesterId) : SEMESTER_active();
  if (!semester) return { rows: [] };

  var teachers = dbFind('TEACHERS', { status: 'ACTIVE' });
  var rows = dbFind('ASSIGNMENTS', { semester_id: semester.id, status: 'ACTIVE' });
  var byTeacher = groupBy(rows, function (a) { return a.teacher_id; });

  var out = teachers.map(function (t) {
    var list = byTeacher[t.id] || [];
    var days = {};
    list.forEach(function (a) { days[num(a.weekday)] = true; });
    return {
      teacherId: t.id,
      name: teacherFullName(t),
      department: str(t.department),
      count: list.length,
      weekdays: Object.keys(days).map(Number).sort().map(thaiWeekday).join(', '),
      pinned: list.filter(function (a) { return str(a.pin_mode) && str(a.pin_mode) !== 'NONE'; }).length
    };
  });

  return {
    semester: SEMESTER_dto_(semester),
    rows: sortBy(out, ['-count', 'name']),
    stats: {
      assigned: out.filter(function (r) { return r.count > 0; }).length,
      unassigned: out.filter(function (r) { return r.count === 0; }).length,
      total: out.length,
      seats: rows.length
    }
  };
}
