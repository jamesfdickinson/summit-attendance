"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

let numberFormatWrites = 0;
let insertedRowCount = 0;
let deletedRowCount = 0;

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

  getRow() {
    return this.row;
  }

  createTextFinder(searchText) {
    const range = this;
    let entireCell = false;
    return {
      matchEntireCell(value) {
        entireCell = value;
        return this;
      },
      findAll() {
        const matches = [];
        range.values().forEach((row, rowOffset) => {
          row.forEach((value, columnOffset) => {
            const text = String(value == null ? "" : value);
            const matched = entireCell ? text === searchText : text.includes(searchText);
            if (matched) {
              matches.push(new Range(
                range.sheet,
                range.row + rowOffset,
                range.column + columnOffset,
                1,
                1
              ));
            }
          });
        });
        return matches;
      }
    };
  }

  setNumberFormat() {
    return this;
  }

  setNumberFormats() {
    numberFormatWrites += 1;
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

  deleteRows(row, count) {
    deletedRowCount += count;
    this.rows.splice(row - 1, count);
  }

  insertRowsAfter(row, count) {
    insertedRowCount += count;
    this.rows.splice(row, 0, ...Array.from({ length: count }, () => []));
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
  "Member Present",
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
let activeSpreadsheetRequests = 0;
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
  PropertiesService: {
    getScriptProperties() {
      return {
        getProperty(key) {
          return {
            SUMMIT_ACCESS_PASSWORD: "basic-secret"
          }[key] || null;
        }
      };
    }
  },
  SpreadsheetApp: {
    openById() {
      throw new Error("The endpoint must use its bound spreadsheet.");
    },
    getActiveSpreadsheet() {
      activeSpreadsheetRequests += 1;
      return spreadsheet;
    }
  },
  Utilities: {
    formatDate: (date) => date.toISOString().slice(0, 10),
    getUuid: (() => {
      let value = 0;
      return () => `visitor-${value += 1}`;
    })()
  }
});

