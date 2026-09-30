/**
 * RotationService.gs — หมุน "วัน" ของเวรเมื่อขึ้นภาคเรียนใหม่
 * จันทร์ → อังคาร → พุธ → พฤหัสบดี → ศุกร์ → จันทร์
 *
 * ทำงานคู่กับ PointRotationService.gs ซึ่งหมุน "จุด" ภายในวัน
 */

/**
 * หมุนวัน: 1..5 (จันทร์..ศุกร์) เลื่อนไป shift วัน วนกลับมาที่จันทร์
 * rotateWeekday(5, 1) === 1
 */
function rotateWeekday(oldWeekday, dayShift) {
  var w = num(oldWeekday, 0);
  if (w < 1 || w > 5) return w;
  return mod((w - 1) + num(dayShift, 0), 5) + 1;
}

/** ที่นั่งนี้เข้าร่วมการหมุนวันหรือไม่ */
function ROT_participatesDay_(a) {
  var scope = str(a.rotation_scope) || 'BOTH';
  if (scope === 'LOCKED' || scope === 'NONE' || scope === 'POINT_ONLY') return false;
  var pin = str(a.pin_mode) || 'NONE';
  if (pin === 'DAY' || pin === 'ALL') return false;
  return true;
}

/**
 * พรีวิวการหมุนวันจากภาคเรียนหนึ่งไปอีกภาคเรียนหนึ่ง
 * ไม่แตะข้อมูลจริง
 */
function ROTATION_preview(ctx, opts) {
  AUTH_requireAdmin(ctx);
  var o = opts || {};
  var from = dbGetById('SEMESTERS', str(o.fromSemesterId));
  if (!from) throw new Error('กรุณาเลือกภาคเรียนต้นทาง');
  var shift = num(o.dayShift, num(CFG_get('day_rotation_shift', 1), 1));

  var teachers = indexBy(dbReadAll('TEACHERS'), 'id');
  var points = indexBy(dbReadAll('DUTY_POINTS'), 'id');
  var slots = indexBy(dbReadAll('TIME_SLOTS'), 'id');

  var rows = dbFind('ASSIGNMENTS', { semester_id: from.id, status: 'ACTIVE' });

  var out = rows.map(function (a) {
    var moves = ROT_participatesDay_(a);
    var newW = moves ? rotateWeekday(a.weekday, shift) : num(a.weekday);
    return {
      assignmentId: a.id,
      teacherName: teacherFullName(teachers[a.teacher_id]),
      pointName: str((points[a.point_id] || {}).name),
      slotName: str((slots[a.slot_id] || {}).name),
      seatNo: num(a.seat_no),
      fromWeekday: num(a.weekday),
      fromWeekdayName: thaiWeekday(num(a.weekday)),
      toWeekday: newW,
      toWeekdayName: thaiWeekday(newW),
      moved: moves && newW !== num(a.weekday),
      locked: !moves,
      pinMode: str(a.pin_mode) || 'NONE',
      rotationScope: str(a.rotation_scope) || 'BOTH'
    };
  });

  return {
    fromSemester: SEMESTER_dto_(from),
    dayShift: shift,
    total: out.length,
    moved: out.filter(function (r) { return r.moved; }).length,
    locked: out.filter(function (r) { return r.locked; }).length,
    rows: sortBy(out, ['fromWeekday', 'slotName', 'pointName', 'seatNo'])
  };
}

/**
 * คัดลอกแม่แบบจากภาคเรียนหนึ่งไปอีกภาคเรียน พร้อมหมุนวัน
 * ไม่ลบข้อมูลเดิม — ถ้าปลายทางมีข้อมูลอยู่แล้วต้องยืนยันเพื่อแทนที่
 */
