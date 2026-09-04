"use strict";

const crypto = require("node:crypto");

const VISITOR_FAMILY = "Visitor";
const CHECK_IN_HEADERS = ["CheckInID", "Timestamp", "Family Name", "Member Present", "Notes"];

class ApiError extends Error {
  constructor(message, code, status = 500) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

class GoogleSheetsStore {
  constructor(config = process.env) {
    this.config = config;
    this.token = "";
    this.tokenExpiresAt = 0;
    this.tokenRequest = null;
    this.familiesCache = null;
    this.metadataCache = null;
    this.writeQueue = Promise.resolve();
  }

  async getFamilies() {
    if (this.familiesCache?.expiresAt > Date.now()) return this.familiesCache.value;
    const rows = await this.getValues("Lists");
    if (!rows.length) throw sheetError("The Lists sheet has no headers.");
    const headers = headerMap(rows[0], "Lists", ["Family Name", "Member Name"]);
    const grouped = new Map();
    for (const row of rows.slice(1)) {
      const family = cell(row, headers["Family Name"]).trim();
      const member = cell(row, headers["Member Name"]).trim();
      if (!family || !member) continue;
      if (!grouped.has(family)) grouped.set(family, []);
      if (!grouped.get(family).includes(member)) grouped.get(family).push(member);
    }
    const families = Array.from(grouped, ([name, members]) => ({ name, members }))
      .sort((left, right) => left.name.localeCompare(right.name));
    this.familiesCache = { value: families, expiresAt: Date.now() + 5 * 60 * 1000 };
    return families;
  }

  async save(input) {
    return this.withWriteLock(async () => {
      const request = await this.validate(input, false);
      const metadata = await this.getMetadata();
      const timestamp = new Date().toISOString();
      const date = dateInTimeZone(new Date(), metadata.timeZone);
      const submissionId = validSubmissionId(request.submissionId) || crypto.randomUUID();
      const checkInId = request.isVisitor
        ? `${date}|${VISITOR_FAMILY}|${submissionId}`
        : `${date}|${request.family}`;

      const rows = await this.getValues("CheckIns");
      if (!rows.length) throw sheetError("The CheckIns sheet has no headers.");
      const headers = headerMap(rows[0], "CheckIns", CHECK_IN_HEADERS);
      const matches = rows
        .map((row, index) => ({ row, index }))
        .filter(item => item.index > 0 && cell(item.row, headers.CheckInID) === checkInId);
      const template = matches[0]?.row;
      const requests = matches
        .slice()
        .sort((left, right) => right.index - left.index)
        .map(match => ({
          deleteDimension: {
            range: {
              sheetId: metadata.checkInsSheetId,
              dimension: "ROWS",
              startIndex: match.index,
              endIndex: match.index + 1
            }
          }
        }));

      const memberRows = request.members.length ? request.members : [""];
      const width = rows[0].length;
      const appendedRows = memberRows.map(member => ({
        values: Array.from({ length: width }, (_, column) => {
          let value = template && column < template.length ? userValue(template[column]) : { stringValue: "" };
          if (column === headers.CheckInID) value = { stringValue: checkInId };
          if (column === headers.Timestamp) value = { stringValue: timestamp };
          if (column === headers["Family Name"]) value = { stringValue: request.family };
          if (column === headers["Member Present"]) value = { stringValue: member };
          if (column === headers.Notes) value = { stringValue: request.notes };
          return { userEnteredValue: value };
        })
      }));
      requests.push({
        appendCells: {
          sheetId: metadata.checkInsSheetId,
          rows: appendedRows,
          fields: "userEnteredValue"
        }
      });
      await this.batchUpdate({ requests });
      return {
        updated: matches.length > 0,
        record: { checkInId, timestamp, family: request.family, members: request.members, notes: request.notes }
      };
    });
  }

  async getStatus(input) {
    const request = await this.validate(input, true);
    const metadata = await this.getMetadata();
    const date = dateInTimeZone(new Date(), metadata.timeZone);
    const submissionId = validSubmissionId(request.submissionId);
    if (!submissionId) throw validationError("Submission ID is required.");
    const checkInId = request.isVisitor
      ? `${date}|${VISITOR_FAMILY}|${submissionId}`
      : `${date}|${request.family}`;
    const rows = await this.getValues("CheckIns");
    if (!rows.length) throw sheetError("The CheckIns sheet has no headers.");
    const headers = headerMap(rows[0], "CheckIns", CHECK_IN_HEADERS);
    const matches = rows.slice(1).filter(row => cell(row, headers.CheckInID) === checkInId);
    if (!matches.length) return null;
    const savedMembers = unique(matches.map(row => cell(row, headers["Member Present"]).trim()).filter(Boolean)).sort();
    if (!sameArray(savedMembers, request.members.slice().sort()) ||
        cell(matches[0], headers["Family Name"]).trim() !== request.family ||
        cell(matches[0], headers.Notes).trim() !== request.notes) return null;
    return {
      checkInId,
      timestamp: cell(matches[0], headers.Timestamp),
      family: request.family,
      members: request.members,
      notes: request.notes
    };
  }

