/**
 * Summit Leadership Check-In API
 *
 * This file is intended to be copied into a bound Apps Script project opened
 * from the Summit Google Sheet.
 */

const CHECK_INS_SHEET = 'CheckIns';
const FAMILY_LIST_SHEET = 'Lists';
const MAX_NOTES_LENGTH = 500;
const CACHE_SECONDS = 300;
const FAMILY_MAP_CACHE_KEY = 'summit-family-map-v1';

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

    if (action === 'families') {
      return jsonResponse_({ ok: true, families: getFamilies_() });
    }

    throw new Error('Unknown request.');
  } catch (error) {
    console.error(error);
    return jsonResponse_({ ok: false, error: publicError_(error) });
  }
}

function doPost(e) {
  try {
    const body = parseBody_(e);
    if (body.action !== 'save') {
      throw new Error('Unknown request.');
    }

    return jsonResponse_(saveCheckIn_(body));
  } catch (error) {
    console.error(error);
    return jsonResponse_({ ok: false, error: publicError_(error) });
  }
}

function saveCheckIn_(body) {
  const family = cleanText_(body.family, 150, 'Family name');
  const notes = cleanText_(body.notes || '', MAX_NOTES_LENGTH, 'Notes', true);
  if (!Array.isArray(body.members)) {
    throw new Error('Members are invalid.');
  }
  const submittedMembers = body.members;
  const familyMap = getFamilyMap_();
  assertKnownFamily_(family, familyMap);

  const allowedMembers = familyMap[family];
  const members = [];
  submittedMembers.forEach(function (value) {
    const member = cleanText_(value, 150, 'Member name');
    if (allowedMembers.indexOf(member) === -1) {
      throw new Error('One or more selected family members are invalid.');
    }
    if (members.indexOf(member) === -1) {
      members.push(member);
    }
  });

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    // Re-check while holding the lock so simultaneous requests cannot create
    // two attendance sets for the same family and day.
    const context = getCheckInContext_();
    const existingRows = findTodaysCheckInRows_(family, context);
    const now = new Date();
    let existingId = '';
    for (let index = existingRows.length - 1; index >= 0 && !existingId; index -= 1) {
      existingId = String(existingRows[index].values[context.headers.CheckInID] || '').trim();
    }
    const checkInId = existingId || Utilities.getUuid();

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
  // exactly match the latest submission. Deleting bottom-up keeps row indexes
  // stable, including when older duplicate data is not contiguous.
  for (let index = existingRows.length - 1; index >= 1; index -= 1) {
    sheet.deleteRow(existingRows[index].row);
  }
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

function getFamilies_() {
  const familyMap = getFamilyMap_();
  return Object.keys(familyMap)
    .sort(function (a, b) { return a.localeCompare(b); })
    .map(function (name) {
      return { name: name, members: familyMap[name] };
    });
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

  const sheet = getSheetWithHeaders_(FAMILY_LIST_SHEET, LIST_HEADERS);
  const headers = getHeaderMap_(sheet, LIST_HEADERS);
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

function findTodaysCheckInRows_(family, existingContext) {
  const context = existingContext || getCheckInContext_();
  const sheet = context.sheet;
  const headers = context.headers;
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  const values = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
  const timezone = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();
  const today = Utilities.formatDate(new Date(), timezone, 'yyyy-MM-dd');

  const matches = [];
  for (let index = 0; index < values.length; index += 1) {
    const row = values[index];
    if (String(row[headers['Family Name']] || '').trim() !== family) continue;

    const date = asDate_(row[headers.Timestamp]);
    if (date && Utilities.formatDate(date, timezone, 'yyyy-MM-dd') === today) {
      matches.push({ row: index + 2, values: row });
    }
  }

  return matches;
}

function getCheckInContext_() {
  const sheet = getSheetWithHeaders_(CHECK_INS_SHEET, CHECK_IN_HEADERS);
  return { sheet: sheet, headers: getHeaderMap_(sheet, CHECK_IN_HEADERS) };
}

function getSheetWithHeaders_(name, requiredHeaders) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sheet) {
    throw new Error('Required sheet "' + name + '" was not found.');
  }
  getHeaderMap_(sheet, requiredHeaders);
  return sheet;
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