function ROTATION_apply(ctx, opts) {
  AUTH_requireAdmin(ctx);
  var o = opts || {};
  var from = dbGetById('SEMESTERS', str(o.fromSemesterId));
  var to = dbGetById('SEMESTERS', str(o.toSemesterId));
  if (!from) throw new Error('กรุณาเลือกภาคเรียนต้นทาง');
  if (!to) throw new Error('กรุณาเลือกภาคเรียนปลายทาง');
  if (from.id === to.id) throw new Error('ภาคเรียนต้นทางและปลายทางต้องต่างกัน');

  var shift = num(o.dayShift, num(CFG_get('day_rotation_shift', 1), 1));
  var pointShift = num(o.pointShift, 0);
  var replace = bool(o.replace);

  return withLock(function () {
    var existing = dbFind('ASSIGNMENTS', { semester_id: to.id, status: 'ACTIVE' });
    if (existing.length && !replace) {
      throw new Error('ภาคเรียนปลายทางมีการจัดเวรอยู่แล้ว ' + existing.length +
        ' รายการ — กรุณายืนยันการแทนที่');
    }

    var source = dbFind('ASSIGNMENTS', { semester_id: from.id, status: 'ACTIVE' });
    if (!source.length) throw new Error('ภาคเรียนต้นทางยังไม่มีการจัดเวร');

    // ปิดของเดิม (ไม่ลบถาวร)
    if (existing.length) {
      dbUpdateMany('ASSIGNMENTS', existing.map(function (a) {
        return { id: a.id, patch: { status: 'REPLACED' } };
      }));
    }

    // หมุนวัน
    var rotated = source.map(function (a) {
      var moves = ROT_participatesDay_(a);
      return {
        semester_id: to.id,
        weekday: moves ? rotateWeekday(a.weekday, shift) : num(a.weekday),
        slot_id: a.slot_id,
        point_id: a.point_id,
        seat_no: num(a.seat_no),
        teacher_id: a.teacher_id,
        rotation_group: str(a.rotation_group) || 'DEFAULT',
        rotation_order: num(a.rotation_order, 999),
        rotation_scope: str(a.rotation_scope) || 'BOTH',
        pin_mode: str(a.pin_mode) || 'NONE',
        pin_reason: str(a.pin_reason),
        pin_by: str(a.pin_by),
        pin_at: str(a.pin_at),
        status: 'ACTIVE'
      };
    });

    // หมุนจุดครั้งเดียวต้นภาคเรียน (ถ้าสั่ง)
    if (pointShift) {
      var respectPin = CFG_bool('point_rotation_respect_pin');
      var pointsById = indexBy(dbReadAll('DUTY_POINTS'), 'id');
      var byDay = groupBy(rotated, function (r) { return r.weekday; });
      rotated = [];
      Object.keys(byDay).forEach(function (w) {
        var seats = byDay[w].map(function (r) {
          r._point_sort = num((pointsById[r.point_id] || {}).sort_order, 999);
          return r;
        });
        PR_applyToDay_(seats, pointShift, respectPin).forEach(function (s) {
          delete s._point_sort;
          rotated.push(s);
        });
      });
    }

    var created = dbInsertMany('ASSIGNMENTS', rotated);

    var history = dbInsert('ROTATION_HISTORY', {
      semester_id: to.id,
      from_semester_id: from.id,
      day_shift: shift,
      point_shift: pointShift,
      affected_count: created.length,
      undo_json: truncate(JSON.stringify({
        createdIds: created.map(function (c) { return c.id; }),
        replacedIds: existing.map(function (e) { return e.id; })
      }), 40000),
      status: 'APPLIED',
      applied_by: ctx.teacherId,
      applied_at: nowIso()
    });

    AUDIT_log(ctx, 'ROTATION_APPLY', 'SEMESTERS', to.id, null,
      { from: from.id, dayShift: shift, pointShift: pointShift, count: created.length });

    return {
      historyId: history.id,
      created: created.length,
      replaced: existing.length,
      dayShift: shift,
      pointShift: pointShift
    };
  }, 120000);
}

/** ย้อนกลับการหมุนครั้งล่าสุด */
function ROTATION_undo(ctx, historyId) {
  AUTH_requireAdmin(ctx);
  var h = dbGetById('ROTATION_HISTORY', historyId);
  if (!h) throw new Error('ไม่พบประวัติการหมุนเวรนี้');
  if (str(h.status) !== 'APPLIED') throw new Error('รายการนี้ถูกย้อนกลับไปแล้ว');

  var undo;
  try { undo = JSON.parse(str(h.undo_json) || '{}'); }
  catch (e) { throw new Error('ข้อมูลสำหรับย้อนกลับเสียหาย ไม่สามารถย้อนได้'); }

  return withLock(function () {
    // ตรวจว่ามีการสร้างตารางรายวันจากแม่แบบนี้ไปแล้วหรือยัง
    var used = dbFind('DAILY_SCHEDULE', { semester_id: h.semester_id });
    if (used.length) {
      throw new Error('ย้อนกลับไม่ได้ — มีการสร้างตารางรายวันของภาคเรียนนี้ไปแล้ว ' +
        used.length + ' รายการ กรุณาลบตารางรายวันก่อน');
    }

    if (undo.createdIds && undo.createdIds.length) {
      dbUpdateMany('ASSIGNMENTS', undo.createdIds.map(function (id) {
        return { id: id, patch: { status: 'UNDONE' } };
      }));
    }
    if (undo.replacedIds && undo.replacedIds.length) {
      dbUpdateMany('ASSIGNMENTS', undo.replacedIds.map(function (id) {
        return { id: id, patch: { status: 'ACTIVE' } };
      }));
    }

    dbUpdate('ROTATION_HISTORY', historyId, { status: 'UNDONE' });
    AUDIT_log(ctx, 'ROTATION_UNDO', 'ROTATION_HISTORY', historyId, h, { status: 'UNDONE' });
    return { historyId: historyId, restored: (undo.replacedIds || []).length };
  }, 120000);
}

/** ประวัติการหมุนเวร */
function ROTATION_history(ctx) {
  AUTH_requireReviewer(ctx);
  var teachers = indexBy(dbReadAll('TEACHERS'), 'id');
  var semesters = indexBy(dbReadAll('SEMESTERS'), 'id');
  var rows = dbReadAll('ROTATION_HISTORY');
  rows.sort(function (a, b) { return str(b.applied_at) < str(a.applied_at) ? -1 : 1; });
  return rows.map(function (h) {
    return {
      id: h.id,
      semesterName: str((semesters[h.semester_id] || {}).name),
      fromSemesterName: str((semesters[h.from_semester_id] || {}).name),
      dayShift: num(h.day_shift),
      pointShift: num(h.point_shift),
      affected: num(h.affected_count),
      status: str(h.status),
      appliedBy: teacherFullName(teachers[h.applied_by]),
      appliedAt: str(h.applied_at)
    };
  });
}
