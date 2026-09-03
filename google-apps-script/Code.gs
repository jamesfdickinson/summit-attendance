/**
 * Summit Leadership Check-In API
 *
 * This file is intended to be copied into the Apps Script project bound to the
 * Summit Google Sheet. All reads and writes use that bound spreadsheet.
 */

const CHECK_INS_SHEET = 'CheckIns';
const FAMILY_LIST_SHEET = 'Lists';
const MAX_NOTES_LENGTH = 500;
const VISITOR_FAMILY = 'Visitor';
const MAX_VISITORS_PER_CHECK_IN = 25;
const CACHE_SECONDS = 300;
const FAMILY_MAP_CACHE_KEY = 'summit-family-map-v1';
const ACCESS_PASSWORD_PROPERTY = 'SUMMIT_ACCESS_PASSWORD';
const ADMIN_PASSWORD_PROPERTY = 'SUMMIT_ADMIN_PASSWORD';

const CHECK_IN_HEADERS = [
  'CheckInID',
  'Timestamp',
  'Family Name',
  'Member Present',
  'Notes'
];

const LIST_HEADERS = ['Family Name', 'Member Name'];

function doGet(e) {
  try {
    const action = String((e && e.parameter && e.parameter.action) || '').trim();
    const password = e && e.parameter ? e.parameter.password : '';

    if (action === 'families') {
      const accessLevel = requireAccess_(password, false);
      return jsonResponse_({ ok: true, accessLevel: accessLevel, families: getFamilies_() });
    }

    if (action === 'reports') {
      requireAccess_(password, true);
      return jsonResponse_({ ok: true, accessLevel: 'admin', reports: getAttendanceReports_() });
    }

    throw new Error('Unknown request.');
  } catch (error) {
    console.error(error);
    return errorResponse_(error);
  }
}

function doPost(e) {
  try {
    const body = parseBody_(e);
    if (body.action === 'families') {
      const accessLevel = requireAccess_(body.password, false);
      return jsonResponse_({ ok: true, accessLevel: accessLevel, families: getFamilies_() });
    }

    if (body.action === 'reports') {
      requireAccess_(body.password, true);
      return jsonResponse_({ ok: true, accessLevel: 'admin', reports: getAttendanceReports_() });
    }

    if (body.action === 'save') {
      const accessLevel = requireAccess_(body.password, false);
      const result = saveCheckIn_(body);
      result.accessLevel = accessLevel;
      return jsonResponse_(result);
    }

    throw new Error('Unknown request.');
  } catch (error) {
    console.error(error);
    return errorResponse_(error);
  }
}

function requireAccess_(submittedPassword, adminOnly) {
  const properties = PropertiesService.getScriptProperties();
  const accessPassword = properties.getProperty(ACCESS_PASSWORD_PROPERTY);
  const adminPassword = properties.getProperty(ADMIN_PASSWORD_PROPERTY);

  if (!accessPassword || !adminPassword) {
    throw codedError_('Access passwords are not configured.', 'AUTH_NOT_CONFIGURED');
  }

  const password = typeof submittedPassword === 'string' ? submittedPassword : '';
  if (password === adminPassword) return 'admin';
  if (!adminOnly && password === accessPassword) return 'basic';
  throw codedError_('The password is incorrect. Please try again.', 'AUTH_REQUIRED');
}