  async getReports() {
    const [families, metadata, rows] = await Promise.all([
      this.getFamilies(),
      this.getMetadata(),
      this.getValues("CheckIns")
    ]);
    if (!rows.length) throw sheetError("The CheckIns sheet has no headers.");
    const headers = headerMap(rows[0], "CheckIns", CHECK_IN_HEADERS);
    const now = new Date();
    const today = dateInTimeZone(now, metadata.timeZone);
    const year = Number(today.slice(0, 4));
    const familyNames = new Set(families.map(family => family.name));
    const reportDates = new Set();
    const thursdayDates = new Set();
    const membersToday = new Map(families.map(family => [family.name, new Set()]));
    const yearlyDates = new Map(families.map(family => [family.name, new Set()]));

    for (const row of rows.slice(1)) {
      const family = cell(row, headers["Family Name"]).trim();
      if (!familyNames.has(family)) continue;
      const date = cell(row, headers.CheckInID).split("|", 1)[0];
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number(date.slice(0, 4)) !== year) continue;
      reportDates.add(date);
      const isThursday = new Date(`${date}T12:00:00Z`).getUTCDay() === 4;
      if (isThursday) thursdayDates.add(date);
      const member = cell(row, headers["Member Present"]).trim();
      if (!member) continue;
      if (date === today) membersToday.get(family).add(member);
      if (isThursday) yearlyDates.get(family).add(date);
    }

    const dailyFamilies = families.map(family => ({
      name: family.name,
      checkedIn: membersToday.get(family.name).size > 0,
      checkedInMembers: membersToday.get(family.name).size,
      totalMembers: family.members.length
    }));
    const checkedInFamilies = dailyFamilies.filter(family => family.checkedIn).length;
    const checkedInMembers = dailyFamilies.reduce((sum, family) => sum + family.checkedInMembers, 0);
    const dates = Array.from(reportDates).sort();
    return {
      generatedAt: now.toISOString(),
      date: today,
      year,
      daily: {
        checkedInFamilies,
        totalFamilies: families.length,
        familyPercent: percentage(checkedInFamilies, families.length),
        checkedInMembers,
        totalMembers: families.reduce((sum, family) => sum + family.members.length, 0),
        families: dailyFamilies
      },
      yearly: {
        startDate: dates[0] || "",
        endDate: dates.at(-1) || "",
        thursdaysWithData: thursdayDates.size,
        families: families.map(family => {
          const attendedThursdays = yearlyDates.get(family.name).size;
          return {
            name: family.name,
            attendedThursdays,
            totalThursdays: thursdayDates.size,
            percent: percentage(attendedThursdays, thursdayDates.size)
          };
        })
      }
    };
  }

  async validate(input, requireSubmissionId) {
    const family = clean(input?.family, 150, "Family name");
    const notes = clean(input?.notes ?? "", 500, "Notes", true);
    if (!Array.isArray(input?.members)) throw validationError("Members are invalid.");
    const members = unique(input.members.map(member => clean(member, 150, "Member name")));
    const families = await this.getFamilies();
    const familyEntry = families.find(item => item.name === family);
    const isVisitor = family === VISITOR_FAMILY;
    if (!isVisitor && !familyEntry) throw validationError("Select a valid family.");
    if (!isVisitor && members.some(member => !familyEntry.members.includes(member)))
      throw validationError("One or more selected family members are invalid.");
    if (isVisitor && (!members.length || members.length > 25))
      throw validationError("Visitor names are invalid.");
    if (requireSubmissionId && !input.submissionId) throw validationError("Submission ID is required.");
    return { family, members, notes, submissionId: input.submissionId, isVisitor };
  }

