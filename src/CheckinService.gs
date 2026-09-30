/**
 * CheckinService.gs — บันทึกการอยู่เวร (GPS + ภาพหลักฐาน)
 *
 * ห้ามตั้งสิทธิ์ภาพเป็น "ทุกคนที่มีลิงก์"
 */

var GEO_STATUS = {
  IN_RANGE:     'อยู่ในพื้นที่',
  NEAR:         'อยู่ใกล้พื้นที่',
  OUT_OF_RANGE: 'อยู่นอกพื้นที่',
  LOW_ACCURACY: 'สัญญาณ GPS อ่อน',
  NO_GPS:       'ไม่มีข้อมูล GPS',
  NOT_REQUIRED: 'ไม่บังคับ GPS'
};

/** ประเมินสถานะพิกัด */
function CHECKIN_evaluateGeo_(point, lat, lng, accuracy) {
  if (!CFG_bool('gps_required')) {
    return { status: 'NOT_REQUIRED', distance: null };
  }
  if (lat === null || lat === undefined || lat === '' || lng === null || lng === undefined || lng === '') {
    return { status: 'NO_GPS', distance: null };
  }
  var pLat = num(point.lat), pLng = num(point.lng);
  if (!pLat && !pLng) return { status: 'NOT_REQUIRED', distance: null };

  var dist = haversineMeters(pLat, pLng, num(lat), num(lng));
  var radius = num(point.radius_m, CFG_num('default_radius_m'));
  var maxAcc = num(CFG_get('gps_max_accuracy_m', 100), 100);
  var acc = num(accuracy, 0);

  if (acc > 0 && acc > maxAcc && dist > radius) {
    return { status: 'LOW_ACCURACY', distance: dist };
  }
  if (dist <= radius) return { status: 'IN_RANGE', distance: dist };
  if (dist <= radius * 2) return { status: 'NEAR', distance: dist };
  return { status: 'OUT_OF_RANGE', distance: dist };
}

/** ตรวจว่าอยู่ในกรอบเวลาที่เช็คอินได้หรือไม่ */
function CHECKIN_windowCheck_(slot, date) {
  var d = toDateStr(date);
  var t = today();
  if (d !== t) {
    if (d > t) return { ok: false, reason: 'ยังไม่ถึงวันปฏิบัติเวร (' + thaiDate(d) + ')' };
    return { ok: false, reason: 'วันปฏิบัติเวรผ่านไปแล้ว (' + thaiDate(d) + ') กรุณาแจ้งหัวหน้าเวร' };
  }
  var nowM = minutesOfDay(Utilities.formatDate(new Date(), TZ, 'HH:mm'));
  var startM = minutesOfDay(slot.start_time);
  var endM = minutesOfDay(slot.end_time);
  if (startM < 0 || endM < 0) return { ok: true };

  var before = num(CFG_get('checkin_open_before_min', 30), 30);
  var after = num(CFG_get('checkin_close_after_min', 60), 60);
  if (nowM < startM - before) {
    return { ok: false, reason: 'ยังไม่ถึงเวลาเช็คอิน (เปิดเวลา ' +
      CHECKIN_fmtMin_(startM - before) + ' น.)' };
  }
  if (nowM > endM + after) {
    return { ok: false, reason: 'หมดเวลาเช็คอินแล้ว (ปิดเวลา ' +
      CHECKIN_fmtMin_(endM + after) + ' น.)' };
  }
  return { ok: true };
}

function CHECKIN_fmtMin_(m) {
  var x = mod(num(m, 0), 1440);
  return pad2(Math.floor(x / 60)) + ':' + pad2(x % 60);
}

