"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

class Range {
  constructor(sheet, row, column, rowCount, columnCount) {
    this.sheet = sheet;
    this.row = row;
    this.column = column;
    this.rowCount = rowCount || 1;
    this.columnCount = columnCount || 1;
  }

  values() {
    const result = [];
    for (let rowOffset = 0; rowOffset < this.rowCount; rowOffset += 1) {
      const values = [];
      for (let columnOffset = 0; columnOffset < this.columnCount; columnOffset += 1) {
        values.push(this.sheet.valueAt(this.row + rowOffset, this.column + columnOffset));
      }
      result.push(values);
    }
    return result;
  }

  getValues() {
    return this.values();
  }

  getDisplayValues() {
    return this.values().map((row) => row.map((value) => value == null ? "" : String(value)));
  }

  setNumberFormat() {
    return this;
  }

  setNumberFormats() {
    return this;
  }

  setValue(value) {
    this.sheet.setValueAt(this.row, this.column, value);
    return this;
  }

  setValues(values) {
    values.forEach((row, rowOffset) => {
      row.forEach((value, columnOffset) => {
        this.sheet.setValueAt(this.row + rowOffset, this.column + columnOffset, value);
      });
    });
    return this;
  }
}

class Sheet {
  constructor(name, rows) {
    this.name = name;
    this.rows = rows.map((row) => row.slice());
  }

  getName() {
    return this.name;
  }

  getSheetId() {
    return this.name === "Lists" ? 1 : 2;
  }

  getLastColumn() {
    return this.rows.reduce((max, row) => Math.max(max, row.length), 0);
  }

  getLastRow() {
    return this.rows.length;
  }

  getRange(row, column, rowCount, columnCount) {
    return new Range(this, row, column, rowCount, columnCount);
  }

  valueAt(row, column) {
    return this.rows[row - 1]?.[column - 1] ?? "";
  }

  setValueAt(row, column, value) {
    while (this.rows.length < row) this.rows.push([]);
    while (this.rows[row - 1].length < column) this.rows[row - 1].push("");
    this.rows[row - 1][column - 1] = value;
  }
}

class TextOutput {
  constructor(text) {
    this.text = text;
  }

  setMimeType() {
    return this;
  }

  getContent() {
    return this.text;
  }
}

const listSheet = new Sheet("Lists", [
  ["Family Name", "Member Name"],
  ["Dickinson, L", "Lisa"],
  ["Dickinson, L", "Abby"],
  ["Dickinson, L", "Noah"]
]);
const checkInsSheet = new Sheet("CheckIns", [[
  "CheckInID",
  "Timestamp",
  "Family Name",
  "Members Present",
  "Notes"
]]);

const spreadsheet = {
  getSheetByName(name) {
    return name === "Lists" ? listSheet : name === "CheckIns" ? checkInsSheet : null;
  },
  getSpreadsheetTimeZone() {
    return "America/Los_Angeles";
  }
};

const cacheValues = new Map();
const context = vm.createContext({
  console: { log: console.log, error() {} },
  CacheService: {
    getScriptCache() {
      return {
        get: (key) => cacheValues.get(key) || null,
        put: (key, value) => cacheValues.set(key, value),
        remove: (key) => cacheValues.delete(key)
      };
    }
  },
  ContentService: {
    MimeType: { JSON: "application/json" },
    createTextOutput: (text) => new TextOutput(text)
  },
  LockService: {
    getScriptLock: () => ({ waitLock() {}, releaseLock() {} })
  },
  SpreadsheetApp: {
    getActiveSpreadsheet: () => spreadsheet,
  },
  Utilities: {
    getUuid: () => "11111111-2222-4333-8444-555555555555",
    formatDate: (date) => date.toISOString().slice(0, 10)
  }
});

const codePath = path.join(__dirname, "..", "google-apps-script", "Code.gs");
vm.runInContext(fs.readFileSync(codePath, "utf8"), context, { filename: codePath });

function get(action, parameters) {
  const output = context.doGet({ parameter: Object.assign({ action }, parameters || {}) });
  return JSON.parse(output.getContent());
}

function post(payload) {
  const output = context.doPost({ postData: { contents: JSON.stringify(payload) } });
  return JSON.parse(output.getContent());
}

const families = get("families");
assert.equal(families.ok, true);
assert.deepEqual(JSON.parse(JSON.stringify(families.families)), [{
  name: "Dickinson, L",
  members: ["Lisa", "Abby", "Noah"]
}]);

const created = post({
  action: "save",
  family: "Dickinson, L",
  members: ["Lisa", "Abby"],
  notes: "First arrival"
});
assert.equal(created.ok, true);
assert.equal(created.updated, false);
assert.equal(created.record.checkInId, "11111111-2222-4333-8444-555555555555");
assert.equal(checkInsSheet.getLastRow(), 2);

const updated = post({
  action: "save",
  family: "Dickinson, L",
  members: ["Noah"],
  notes: "Changed attendance"
});
assert.equal(updated.ok, true);
assert.equal(updated.updated, true);
assert.equal(updated.record.checkInId, created.record.checkInId);
assert.equal(checkInsSheet.getLastRow(), 2, "same-day update must not append a row");
assert.equal(checkInsSheet.rows[1][3], "Noah");
assert.equal(checkInsSheet.rows[1][4], "Changed attendance");

const rejected = post({
  action: "save",
  family: "Dickinson, L",
  members: ["Not a family member"],
  notes: ""
});
assert.equal(rejected.ok, false);
assert.equal(checkInsSheet.getLastRow(), 2);

console.log("Apps Script integration tests passed.");