  async getValues(sheet) {
    const range = encodeURIComponent(`'${sheet}'!A:ZZ`);
    const response = await this.googleFetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(this.spreadsheetId())}/values/${range}?majorDimension=ROWS&valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING`
    );
    return response.values || [];
  }

  async getMetadata() {
    if (this.metadataCache?.expiresAt > Date.now()) return this.metadataCache.value;
    const response = await this.googleFetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(this.spreadsheetId())}?fields=properties.timeZone,sheets.properties(sheetId,title)`
    );
    const sheet = response.sheets?.find(item => item.properties?.title === "CheckIns");
    if (!sheet) throw sheetError('Required sheet "CheckIns" was not found.');
    const timeZone = response.properties?.timeZone || "America/Los_Angeles";
    try { dateInTimeZone(new Date(), timeZone); } catch (_error) { throw sheetError("The spreadsheet timezone is invalid."); }
    const value = { checkInsSheetId: sheet.properties.sheetId, timeZone };
    this.metadataCache = { value, expiresAt: Date.now() + 30 * 60 * 1000 };
    return value;
  }

  async batchUpdate(body) {
    await this.googleFetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(this.spreadsheetId())}:batchUpdate`,
      { method: "POST", body: JSON.stringify(body) }
    );
  }

  async googleFetch(url, options = {}) {
    const token = await this.getToken();
    let response;
    try {
      response = await fetch(url, {
        ...options,
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...options.headers }
      });
    } catch (_error) {
      throw new ApiError("Google Sheets could not be reached.", "SHEETS_ERROR", 502);
    }
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 180);
      throw new ApiError(`Google Sheets rejected the request (${response.status}). ${detail}`, "SHEETS_ERROR", 502);
    }
    return response.status === 204 ? {} : response.json();
  }

  async getToken() {
    if (this.token && this.tokenExpiresAt > Date.now() + 5 * 60 * 1000) return this.token;
    if (this.tokenRequest) return this.tokenRequest;
    this.tokenRequest = this.requestToken();
    try { return await this.tokenRequest; }
    finally { this.tokenRequest = null; }
  }

  async requestToken() {
    const raw = this.config.GOOGLE_SERVICE_ACCOUNT_JSON;
    if (!raw) throw new ApiError("Google service-account credentials are not configured.", "GOOGLE_NOT_CONFIGURED", 503);
    let credentials;
    try { credentials = JSON.parse(raw); } catch (_error) {
      throw new ApiError("Google service-account credentials are invalid.", "GOOGLE_NOT_CONFIGURED", 503);
    }
    if (!credentials.client_email || !credentials.private_key || !credentials.token_uri)
      throw new ApiError("Google service-account credentials are incomplete.", "GOOGLE_NOT_CONFIGURED", 503);
    const now = Math.floor(Date.now() / 1000);
    const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
    const claims = Buffer.from(JSON.stringify({
      iss: credentials.client_email,
      scope: "https://www.googleapis.com/auth/spreadsheets",
      aud: credentials.token_uri,
      iat: now,
      exp: now + 3300
    })).toString("base64url");
    const unsigned = `${header}.${claims}`;
    let signature;
    try { signature = crypto.sign("RSA-SHA256", Buffer.from(unsigned), credentials.private_key).toString("base64url"); }
    catch (_error) { throw new ApiError("Google service-account credentials are invalid.", "GOOGLE_NOT_CONFIGURED", 503); }
    let response;
    try {
      response = await fetch(credentials.token_uri, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
          assertion: `${unsigned}.${signature}`
        })
      });
    } catch (_error) {
      throw new ApiError("Google authentication could not be reached.", "GOOGLE_NOT_CONFIGURED", 503);
    }
    if (!response.ok) throw new ApiError("Google rejected the configured service-account credentials.", "GOOGLE_NOT_CONFIGURED", 503);
    const payload = await response.json();
    if (!payload.access_token) throw new ApiError("Google did not return an access token.", "GOOGLE_NOT_CONFIGURED", 503);
    this.token = payload.access_token;
    this.tokenExpiresAt = Date.now() + Number(payload.expires_in || 3600) * 1000;
    return this.token;
  }

  spreadsheetId() {
    if (!this.config.GOOGLE_SPREADSHEET_ID)
      throw new ApiError("The Google spreadsheet is not configured.", "GOOGLE_NOT_CONFIGURED", 503);
    return this.config.GOOGLE_SPREADSHEET_ID;
  }

  async withWriteLock(action) {
    const previous = this.writeQueue;
    let release;
    this.writeQueue = new Promise(resolve => { release = resolve; });
    await previous;
    try { return await action(); } finally { release(); }
  }
}

function clean(value, maxLength, label, allowEmpty = false) {
  if (typeof value !== "string") throw validationError(`${label} is invalid.`);
  const text = value.trim();
  if (!allowEmpty && !text) throw validationError(`${label} is required.`);
  if (text.length > maxLength) throw validationError(`${label} is too long.`);
  return text;
}

function validSubmissionId(value) {
  if (!value) return "";
  if (typeof value !== "string" || value.length > 100 || !/^[A-Za-z0-9_-]+$/.test(value))
    throw validationError("Submission ID is invalid.");
  return value;
}

function headerMap(row, sheet, required) {
  const map = Object.fromEntries(row.map((value, index) => [String(value).trim(), index]).filter(([name]) => name));
  for (const header of required) if (!(header in map)) throw sheetError(`Sheet "${sheet}" is missing the "${header}" column.`);
  return map;
}

function cell(row, index) { return index < row.length && row[index] != null ? String(row[index]) : ""; }
function userValue(value) {
  if (typeof value === "number") return { numberValue: value };
  if (typeof value === "boolean") return { boolValue: value };
  return { stringValue: value == null ? "" : String(value) };
}
function unique(values) { return Array.from(new Set(values)); }
function sameArray(left, right) { return left.length === right.length && left.every((value, index) => value === right[index]); }
function percentage(value, total) { return total ? Math.round(value * 100 / total) : 0; }
function validationError(message) { return new ApiError(message, "VALIDATION_ERROR", 400); }
function sheetError(message) { return new ApiError(message, "SHEETS_ERROR", 502); }
function dateInTimeZone(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

module.exports = { ApiError, GoogleSheetsStore, dateInTimeZone };
