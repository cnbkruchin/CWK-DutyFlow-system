/**
 * harness.js — โหลดไฟล์ .gs ทั้งหมดเข้า VM พร้อม stub ของบริการ Google Apps Script
 * ใช้ร่วมกันโดย run.js และ static-check.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const SRC = path.join(__dirname, '..', 'src');

const ORDER = [
  'Utils.gs', 'Config.gs', 'DatabaseService.gs', 'AuthService.gs', 'AuditService.gs',
  'TeacherService.gs', 'MasterService.gs', 'PointRotationService.gs', 'AssignmentService.gs',
  'RotationService.gs', 'ScheduleService.gs', 'CheckinService.gs', 'SwapService.gs',
  'IncidentService.gs', 'ReportService.gs', 'DashboardService.gs', 'NotifyService.gs',
  'PdfService.gs', 'Setup.gs', 'Diagnostics.gs', 'Code.gs'
];

function gsFiles() {
  const all = fs.readdirSync(SRC).filter(f => f.endsWith('.gs'));
  const missing = all.filter(f => ORDER.indexOf(f) < 0);
  if (missing.length) throw new Error('ไฟล์ .gs ที่ยังไม่อยู่ใน ORDER: ' + missing.join(', '));
  const gone = ORDER.filter(f => all.indexOf(f) < 0);
  if (gone.length) throw new Error('ไฟล์ใน ORDER ที่ไม่มีอยู่จริง: ' + gone.join(', '));
  return ORDER;
}

/* ---------- stub ของบริการ Apps Script ---------- */

function fmt(date, tz, pattern) {
  const p2 = n => String(n).padStart(2, '0');
  const map = {
    yyyy: date.getFullYear(),
    MM: p2(date.getMonth() + 1),
    dd: p2(date.getDate()),
    HH: p2(date.getHours()),
    mm: p2(date.getMinutes()),
    ss: p2(date.getSeconds()),
    yy: String(date.getFullYear()).slice(-2)
  };
  return String(pattern)
    .replace(/'T'/g, '\u0001')
    .replace(/yyyy|MM|dd|HH|mm|ss|yy/g, m => map[m])
    .replace(/\u0001/g, 'T');
}

let uuidCounter = 0;

/* ---------- ไบต์แบบ Java (มีเครื่องหมาย -128..127) ---------- */

function toBuffer(v) {
  if (typeof v === 'string') return Buffer.from(v, 'utf8');
  return Buffer.from(Array.from(v, b => b & 0xff));
}
function toJavaBytes(buf) {
  return Array.from(buf, b => (b > 127 ? b - 256 : b));
}

/* ---------- CacheService ในหน่วยความจำ ---------- */

function makeCache(data) {
  data._cache = data._cache || {};
  const c = data._cache;
  return {
    get: k => (Object.prototype.hasOwnProperty.call(c, k) ? c[k] : null),
    getAll: keys => {
      const out = {};
      keys.forEach(k => { if (Object.prototype.hasOwnProperty.call(c, k)) out[k] = c[k]; });
      return out;
    },
    put: (k, v) => { c[k] = String(v); },
    putAll: map => { Object.keys(map).forEach(k => { c[k] = String(map[k]); }); },
    remove: k => { delete c[k]; },
    removeAll: keys => { keys.forEach(k => { delete c[k]; }); }
  };
}

/* ---------- สเปรดชีตจำลองในหน่วยความจำ (เปิดใช้เมื่อ store._sheets มีค่า) ---------- */

function makeRange(sheet, r, c, nr, nc) {
  const rows = sheet._rows;
  const range = {
    getValues: () => {
      const out = [];
      for (let i = 0; i < nr; i++) {
        const row = rows[r - 1 + i] || [];
        const vals = [];
        for (let j = 0; j < nc; j++) {
          const v = row[c - 1 + j];
          vals.push(v === undefined ? '' : v);
        }
        out.push(vals);
      }
      return out;
    },
    setValues: vals => {
      vals.forEach((v, i) => {
        const idx = r - 1 + i;
        while (rows.length <= idx) rows.push([]);
        v.forEach((x, j) => { rows[idx][c - 1 + j] = x; });
      });
      return range;
    },
    setValue: v => range.setValues([[v]]),
    clearContent: () => {
      for (let i = 0; i < nr; i++) {
        const row = rows[r - 1 + i];
        if (row) for (let j = 0; j < nc; j++) row[c - 1 + j] = '';
      }
      return range;
    }
  };
  ['setFontWeight', 'setBackground', 'setFontColor', 'setFontSize', 'setNumberFormat']
    .forEach(m => { range[m] = () => range; });
  return range;
}