function codedError_(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function errorResponse_(error) {
  const payload = { ok: false, error: publicError_(error) };
  if (error && (error.code === 'AUTH_REQUIRED' || error.code === 'AUTH_NOT_CONFIGURED')) {
    payload.code = error.code;
  }
  return jsonResponse_(payload);
}

function saveCheckIn_(body) {
  const family = cleanText_(body.family, 150, 'Family name');
  const notes = cleanText_(body.notes || '', MAX_NOTES_LENGTH, 'Notes', true);
  if (!Array.isArray(body.members)) {
    throw new Error('Members are invalid.');
  }
  const submittedMembers = body.members;
  const familyMap = getFamilyMap_();
  const isVisitor = family === VISITOR_FAMILY;
  if (!isVisitor) assertKnownFamily_(family, familyMap);

  const allowedMembers = isVisitor ? null : familyMap[family];
  const members = [];
  submittedMembers.forEach(function (value) {
    const member = cleanText_(value, 150, 'Member name');
    if (!isVisitor && allowedMembers.indexOf(member) === -1) {
      throw new Error('One or more selected family members are invalid.');
    }
    if (members.indexOf(member) === -1) {
      members.push(member);
    }
  });
  if (isVisitor && members.length === 0) {
    throw new Error('Enter at least one visitor name.');
  }
  if (isVisitor && members.length > MAX_VISITORS_PER_CHECK_IN) {
    throw new Error('Too many visitor names were entered.');
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    // Re-check while holding the lock so simultaneous requests cannot create
    // two attendance sets for the same family and day.
    const context = getCheckInContext_();
    const now = new Date();
    const checkInId = isVisitor
      ? buildVisitorCheckInId_(now)
      : buildCheckInId_(family, now);
    const existingRows = findCheckInRows_(checkInId, context);

    writeCheckInRows_(context, existingRows, {
      checkInId: checkInId,
      timestamp: now,
      family: family,
      members: members,
      notes: notes
    });

    return {
      ok: true,
      updated: existingRows.length > 0,
      record: {
        checkInId: checkInId,
        timestamp: now.toISOString(),
        family: family,
        members: members,
        notes: notes
      }
    };
  } finally {
    lock.releaseLock();
  }
}

function writeCheckInRows_(context, existingRows, record) {
  const sheet = context.sheet;
  const headers = context.headers;
  const width = sheet.getLastColumn();
  const row = existingRows.length > 0 ? existingRows[0].row : sheet.getLastRow() + 1;
  const template = existingRows.length > 0
    ? existingRows[0].values.slice(0, width)
    : new Array(width).fill('');
  const memberRows = record.members.length > 0 ? record.members : [''];

  // Keep the first existing row, remove the rest, then resize the row block to
  // exactly match the latest submission. Contiguous rows are deleted in one
  // Sheets call; separate legacy duplicates are still handled bottom-up.
  deleteExistingRowsExceptFirst_(sheet, existingRows);
  if (existingRows.length > 0 && memberRows.length > 1) {
    sheet.insertRowsAfter(row, memberRows.length - 1);
  }

  const rows = memberRows.map(function (member) {
    const values = template.slice();
    values[headers.CheckInID] = record.checkInId;
    values[headers.Timestamp] = record.timestamp;
    values[headers['Family Name']] = record.family;
    values[headers['Member Present']] = member;
    values[headers.Notes] = record.notes;
    return values;
  });
  const formats = rows.map(function () {
    const rowFormats = new Array(width).fill('@');
    rowFormats[headers.Timestamp] = 'yyyy-mm-dd hh:mm:ss';
    return rowFormats;
  });

  // Formatting and values are each sent as one batch instead of making a
  // separate Sheets service call for every cell.
  const range = sheet.getRange(row, 1, rows.length, width);
  range.setNumberFormats(formats);
  range.setValues(rows);
}

function deleteExistingRowsExceptFirst_(sheet, existingRows) {
  let index = existingRows.length - 1;
  while (index >= 1) {
    const endRow = existingRows[index].row;
    let startRow = endRow;
    index -= 1;

    while (index >= 1 && existingRows[index].row === startRow - 1) {
      startRow = existingRows[index].row;
      index -= 1;
    }

    sheet.deleteRows(startRow, endRow - startRow + 1);
  }
}

function getFamilies_() {
  const familyMap = getFamilyMap_();
  return Object.keys(familyMap)
    .sort(function (a, b) { return a.localeCompare(b); })
    .map(function (name) {
      return { name: name, members: familyMap[name] };
    });
}

function getAttendanceReports_() {
  const familyMap = getFamilyMap_();
  const familyNames = Object.keys(familyMap).sort(function (a, b) {
    return a.localeCompare(b);
  });
  const timezone = getSpreadsheet_().getSpreadsheetTimeZone();
  const now = new Date();
  const today = Utilities.formatDate(now, timezone, 'yyyy-MM-dd');
  const year = Number(today.slice(0, 4));
  let reportStartDate = '';
  let reportEndDate = '';
  const reportThursdayDates = Object.create(null);
  const presentToday = Object.create(null);
  const membersToday = Object.create(null);
  const yearlyDatesByFamily = Object.create(null);

  familyNames.forEach(function (family) {
    membersToday[family] = Object.create(null);
    yearlyDatesByFamily[family] = Object.create(null);
  });

  const context = getCheckInContext_();
  const sheet = context.sheet;
  const headers = context.headers;
  const lastRow = sheet.getLastRow();

  if (lastRow >= 2) {
    const values = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
    values.forEach(function (row) {
      const family = String(row[headers['Family Name']] || '').trim();
      const member = String(row[headers['Member Present']] || '').trim();
      if (!Object.prototype.hasOwnProperty.call(familyMap, family)) return;

      const checkInDate = getCheckInDate_(row, headers, timezone);
      if (!checkInDate) return;

      if (Number(checkInDate.slice(0, 4)) === year) {
        if (!reportStartDate || checkInDate < reportStartDate) reportStartDate = checkInDate;
        if (!reportEndDate || checkInDate > reportEndDate) reportEndDate = checkInDate;
        if (isWeekday_(checkInDate, 4)) reportThursdayDates[checkInDate] = true;
      }

      if (!member) return;

      if (checkInDate === today) {
        presentToday[family] = true;
        membersToday[family][member] = true;
      }

      if (Number(checkInDate.slice(0, 4)) === year && isWeekday_(checkInDate, 4)) {
        yearlyDatesByFamily[family][checkInDate] = true;
      }
    });
  }

  const thursdaysWithData = Object.keys(reportThursdayDates).length;

  const totalFamilies = familyNames.length;
  const checkedInFamilies = familyNames.filter(function (family) {
    return presentToday[family] === true;
  }).length;
  const totalMembers = familyNames.reduce(function (sum, family) {
    return sum + familyMap[family].length;
  }, 0);
  const checkedInMembers = familyNames.reduce(function (sum, family) {
    return sum + Object.keys(membersToday[family]).length;
  }, 0);

  return {
    generatedAt: now.toISOString(),
    date: today,
    year: year,
    daily: {
      checkedInFamilies: checkedInFamilies,
      totalFamilies: totalFamilies,
      familyPercent: percentage_(checkedInFamilies, totalFamilies),
      checkedInMembers: checkedInMembers,
      totalMembers: totalMembers,
      families: familyNames.map(function (family) {
        return {
          name: family,
          checkedIn: presentToday[family] === true,
          checkedInMembers: Object.keys(membersToday[family]).length,
          totalMembers: familyMap[family].length
        };
      })
    },
    yearly: {
      startDate: reportStartDate,
      endDate: reportEndDate,
      thursdaysWithData: thursdaysWithData,
      families: familyNames.map(function (family) {
        const attendedThursdays = Object.keys(yearlyDatesByFamily[family]).length;
        return {
          name: family,
          attendedThursdays: attendedThursdays,
          totalThursdays: thursdaysWithData,
          percent: percentage_(attendedThursdays, thursdaysWithData)
        };
      })
    }
  };
}

function getCheckInDate_(row, headers, timezone) {
  const checkInId = String(row[headers.CheckInID] || '').trim();
  const idMatch = /^(\d{4}-\d{2}-\d{2})\|/.exec(checkInId);
  if (idMatch) return idMatch[1];

  const timestamp = asDate_(row[headers.Timestamp]);
  return timestamp ? Utilities.formatDate(timestamp, timezone, 'yyyy-MM-dd') : '';
}

function isWeekday_(dateText, weekday) {
  return new Date(dateNumber_(dateText)).getUTCDay() === weekday;
}

function dateNumber_(dateText) {
  const parts = dateText.split('-').map(Number);
  return Date.UTC(parts[0], parts[1] - 1, parts[2]);
}

function percentage_(value, total) {
  return total > 0 ? Math.round((value / total) * 100) : 0;
}

function getFamilyMap_() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get(FAMILY_MAP_CACHE_KEY);
  if (cached) {
    try {
      return JSON.parse(cached);
    } catch (error) {
      cache.remove(FAMILY_MAP_CACHE_KEY);
    }
  }

  const context = getSheetContext_(FAMILY_LIST_SHEET, LIST_HEADERS);
  const sheet = context.sheet;
  const headers = context.headers;
  const lastRow = sheet.getLastRow();
  const familyMap = Object.create(null);

  if (lastRow < 2) {
    return familyMap;
  }

  const values = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getDisplayValues();
  values.forEach(function (row) {
    const family = String(row[headers['Family Name']] || '').trim();
    const member = String(row[headers['Member Name']] || '').trim();
    if (!family || !member) return;
    if (!familyMap[family]) familyMap[family] = [];
    if (familyMap[family].indexOf(member) === -1) familyMap[family].push(member);
  });

  cache.put(FAMILY_MAP_CACHE_KEY, JSON.stringify(familyMap), CACHE_SECONDS);
  return familyMap;
}