const codePath = path.join(__dirname, "..", "sites", "SummitCheckIn.AppsScript", "apps-script", "Code.gs");
const code = fs.readFileSync(codePath, "utf8");
assert.doesNotMatch(code, /SUMMIT_ADMIN_PASSWORD/);
const appsScriptRoot = path.join(path.dirname(path.dirname(codePath)), "public");
const appsScriptHtml = fs.readFileSync(path.join(appsScriptRoot, "index.html"), "utf8");
const appsScriptApp = fs.readFileSync(path.join(appsScriptRoot, "app.js"), "utf8");
const appsScriptAdmin = fs.readFileSync(path.join(appsScriptRoot, "admin.js"), "utf8");
assert.match(appsScriptHtml, /src="config\.js"/);
assert.match(appsScriptApp, /fetch\(url, fetchOptions\)/);
assert.match(appsScriptApp, /action, password: state\.password/);
assert.match(appsScriptAdmin, /fetch\(endpoint/);
assert.match(appsScriptAdmin, /CLIENT_ADMIN_PASSWORD/);
assert.match(appsScriptAdmin, /JSON\.stringify\(\{ action: "reports" \}\)/);
assert.doesNotMatch(appsScriptAdmin, /action: "reports", password/);
vm.runInContext(code, context, { filename: codePath });

function get(action, parameters) {
  const output = context.doGet({
    parameter: Object.assign({ action, password: "basic-secret" }, parameters || {})
  });
  return JSON.parse(output.getContent());
}

function post(payload, password) {
  const submittedPassword = password === undefined ? "basic-secret" : password;
  const output = context.doPost({
    postData: { contents: JSON.stringify(Object.assign({ password: submittedPassword }, payload)) }
  });
  return JSON.parse(output.getContent());
}

const missingPassword = get("families", { password: "" });
assert.equal(missingPassword.ok, false);
assert.equal(missingPassword.code, "AUTH_REQUIRED");

const wrongPassword = get("families", { password: "wrong" });
assert.equal(wrongPassword.ok, false);
assert.equal(wrongPassword.code, "AUTH_REQUIRED");

const publicReports = get("reports", { password: "" });
assert.equal(publicReports.ok, true);
assert.equal(publicReports.accessLevel, undefined);

const adminFamilies = get("families", { password: "admin-secret" });
assert.equal(adminFamilies.ok, false);
assert.equal(adminFamilies.code, "AUTH_REQUIRED");

const postedFamilies = post({ action: "families" });
assert.equal(postedFamilies.ok, true);
assert.equal(postedFamilies.accessLevel, "basic");

const postedReports = post({ action: "reports" }, "");
assert.equal(postedReports.ok, true);
assert.equal(postedReports.accessLevel, undefined);

const families = get("families");
assert.equal(families.ok, true);
assert.equal(families.accessLevel, "basic");
assert.deepEqual(JSON.parse(JSON.stringify(families.families)), [{
  name: "Dickinson, L",
  members: ["Lisa", "Abby", "Noah"]
}]);

const created = post({
  action: "save",
  submissionId: "family-submit-1",
  family: "Dickinson, L",
  members: ["Lisa", "Abby"],
  notes: "First arrival"
});
assert.equal(created.ok, true, created.error);
assert.equal(created.updated, false);
assert.match(created.record.checkInId, /^\d{4}-\d{2}-\d{2}\|Dickinson, L$/);
assert.equal(checkInsSheet.getLastRow(), 3);
assert.equal(checkInsSheet.rows[1][3], "Lisa");
assert.equal(checkInsSheet.rows[2][3], "Abby");
assert.equal(checkInsSheet.rows[1][0], created.record.checkInId);
assert.equal(checkInsSheet.rows[2][0], created.record.checkInId);

const createdStatus = post({
  action: "status",
  submissionId: "family-submit-1",
  family: "Dickinson, L",
  members: ["Abby", "Lisa"],
  notes: "First arrival"
});
assert.equal(createdStatus.ok, true, createdStatus.error);
assert.equal(createdStatus.saved, true);
assert.equal(createdStatus.record.checkInId, created.record.checkInId);

const mismatchedStatus = post({
  action: "status",
  submissionId: "family-submit-1",
  family: "Dickinson, L",
  members: ["Noah"],
  notes: "First arrival"
});
assert.equal(mismatchedStatus.ok, true);
assert.equal(mismatchedStatus.saved, false);
assert.equal(mismatchedStatus.record, null);

const updated = post({
  action: "save",
  family: "Dickinson, L",
  members: ["Noah"],
  notes: "Changed attendance"
});
assert.equal(updated.ok, true);
assert.equal(updated.updated, true);
assert.equal(updated.record.checkInId, created.record.checkInId);
assert.equal(checkInsSheet.getLastRow(), 2, "same-day update must replace the old member rows");
assert.equal(checkInsSheet.rows[1][3], "Noah");
assert.equal(checkInsSheet.rows[1][4], "Changed attendance");

const expanded = post({
  action: "save",
  family: "Dickinson, L",
  members: ["Lisa", "Abby", "Noah"],
  notes: "Everyone arrived"
});
assert.equal(expanded.ok, true);
assert.equal(expanded.updated, true);
assert.equal(expanded.record.checkInId, created.record.checkInId);
assert.equal(checkInsSheet.getLastRow(), 4);
assert.deepEqual(checkInsSheet.rows.slice(1).map((row) => row[3]), ["Lisa", "Abby", "Noah"]);
assert.ok(checkInsSheet.rows.slice(1).every((row) => row[0] === created.record.checkInId));
assert.ok(checkInsSheet.rows.slice(1).every((row) => row[4] === "Everyone arrived"));

checkInsSheet.rows[1][5] = "keep this column";
const insertsBeforeSameSizeUpdate = insertedRowCount;
const deletesBeforeSameSizeUpdate = deletedRowCount;
const sameSizeUpdate = post({
  action: "save",
  submissionId: "family-submit-2",
  family: "Dickinson, L",
  members: ["Lisa", "Abby", "Noah"],
  notes: "Same row count"
});
assert.equal(sameSizeUpdate.ok, true, sameSizeUpdate.error);
assert.equal(insertedRowCount, insertsBeforeSameSizeUpdate, "same-size updates must not insert rows");
assert.equal(deletedRowCount, deletesBeforeSameSizeUpdate, "same-size updates must not delete rows");
assert.equal(checkInsSheet.rows[1][5], "keep this column", "unrelated columns must not be overwritten");
assert.equal(numberFormatWrites, 0, "saves must not reformat the sheet");

const populatedReports = get("reports");
assert.equal(populatedReports.ok, true, populatedReports.error);
assert.equal(populatedReports.accessLevel, undefined);
assert.equal(populatedReports.reports.daily.checkedInFamilies, 1);
assert.equal(populatedReports.reports.daily.totalFamilies, 1);
assert.equal(populatedReports.reports.daily.familyPercent, 100);
assert.equal(populatedReports.reports.daily.checkedInMembers, 3);
assert.equal(populatedReports.reports.daily.totalMembers, 3);
assert.deepEqual(
  JSON.parse(JSON.stringify(populatedReports.reports.daily.families)),
  [{ name: "Dickinson, L", checkedIn: true, checkedInMembers: 3, totalMembers: 3 }]
);
const reportDate = new Date(`${populatedReports.reports.date}T12:00:00Z`);
const expectedAttendedThursdays = reportDate.getUTCDay() === 4 ? 1 : 0;
assert.equal(populatedReports.reports.yearly.startDate, populatedReports.reports.date);
assert.equal(populatedReports.reports.yearly.endDate, populatedReports.reports.date);
assert.equal(populatedReports.reports.yearly.thursdaysWithData, expectedAttendedThursdays);
assert.equal(populatedReports.reports.yearly.families[0].attendedThursdays, expectedAttendedThursdays);
assert.equal(
  populatedReports.reports.yearly.families[0].percent,
  populatedReports.reports.yearly.thursdaysWithData
    ? Math.round(expectedAttendedThursdays / populatedReports.reports.yearly.thursdaysWithData * 100)
    : 0
);

const cleared = post({
  action: "save",
  family: "Dickinson, L",
  members: [],
  notes: "Attendance cleared"
});
assert.equal(cleared.ok, true);
assert.equal(cleared.updated, true);
assert.equal(cleared.record.checkInId, created.record.checkInId);
assert.deepEqual(JSON.parse(JSON.stringify(cleared.record.members)), []);
assert.equal(checkInsSheet.rows[1][3], "");
assert.equal(checkInsSheet.getLastRow(), 2);

const clearedReports = get("reports");
assert.equal(clearedReports.reports.daily.checkedInFamilies, 0);
assert.equal(clearedReports.reports.daily.checkedInMembers, 0);
assert.equal(clearedReports.reports.yearly.families[0].attendedThursdays, 0);

const rejected = post({
  action: "save",
  family: "Dickinson, L",
  members: ["Not a family member"],
  notes: ""
});
assert.equal(rejected.ok, false);
assert.equal(checkInsSheet.getLastRow(), 2);
assert.ok(activeSpreadsheetRequests > 0);

const visitors = post({
  action: "save",
  submissionId: "visitor-submit-1",
  family: "Visitor",
  members: ["Jamie Guest", "Taylor Guest"],
  notes: "First visit"
});
assert.equal(visitors.ok, true, visitors.error);
assert.equal(visitors.updated, false);
assert.match(visitors.record.checkInId, /^\d{4}-\d{2}-\d{2}\|Visitor\|visitor-submit-1$/);
assert.deepEqual(JSON.parse(JSON.stringify(visitors.record.members)), ["Jamie Guest", "Taylor Guest"]);
assert.deepEqual(checkInsSheet.rows.slice(2).map((row) => row[3]), ["Jamie Guest", "Taylor Guest"]);

const visitorRowCount = checkInsSheet.getLastRow();
const retriedVisitor = post({
  action: "save",
  submissionId: "visitor-submit-1",
  family: "Visitor",
  members: ["Jamie Guest", "Taylor Guest"],
  notes: "First visit"
});
assert.equal(retriedVisitor.ok, true, retriedVisitor.error);
assert.equal(retriedVisitor.updated, true);
assert.equal(retriedVisitor.record.checkInId, visitors.record.checkInId);
assert.equal(checkInsSheet.getLastRow(), visitorRowCount, "visitor retries must not create duplicates");

const visitorStatus = post({
  action: "status",
  submissionId: "visitor-submit-1",
  family: "Visitor",
  members: ["Taylor Guest", "Jamie Guest"],
  notes: "First visit"
});
assert.equal(visitorStatus.ok, true, visitorStatus.error);
assert.equal(visitorStatus.saved, true);
assert.equal(visitorStatus.record.checkInId, visitors.record.checkInId);

const anotherVisitor = post({
  action: "save",
  submissionId: "visitor-submit-2",
  family: "Visitor",
  members: ["Morgan Guest"],
  notes: ""
});
assert.equal(anotherVisitor.ok, true, anotherVisitor.error);
assert.notEqual(anotherVisitor.record.checkInId, visitors.record.checkInId);
assert.equal(checkInsSheet.rows.at(-1)[3], "Morgan Guest");

const emptyVisitor = post({
  action: "save",
  family: "Visitor",
  members: [],
  notes: ""
});
assert.equal(emptyVisitor.ok, false);

const invalidSubmissionId = post({
  action: "save",
  submissionId: "not valid!",
  family: "Dickinson, L",
  members: ["Lisa"],
  notes: ""
});
assert.equal(invalidSubmissionId.ok, false);

const currentReportYear = populatedReports.reports.year;
const firstThursday = new Date(Date.UTC(currentReportYear, 0, 1));
while (firstThursday.getUTCDay() !== 4) {
  firstThursday.setUTCDate(firstThursday.getUTCDate() + 1);
}
const thirdThursday = new Date(firstThursday);
thirdThursday.setUTCDate(thirdThursday.getUTCDate() + 14);
const firstThursdayText = firstThursday.toISOString().slice(0, 10);
const thirdThursdayText = thirdThursday.toISOString().slice(0, 10);
checkInsSheet.rows.splice(1);
checkInsSheet.rows.push(
  [`${firstThursdayText}|Dickinson, L`, firstThursday, "Dickinson, L", "Lisa", ""],
  [`${thirdThursdayText}|Dickinson, L`, thirdThursday, "Dickinson, L", "", ""]
);
const distinctWeekReports = get("reports");
assert.equal(distinctWeekReports.reports.yearly.thursdaysWithData, 2);
assert.equal(distinctWeekReports.reports.yearly.families[0].attendedThursdays, 1);
assert.equal(distinctWeekReports.reports.yearly.families[0].totalThursdays, 2);
assert.equal(distinctWeekReports.reports.yearly.families[0].percent, 50);

console.log("Apps Script integration tests passed.");
