/**
 * DatabaseService.gs — ชั้นข้อมูล (Google Sheets เป็นฐานข้อมูล)
 *
 * หลักการสำคัญ
 *  - Primary Key เป็น UUID เสมอ ห้ามใช้เลขแถว
 *  - อ่าน/เขียนแบบยกชุด (getValues/setValues) ห้าม appendRow ในลูป
 *  - แคช 3 ชั้น: DB_MEM (ต่อการเรียก 1 ครั้ง) -> CacheService -> อ่านชีต
 *  - ห้ามลบข้อมูลสำคัญถาวร ใช้การเปลี่ยนสถานะแทน
 *  - เพิ่มคอลัมน์ใหม่ต่อท้ายเสมอ ชีตเดิมจะอ่านได้ถูกต้องแม้ยังไม่ได้รัน ติดตั้งระบบ()
 *  - ทุกการเข้าถึงข้อมูลต้องผ่าน EXEC_assert_() (ดู AuthService.gs)
 */

var DB_SCHEMA = {

  CONFIG: {
    sheet: 'CONFIG', cache: true,
    columns: ['id', 'key', 'value', 'value_type', 'group_name', 'label', 'updated_at', 'updated_by']
  },

  TEACHERS: {
    sheet: 'TEACHERS', cache: true,
    columns: ['id', 'code', 'prefix', 'first_name', 'last_name', 'email', 'department',
      'position', 'phone', 'role', 'status', 'note', 'created_at', 'updated_at',
      'username', 'password_hash', 'must_change_password', 'password_changed_at']
  },

  DUTY_POINTS: {
    sheet: 'DUTY_POINTS', cache: true,
    columns: ['id', 'code', 'name', 'description', 'lat', 'lng', 'radius_m',
      'seat_count', 'rotation_group', 'sort_order', 'status', 'created_at', 'updated_at']
  },

  TIME_SLOTS: {
    sheet: 'TIME_SLOTS', cache: true,
    columns: ['id', 'code', 'name', 'start_time', 'end_time', 'sort_order', 'status',
      'created_at', 'updated_at']
  },

  SEMESTERS: {
    sheet: 'SEMESTERS', cache: true,
    columns: ['id', 'year_be', 'term', 'name', 'start_date', 'end_date', 'is_active',
      'prev_semester_id', 'status', 'created_at', 'updated_at']
  },

  CALENDAR_DAYS: {
    sheet: 'CALENDAR_DAYS', cache: true,
    columns: ['id', 'semester_id', 'date', 'day_type', 'note', 'created_at', 'updated_at']
  },

  ASSIGNMENTS: {
    sheet: 'ASSIGNMENTS', cache: true,
    columns: ['id', 'semester_id', 'weekday', 'slot_id', 'point_id', 'seat_no', 'teacher_id',
      'rotation_group', 'rotation_order', 'rotation_scope',
      'pin_mode', 'pin_reason', 'pin_by', 'pin_at',
      'status', 'created_at', 'updated_at']
  },

  DAILY_SCHEDULE: {
    sheet: 'DAILY_SCHEDULE', cache: false,
    columns: ['id', 'semester_id', 'date', 'weekday', 'slot_id', 'point_id', 'seat_no',
      'assignment_id', 'original_teacher_id', 'effective_teacher_id',
      'source', 'point_rotation_offset', 'status', 'version', 'note',
      'created_at', 'updated_at']
  },

  DUTY_LOGS: {
    sheet: 'DUTY_LOGS', cache: false,
    columns: ['id', 'schedule_id', 'date', 'teacher_id', 'action', 'ts',
      'lat', 'lng', 'distance_m', 'geo_status', 'accuracy_m',
      'device', 'idempotency_key', 'note', 'created_at']
  },

  DUTY_PHOTOS: {
    sheet: 'DUTY_PHOTOS', cache: false,
    columns: ['id', 'schedule_id', 'log_id', 'teacher_id', 'date', 'file_id', 'file_url',
      'thumb_url', 'caption', 'taken_at', 'created_at']
  },

  INCIDENTS: {
    sheet: 'INCIDENTS', cache: false,
    columns: ['id', 'schedule_id', 'date', 'point_id', 'reporter_id', 'category', 'severity',
      'title', 'detail', 'photo_file_id', 'photo_url', 'status',
      'handled_by', 'handled_at', 'handle_note', 'created_at', 'updated_at']
  },

  SWAP_REQUESTS: {
    sheet: 'SWAP_REQUESTS', cache: false,
    columns: ['id', 'request_type', 'date', 'schedule_id', 'counter_schedule_id',
      'from_teacher_id', 'to_teacher_id', 'reason',
      'approval_status', 'approver_id', 'approver_role', 'approval_level',
      'approved_at', 'reject_reason', 'created_by', 'created_at', 'updated_at']
  },

  ROTATION_HISTORY: {
    sheet: 'ROTATION_HISTORY', cache: false,
    columns: ['id', 'semester_id', 'from_semester_id', 'day_shift', 'point_shift',
      'affected_count', 'undo_json', 'status', 'applied_by', 'applied_at']
  },

  AUDIT_LOG: {
    sheet: 'AUDIT_LOG', cache: false,
    columns: ['id', 'ts', 'actor_id', 'actor_email', 'actor_role', 'action',
      'entity', 'entity_id', 'before_json', 'after_json', 'note', 'actor_username']
  }
};