function findCheckInRows_(checkInId, existingContext) {
  const context = existingContext || getCheckInContext_();
  const sheet = context.sheet;
  const headers = context.headers;
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  // TextFinder performs the exact lookup inside Sheets, avoiding the transfer
  // and JavaScript scan of every attendance row on each save.
  const idRange = sheet.getRange(2, headers.CheckInID + 1, lastRow - 1, 1);
  const matches = idRange
    .createTextFinder(checkInId)
    .matchEntireCell(true)
    .findAll()
    .map(function (range) { return { row: range.getRow() }; })
    .sort(function (a, b) { return a.row - b.row; });

  if (matches.length > 0) {
    matches[0].values = sheet.getRange(matches[0].row, 1, 1, sheet.getLastColumn()).getValues()[0];
  }

  return matches;
}

function buildCheckInId_(family, timestamp) {
  const timezone = getSpreadsheet_().getSpreadsheetTimeZone();
  return Utilities.formatDate(timestamp, timezone, 'yyyy-MM-dd') + '|' + family;
}

function buildVisitorCheckInId_(timestamp) {
  return buildCheckInId_(VISITOR_FAMILY, timestamp) + '|' + Utilities.getUuid();
}

function getCheckInContext_() {
  return getSheetContext_(CHECK_INS_SHEET, CHECK_IN_HEADERS);
}

