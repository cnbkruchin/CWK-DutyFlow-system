/**
 * harness.js — โหลดไฟล์ .gs ทั้งหมดเข้า VM พร้อม stub ของบริการ Google Apps Script
 * ใช้ร่วมกันโดย run.js และ static-check.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

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

function makeSandbox(store) {
  const data = store || {};

  const sandbox = {
    console,
    Math, Date, JSON, String, Number, Boolean, Array, Object, RegExp, Error, isNaN, parseInt, parseFloat,
    setTimeout, clearTimeout,

    Utilities: {
      getUuid: () => 'uuid-' + (++uuidCounter).toString().padStart(6, '0'),
      formatDate: fmt,
      base64Decode: s => Buffer.from(s, 'base64'),
      base64Encode: b => Buffer.from(b).toString('base64'),
      newBlob: (bytes, mime, name) => ({ bytes, mime, name })
    },

    Logger: { log: () => {} },

    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: k => (data._props || {})[k] || null,
        setProperty: (k, v) => { data._props = data._props || {}; data._props[k] = String(v); }
      })
    },

    CacheService: {
      getScriptCache: () => ({
        get: () => null, getAll: () => ({}), put: () => {}, putAll: () => {},
        remove: () => {}, removeAll: () => {}
      })
    },

    LockService: {
      getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} })
    },

    Session: {
      getActiveUser: () => ({ getEmail: () => data._email || '' }),
      getEffectiveUser: () => ({ getEmail: () => data._email || '' })
    },

    SpreadsheetApp: { openById: () => { throw new Error('no spreadsheet in test'); } },
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