var DB_TABLES = Object.keys(DB_SCHEMA);

/** แคชระดับการเรียก 1 ครั้ง (execution scoped) */
var DB_MEM = {};
var DB_STATS = { sheetReads: 0, memHits: 0, cacheHits: 0 };

/* ------------------------------------------------------------------ */
/* Spreadsheet                                                         */
/* ------------------------------------------------------------------ */

var DB_SS_ = null;

function DB_ss() {
  EXEC_assert_();
  if (DB_SS_) return DB_SS_;
  var id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) throw new Error('ยังไม่ได้ตั้งค่า SPREADSHEET_ID ใน Script Properties — กรุณารัน ติดตั้งระบบ() ก่อน');
  DB_SS_ = SpreadsheetApp.openById(id);
  return DB_SS_;
}

function DB_sheet(table) {
  var def = DB_SCHEMA[table];
  if (!def) throw new Error('ไม่รู้จักตาราง: ' + table);
  var sh = DB_ss().getSheetByName(def.sheet);
  if (!sh) throw new Error('ไม่พบชีต ' + def.sheet + ' — กรุณารัน ติดตั้งระบบ() เพื่อสร้างชีตให้ครบ');
  return sh;
}

/* ------------------------------------------------------------------ */
/* Cache                                                               */
/* ------------------------------------------------------------------ */

var DB_CACHE_TTL = 1800;          // 30 นาที
var DB_CHUNK = 90000;             // 90 KB ต่อชิ้น
var DB_MAX_CHUNKS = 20;

function DB_cacheKey_(table) { return 'db:v2:' + table; }

function CACHE_get(key) {
  EXEC_assert_();
  try {
    var c = CacheService.getScriptCache();
    var head = c.get(key);
    if (!head) return null;
    var meta = JSON.parse(head);
    if (!meta || !meta.n) return null;
    var keys = [];
    for (var i = 0; i < meta.n; i++) keys.push(key + ':' + i);
    var parts = c.getAll(keys);
    var buf = '';
    for (var j = 0; j < meta.n; j++) {
      var p = parts[key + ':' + j];
      if (p === null || p === undefined) return null;   // แคชขาด ให้ถือว่าไม่มี
      buf += p;
    }
    return JSON.parse(buf);
  } catch (e) {
    return null;
  }
}

function CACHE_put(key, value) {
  EXEC_assert_();
  try {
    var json = JSON.stringify(value);
    var n = Math.ceil(json.length / DB_CHUNK);
    if (n > DB_MAX_CHUNKS) return false;               // ใหญ่เกิน ไม่แคช
    var c = CacheService.getScriptCache();
    var map = {};
    for (var i = 0; i < n; i++) map[key + ':' + i] = json.substr(i * DB_CHUNK, DB_CHUNK);
    c.putAll(map, DB_CACHE_TTL);
    c.put(key, JSON.stringify({ n: n, at: nowIso() }), DB_CACHE_TTL);
    return true;
  } catch (e) {
    return false;
  }
}

function CACHE_remove(key) {
  EXEC_assert_();
  try {
    var c = CacheService.getScriptCache();
    var head = c.get(key);
    if (head) {
      var meta = JSON.parse(head);
      var keys = [key];
      for (var i = 0; i < (meta.n || 0); i++) keys.push(key + ':' + i);
      c.removeAll(keys);
    } else {
      c.remove(key);
    }
  } catch (e) { /* ไม่ต้องทำอะไร */ }
}