/** ข้อมูลที่หน้าเช็คอินต้องใช้ */
function CHECKIN_context(ctx, scheduleId) {
  AUTH_require(ctx);
  var sch = dbGetById('DAILY_SCHEDULE', scheduleId);
  if (!sch) throw new Error('ไม่พบรายการเวรนี้');
  if (sch.effective_teacher_id !== ctx.teacherId && !AUTH_canSeeOthers(ctx)) {
    throw new Error('รายการเวรนี้ไม่ใช่ของท่าน');
  }

  var point = dbGetById('DUTY_POINTS', sch.point_id) || {};
  var slot = dbGetById('TIME_SLOTS', sch.slot_id) || {};
  var logs = sortBy(dbFind('DUTY_LOGS', { schedule_id: sch.id }), ['ts']);
  var photos = dbFind('DUTY_PHOTOS', { schedule_id: sch.id });
  var win = CHECKIN_windowCheck_(slot, sch.date);

  return {
    scheduleId: sch.id,
    date: toDateStr(sch.date),
    dateThai: thaiDate(toDateStr(sch.date), { weekday: true }),
    pointName: str(point.name),
    pointLat: num(point.lat), pointLng: num(point.lng),
    pointRadius: num(point.radius_m, CFG_num('default_radius_m')),
    slotName: str(slot.name),
    startTime: str(slot.start_time), endTime: str(slot.end_time),
    isMine: sch.effective_teacher_id === ctx.teacherId,
    canCheckIn: win.ok,
    windowReason: win.reason || '',
    gpsRequired: CFG_bool('gps_required'),
    photoRequired: CFG_bool('evidence_require_photo'),
    minPhotos: num(CFG_get('evidence_min_photos', 1), 1),
    requireCheckout: CFG_bool('require_checkout'),
    checkedIn: logs.some(function (l) { return str(l.action) === 'CHECK_IN'; }),
    checkedOut: logs.some(function (l) { return str(l.action) === 'CHECK_OUT'; }),
    logs: logs.map(function (l) {
      return {
        id: l.id, action: str(l.action), time: hhmm(l.ts),
        distance: num(l.distance_m), geoStatus: str(l.geo_status),
        geoLabel: GEO_STATUS[str(l.geo_status)] || str(l.geo_status)
      };
    }),
    photos: photos.map(function (p) {
      return { id: p.id, url: str(p.thumb_url) || str(p.file_url), caption: str(p.caption) };
    })
  };
}

/**
 * บันทึกการเข้า/ออกเวร
 * payload: { scheduleId, action, lat, lng, accuracy, note, idempotencyKey, photos:[{data, mimeType, caption}] }
 */