function makeSheet(name) {
  const sheet = { _rows: [] };
  const hasContent = row => row && row.some(v => v !== '' && v !== undefined && v !== null);
  Object.assign(sheet, {
    getName: () => name,
    getSheetId: () => 1,
    getLastRow: () => {
      for (let i = sheet._rows.length - 1; i >= 0; i--) if (hasContent(sheet._rows[i])) return i + 1;
      return 0;
    },
    getLastColumn: () => sheet._rows.reduce((m, row) => Math.max(m, row ? row.length : 0), 0),
    getRange: (r, c, nr, nc) => makeRange(sheet, r, c, nr || 1, nc || 1),
    clear: () => { sheet._rows.length = 0; },
    setFrozenRows: () => {},
    autoResizeColumns: () => {}
  });
  return sheet;
}

function makeSpreadsheet(sheets) {
  const ss = {
    getId: () => 'ss-test',
    getName: () => 'CWK DutyFlow Test',
    getUrl: () => 'https://example.test/ss',
    getSheetByName: n => sheets[n] || null,
    insertSheet: n => { sheets[n] = makeSheet(n); return sheets[n]; }
  };
  return ss;
}

function makeSandbox(store) {
  const data = store || {};

  // _quiet: ไม่พิมพ์ console.error จาก api() ที่ตั้งใจให้ล้มเหลวในการทดสอบ
  const quietConsole = Object.assign({}, console, { error: () => {} });

  const sandbox = {
    console: data._quiet ? quietConsole : console,
    Math, Date, JSON, String, Number, Boolean, Array, Object, RegExp, Error, isNaN, parseInt, parseFloat,
    setTimeout, clearTimeout,

    Utilities: {
      getUuid: () => 'uuid-' + (++uuidCounter).toString().padStart(6, '0') + '-' +
        crypto.randomBytes(8).toString('hex'),
      formatDate: fmt,
      base64Decode: s => Buffer.from(s, 'base64'),
      base64Encode: b => Buffer.from(b).toString('base64'),
      newBlob: (bytes, mime, name) => ({ bytes, mime, name, getBytes: () => toJavaBytes(toBuffer(bytes)) }),
      DigestAlgorithm: { SHA_256: 'sha256' },
      computeDigest: (alg, value) => toJavaBytes(crypto.createHash(alg).update(toBuffer(value)).digest()),
      computeHmacSha256Signature: (value, key) =>
        toJavaBytes(crypto.createHmac('sha256', toBuffer(key)).update(toBuffer(value)).digest())
    },

    Logger: { log: m => { (data._logs = data._logs || []).push(String(m)); } },

    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: k => (data._props || {})[k] || null,
        setProperty: (k, v) => { data._props = data._props || {}; data._props[k] = String(v); }
      })
    },

    CacheService: {
      getScriptCache: () => makeCache(data)
    },

    LockService: {
      getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} })
    },

    // _email = ผู้ที่รันอยู่ · _effectiveEmail = เจ้าของสคริปต์ (ผู้ Deploy)
    Session: {
      getActiveUser: () => ({ getEmail: () => data._email || '' }),
      getEffectiveUser: () => ({
        getEmail: () => (data._effectiveEmail !== undefined ? data._effectiveEmail : data._email) || ''
      })
    },

    SpreadsheetApp: {
      openById: () => {
        if (!data._sheets) throw new Error('no spreadsheet in test');
        return makeSpreadsheet(data._sheets);
      },
      getActiveSpreadsheet: () => (data._sheets ? makeSpreadsheet(data._sheets) : null),
      getUi: () => { throw new Error('no ui in test'); }
    },
    DriveApp: { Access: {}, Permission: {} },
    DocumentApp: { Attribute: {}, ParagraphHeading: {} },
    MailApp: { sendEmail: () => {} },
    HtmlService: {
      createTemplateFromFile: () => ({ evaluate: () => ({}) }),
      createHtmlOutputFromFile: () => ({ getContent: () => '' }),
      XFrameOptionsMode: { ALLOWALL: 1 }
    },
    CalendarApp: {}
  };
  sandbox.globalThis = sandbox;
  return sandbox;
}

function loadAll(store) {
  const sandbox = makeSandbox(store);
  const ctx = vm.createContext(sandbox);
  gsFiles().forEach(f => {
    const code = fs.readFileSync(path.join(SRC, f), 'utf8');
    try {
      vm.runInContext(code, ctx, { filename: f });
    } catch (e) {
      throw new Error('โหลด ' + f + ' ไม่สำเร็จ: ' + e.message);
    }
  });
  return sandbox;
}

module.exports = { SRC, ORDER, gsFiles, loadAll, makeSandbox };