function DB_invalidate(table) {
  delete DB_MEM[table];
  CACHE_remove(DB_cacheKey_(table));
  CACHE_remove('today:' + today());
}

function DB_invalidateAll() {
  DB_MEM = {};
  DB_TABLES.forEach(function (t) { CACHE_remove(DB_cacheKey_(t)); });
  CACHE_remove('cfg:all');
  CACHE_remove('today:' + today());
  CFG_MEM = null;
}

/* ------------------------------------------------------------------ */
/* อ่าน                                                                */
/* ------------------------------------------------------------------ */

function DB_clone_(o) {
  if (!o) return o;
  var c = {};
  Object.keys(o).forEach(function (k) { c[k] = o[k]; });
  return c;
}

/** อ่านทั้งตารางเป็น array ของ object */
function dbReadAll(table, useCache) {
  var def = DB_SCHEMA[table];
  if (!def) throw new Error('ไม่รู้จักตาราง: ' + table);
  EXEC_assert_();

  if (DB_MEM[table]) { DB_STATS.memHits++; return DB_MEM[table]; }

  var wantCache = (useCache === undefined) ? !!def.cache : !!useCache;
  if (wantCache) {
    var hit = CACHE_get(DB_cacheKey_(table));
    if (hit) { DB_STATS.cacheHits++; DB_MEM[table] = hit; return hit; }
  }

  var sh = DB_sheet(table);
  DB_STATS.sheetReads++;
  var last = sh.getLastRow();
  var out = [];
  if (last > 1) {
    var values = sh.getRange(2, 1, last - 1, def.columns.length).getValues();
    for (var r = 0; r < values.length; r++) {
      var row = values[r];
      if (!str(row[0])) continue;                       // ไม่มี id = แถวว่าง
      var o = {};
      for (var c = 0; c < def.columns.length; c++) {
        var v = row[c];
        o[def.columns[c]] = (Object.prototype.toString.call(v) === '[object Date]')
          ? Utilities.formatDate(v, TZ, 'yyyy-MM-dd')
          : v;
      }
      out.push(o);
    }
  }

  DB_MEM[table] = out;
  if (wantCache) CACHE_put(DB_cacheKey_(table), out);
  return out;
}

/** หาแถวเดียวด้วย id */
function dbGetById(table, id) {
  if (!id) return null;
  var rows = dbReadAll(table);
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].id === id) return DB_clone_(rows[i]);
  }
  return null;
}

/** หาแถวแรกที่ตรงเงื่อนไข { field: value } */
function dbGetBy(table, where) {
  var rows = dbFind(table, where);
  return rows.length ? DB_clone_(rows[0]) : null;
}

/** หาทุกแถวที่ตรงเงื่อนไข { field: value } หรือ { field: [v1, v2] } */
function dbFind(table, where) {
  var rows = dbReadAll(table);
  var keys = Object.keys(where || {});
  if (!keys.length) return rows.map(DB_clone_);
  return rows.filter(function (row) {
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i], want = where[k];
      if (Array.isArray(want)) {
        if (want.indexOf(row[k]) < 0) return false;
      } else if (row[k] !== want) {
        return false;
      }
    }
    return true;
  }).map(DB_clone_);
}

/** นับแถวที่ตรงเงื่อนไข */
function dbCount(table, where) {
  return dbFind(table, where).length;
}

/* ------------------------------------------------------------------ */
/* เขียน                                                               */
/* ------------------------------------------------------------------ */

function DB_rowFrom_(table, obj) {
  var def = DB_SCHEMA[table];
  return def.columns.map(function (c) {
    var v = obj[c];
    return (v === undefined || v === null) ? '' : v;
  });
}

/** เพิ่ม 1 แถว คืน object ที่บันทึกแล้ว */
function dbInsert(table, obj) {
  return dbInsertMany(table, [obj])[0];
}