function CHECKIN_submit(ctx, payload) {
  AUTH_require(ctx);
  var p = payload || {};
  var action = str(p.action) === 'CHECK_OUT' ? 'CHECK_OUT' : 'CHECK_IN';

  var sch = dbGetById('DAILY_SCHEDULE', str(p.scheduleId));
  if (!sch) throw new Error('ไม่พบรายการเวรนี้');
  if (str(sch.status) === 'CANCELLED') throw new Error('เวรรายการนี้ถูกยกเลิกแล้ว');
  if (sch.effective_teacher_id !== ctx.teacherId) {
    throw new Error('บันทึกได้เฉพาะเวรของตนเอง หากต้องการบันทึกแทน กรุณาให้หัวหน้าเวรปรับเวรก่อน');
  }

  var slot = dbGetById('TIME_SLOTS', sch.slot_id) || {};
  var win = CHECKIN_windowCheck_(slot, sch.date);
  if (!win.ok) throw new Error(win.reason);

  var key = str(p.idempotencyKey);
  if (key) {
    var dup = dbGetBy('DUTY_LOGS', { idempotency_key: key });
    if (dup) return { id: dup.id, duplicated: true, message: 'บันทึกไปแล้ว' };
  }

  var point = dbGetById('DUTY_POINTS', sch.point_id) || {};
  var geo = CHECKIN_evaluateGeo_(point, p.lat, p.lng, p.accuracy);

  var existing = dbFind('DUTY_LOGS', { schedule_id: sch.id });
  if (action === 'CHECK_IN' && existing.some(function (l) { return str(l.action) === 'CHECK_IN'; })) {
    throw new Error('ท่านเช็คอินเวรรายการนี้ไปแล้ว');
  }
  if (action === 'CHECK_OUT') {
    if (!existing.some(function (l) { return str(l.action) === 'CHECK_IN'; })) {
      throw new Error('ต้องเช็คอินก่อนจึงจะเช็คเอาต์ได้');
    }
    if (existing.some(function (l) { return str(l.action) === 'CHECK_OUT'; })) {
      throw new Error('ท่านเช็คเอาต์เวรรายการนี้ไปแล้ว');
    }
  }

  var photos = (p.photos || []).slice(0, 5);
  var minPhotos = num(CFG_get('evidence_min_photos', 1), 1);
  if (action === 'CHECK_IN' && CFG_bool('evidence_require_photo')) {
    var already = dbFind('DUTY_PHOTOS', { schedule_id: sch.id }).length;
    if (already + photos.length < minPhotos) {
      throw new Error('กรุณาแนบภาพหลักฐานอย่างน้อย ' + minPhotos + ' ภาพ');
    }
  }

  return withLock(function () {
    var log = dbInsert('DUTY_LOGS', {
      schedule_id: sch.id,
      date: toDateStr(sch.date),
      teacher_id: ctx.teacherId,
      action: action,
      ts: nowIso(),
      lat: (p.lat === undefined || p.lat === null) ? '' : num(p.lat),
      lng: (p.lng === undefined || p.lng === null) ? '' : num(p.lng),
      distance_m: geo.distance === null ? '' : geo.distance,
      geo_status: geo.status,
      accuracy_m: num(p.accuracy, 0),
      device: truncate(sanitizeText(p.device), 120),
      idempotency_key: key,
      note: truncate(sanitizeText(p.note), 400)
    });

    var saved = [];
    photos.forEach(function (ph) {
      try {
        saved.push(DRIVE_savePhoto_(ctx, sch, log.id, ph));
      } catch (e) {
        // ภาพเดียวล้มเหลวไม่ควรทำให้การเช็คอินล้ม
        AUDIT_log(ctx, 'PHOTO_FAIL', 'DUTY_PHOTOS', sch.id, null, { error: e.message });
      }
    });

    AUDIT_log(ctx, action, 'DUTY_LOGS', log.id, null, {
      scheduleId: sch.id, geo: geo.status, distance: geo.distance, photos: saved.length
    });

    CACHE_remove('today:' + toDateStr(sch.date));

    return {
      id: log.id,
      action: action,
      time: hhmm(log.ts),
      geoStatus: geo.status,
      geoLabel: GEO_STATUS[geo.status],
      distance: geo.distance,
      photos: saved.length,
      message: action === 'CHECK_IN' ? 'บันทึกการเข้าเวรเรียบร้อย' : 'บันทึกการออกเวรเรียบร้อย'
    };
  });
}

/** เพิ่มภาพหลักฐานภายหลัง */
function CHECKIN_addPhoto(ctx, scheduleId, photo) {
  AUTH_require(ctx);
  var sch = dbGetById('DAILY_SCHEDULE', scheduleId);
  if (!sch) throw new Error('ไม่พบรายการเวรนี้');
  if (sch.effective_teacher_id !== ctx.teacherId) {
    throw new Error('เพิ่มภาพได้เฉพาะเวรของตนเอง');
  }
  if (dbFind('DUTY_PHOTOS', { schedule_id: sch.id }).length >= 10) {
    throw new Error('แนบภาพได้สูงสุด 10 ภาพต่อเวร 1 รายการ');
  }
  var saved = DRIVE_savePhoto_(ctx, sch, '', photo);
  AUDIT_log(ctx, 'PHOTO_ADD', 'DUTY_PHOTOS', saved.id, null, { scheduleId: sch.id });
  CACHE_remove('today:' + toDateStr(sch.date));
  return saved;
}

/** รายการเวรวันนี้ของฉันที่ยังไม่ได้เช็คอิน */
function CHECKIN_pendingToday(ctx) {
  AUTH_require(ctx);
  var d = today();
  var rows = dbReadAll('DAILY_SCHEDULE').filter(function (r) {
    return toDateStr(r.date) === d && r.effective_teacher_id === ctx.teacherId &&
      str(r.status) !== 'CANCELLED';
  });
  if (!rows.length) return [];

  var logs = groupBy(dbReadAll('DUTY_LOGS').filter(function (l) {
    return toDateStr(l.date) === d;
  }), function (l) { return l.schedule_id; });

  var slots = indexBy(dbReadAll('TIME_SLOTS'), 'id');
  var points = indexBy(dbReadAll('DUTY_POINTS'), 'id');

  return rows.map(function (r) {
    var my = logs[r.id] || [];
    var slot = slots[r.slot_id] || {};
    return {
      scheduleId: r.id,
      pointName: str((points[r.point_id] || {}).name),
      slotName: str(slot.name),
      startTime: str(slot.start_time), endTime: str(slot.end_time),
      slotSort: num(slot.sort_order, 99),
      checkedIn: my.some(function (l) { return str(l.action) === 'CHECK_IN'; }),
      checkedOut: my.some(function (l) { return str(l.action) === 'CHECK_OUT'; })
    };
  }).sort(function (a, b) { return a.slotSort - b.slotSort; });
}