function getSheetContext_(name, requiredHeaders) {
  const sheet = getSpreadsheet_().getSheetByName(name);
  if (!sheet) {
    throw new Error('Required sheet "' + name + '" was not found.');
  }
  return { sheet: sheet, headers: getHeaderMap_(sheet, requiredHeaders) };
}

function getHeaderMap_(sheet, requiredHeaders) {
  const lastColumn = sheet.getLastColumn();
  if (lastColumn === 0) {
    throw new Error('Sheet "' + sheet.getName() + '" has no headers.');
  }

  const cache = CacheService.getScriptCache();
  const cacheKey = 'headers-' + sheet.getSheetId() + '-' + lastColumn;
  const cached = cache.get(cacheKey);
  if (cached) {
    try {
      const cachedMap = JSON.parse(cached);
      const complete = requiredHeaders.every(function (header) {
        return Object.prototype.hasOwnProperty.call(cachedMap, header);
      });
      if (complete) return cachedMap;
    } catch (error) {
      cache.remove(cacheKey);
    }
  }

  const row = sheet.getRange(1, 1, 1, lastColumn).getDisplayValues()[0];
  const map = Object.create(null);
  row.forEach(function (header, index) {
    map[String(header).trim()] = index;
  });

  requiredHeaders.forEach(function (header) {
    if (!Object.prototype.hasOwnProperty.call(map, header)) {
      throw new Error('Sheet "' + sheet.getName() + '" is missing the "' + header + '" column.');
    }
  });
  cache.put(cacheKey, JSON.stringify(map), CACHE_SECONDS);
  return map;
}

function getSpreadsheet_() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

function assertKnownFamily_(family, familyMap) {
  if (!Object.prototype.hasOwnProperty.call(familyMap, family)) {
    throw new Error('Select a valid family.');
  }
}

function cleanText_(value, maxLength, label, allowEmpty) {
  if (typeof value !== 'string') {
    throw new Error(label + ' is invalid.');
  }
  const text = value.trim();
  if (!allowEmpty && !text) {
    throw new Error(label + ' is required.');
  }
  if (text.length > maxLength) {
    throw new Error(label + ' is too long.');
  }
  return text;
}

function parseBody_(e) {
  if (!e || !e.postData || !e.postData.contents) {
    throw new Error('The request body is missing.');
  }
  try {
    return JSON.parse(e.postData.contents);
  } catch (error) {
    throw new Error('The request body is invalid.');
  }
}

function asDate_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) return value;
  const parsed = new Date(value);
  return isNaN(parsed.getTime()) ? null : parsed;
}

function publicError_(error) {
  const message = error && error.message ? String(error.message) : 'The request could not be completed.';
  return message.length <= 220 ? message : 'The request could not be completed.';
}

function jsonResponse_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}