/** เพิ่มหลายแถวในครั้งเดียว */
function dbInsertMany(table, objs) {
  if (!objs || !objs.length) return [];
  var def = DB_SCHEMA[table];
  var sh = DB_sheet(table);
  var ts = nowIso();
  var prepared = objs.map(function (o) {
    var row = DB_clone_(o);
    if (!row.id) row.id = uuid();
    if (def.columns.indexOf('created_at') >= 0 && !row.created_at) row.created_at = ts;
    if (def.columns.indexOf('updated_at') >= 0) row.updated_at = ts;
    return row;
  });
  var values = prepared.map(function (o) { return DB_rowFrom_(table, o); });
  sh.getRange(sh.getLastRow() + 1, 1, values.length, def.columns.length).setValues(values);
  DB_invalidate(table);
  return prepared;
}

/** แก้ไข 1 แถวด้วย id — patch คือ object เฉพาะฟิลด์ที่ต้องการเปลี่ยน */
function dbUpdate(table, id, patch) {
  var res = dbUpdateMany(table, [{ id: id, patch: patch }]);
  return res.length ? res[0] : null;
}

/** แก้ไขหลายแถวในครั้งเดียว items = [{id, patch}] */
function dbUpdateMany(table, items) {
  if (!items || !items.length) return [];
  var def = DB_SCHEMA[table];
  var sh = DB_sheet(table);
  var last = sh.getLastRow();
  if (last < 2) return [];

  var values = sh.getRange(2, 1, last - 1, def.columns.length).getValues();
  var rowIndexById = {};
  for (var r = 0; r < values.length; r++) {
    var id = str(values[r][0]);
    if (id) rowIndexById[id] = r;
  }

  var ts = nowIso();
  var touched = [];
  var out = [];

  items.forEach(function (it) {
    var r = rowIndexById[it.id];
    if (r === undefined) return;
    var patch = it.patch || {};
    Object.keys(patch).forEach(function (k) {
      var c = def.columns.indexOf(k);
      if (c >= 0) values[r][c] = (patch[k] === undefined || patch[k] === null) ? '' : patch[k];
    });
    var uc = def.columns.indexOf('updated_at');
    if (uc >= 0) values[r][uc] = ts;
    touched.push(r);
    var o = {};
    for (var c2 = 0; c2 < def.columns.length; c2++) o[def.columns[c2]] = values[r][c2];
    out.push(o);
  });

  if (!touched.length) return [];

  // เขียนกลับเฉพาะช่วงที่ครอบคลุมแถวที่แก้ (ลดปริมาณการเขียน)
  var minR = Math.min.apply(null, touched);
  var maxR = Math.max.apply(null, touched);
  sh.getRange(2 + minR, 1, maxR - minR + 1, def.columns.length)
    .setValues(values.slice(minR, maxR + 1));

  DB_invalidate(table);
  return out;
}

/**
 * เปลี่ยนสถานะเป็น INACTIVE แทนการลบ (ห้ามลบข้อมูลสำคัญถาวร)
 */
function dbSoftDelete(table, id) {
  return dbUpdate(table, id, { status: 'INACTIVE' });
}

/**
 * ลบถาวร — ใช้ได้เฉพาะข้อมูลร่างที่ยังไม่เคยส่ง เช่น ตารางรายวันที่ยังไม่มีการเช็คอิน
 */
function dbHardDelete(table, ids) {
  if (!ids || !ids.length) return 0;
  var def = DB_SCHEMA[table];
  var sh = DB_sheet(table);
  var last = sh.getLastRow();
  if (last < 2) return 0;

  var values = sh.getRange(2, 1, last - 1, def.columns.length).getValues();
  var kill = {};
  ids.forEach(function (i) { kill[i] = true; });
  var kept = values.filter(function (row) { return !kill[str(row[0])]; });
  var removed = values.length - kept.length;
  if (!removed) return 0;

  sh.getRange(2, 1, values.length, def.columns.length).clearContent();
  if (kept.length) sh.getRange(2, 1, kept.length, def.columns.length).setValues(kept);
  DB_invalidate(table);
  return removed;
}

/* ------------------------------------------------------------------ */
/* Lock                                                                */
/* ------------------------------------------------------------------ */

/** ครอบการเขียนที่สำคัญด้วย LockService */
function withLock(fn, timeoutMs) {
  var lock = LockService.getScriptLock();
  var ok = lock.tryLock(timeoutMs || 20000);
  if (!ok) throw new Error('ระบบกำลังประมวลผลคำขออื่นอยู่ กรุณาลองใหม่อีกครั้ง');
  try {
    return fn();
  } finally {
    try { lock.releaseLock(); } catch (e) { /* ignore */ }
  }
}