/* ================================================================= */
/* Drive                                                             */
/* ================================================================= */

/** โฟลเดอร์ย่อยรายเดือน เพื่อไม่ให้ไฟล์กองรวมกัน */
function DRIVE_monthFolder_(root, dateStr) {
  var name = str(dateStr).substring(0, 7);   // yyyy-MM
  var it = root.getFoldersByName(name);
  return it.hasNext() ? it.next() : root.createFolder(name);
}

function DRIVE_savePhoto_(ctx, sch, logId, photo) {
  var folderId = PROP_photoFolderId();
  if (!folderId) throw new Error('ยังไม่ได้ตั้งค่าโฟลเดอร์เก็บภาพ กรุณารัน ติดตั้งระบบ()');

  var data = str(photo && photo.data);
  if (!data) throw new Error('ไม่พบข้อมูลภาพ');
  var mime = str(photo.mimeType) || 'image/jpeg';
  if (mime.indexOf('image/') !== 0) throw new Error('รองรับเฉพาะไฟล์ภาพ');

  var b64 = data.indexOf('base64,') >= 0 ? data.split('base64,')[1] : data;
  if (b64.length > 4000000) throw new Error('ไฟล์ภาพใหญ่เกินไป กรุณาถ่ายใหม่');

  var bytes = Utilities.base64Decode(b64);
  var d = toDateStr(sch.date);
  var point = dbGetById('DUTY_POINTS', sch.point_id) || {};
  var fileName = d + '_' + str(point.code || point.name).replace(/[^\wก-๙]/g, '') +
    '_' + str(ctx.code || ctx.teacherId).substring(0, 8) + '_' +
    Utilities.formatDate(new Date(), TZ, 'HHmmss') + '.jpg';

  var blob = Utilities.newBlob(bytes, mime, fileName);
  var root = DriveApp.getFolderById(folderId);
  var folder = DRIVE_monthFolder_(root, d);
  var file = folder.createFile(blob);

  // ห้ามเปิดเป็นสาธารณะ — ให้เฉพาะคนในโดเมนที่มีลิงก์เท่านั้น
  try {
    var domain = CFG_schoolDomain();
    if (domain) file.setSharing(DriveApp.Access.DOMAIN_WITH_LINK, DriveApp.Permission.VIEW);
    else file.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.VIEW);
  } catch (e) {
    try { file.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.VIEW); } catch (e2) { /* ignore */ }
  }

  var id = file.getId();
  return dbInsert('DUTY_PHOTOS', {
    schedule_id: sch.id,
    log_id: str(logId),
    teacher_id: ctx.teacherId,
    date: d,
    file_id: id,
    file_url: 'https://drive.google.com/file/d/' + id + '/view',
    thumb_url: 'https://drive.google.com/thumbnail?id=' + id + '&sz=w400',
    caption: truncate(sanitizeText(photo.caption), 200),
    taken_at: nowIso()
  });
}

/** อ่านภาพเป็น base64 สำหรับแสดงในหน้าเว็บ (เลี่ยงปัญหาสิทธิ์ของ Drive) */
function PHOTO_data(ctx, photoId) {
  AUTH_require(ctx);
  var p = dbGetById('DUTY_PHOTOS', photoId);
  if (!p) throw new Error('ไม่พบภาพนี้');
  if (p.teacher_id !== ctx.teacherId && !AUTH_canSeeOthers(ctx)) {
    throw new Error('ไม่มีสิทธิ์ดูภาพนี้');
  }
  var blob = DriveApp.getFileById(p.file_id).getBlob();
  return {
    id: p.id,
    mimeType: blob.getContentType(),
    data: Utilities.base64Encode(blob.getBytes()),
    caption: str(p.caption)
  };
}
