"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..", "www");
const html = fs.readFileSync(path.join(root, "admin.html"), "utf8");
const script = fs.readFileSync(path.join(root, "admin.js"), "utf8");
const styles = fs.readFileSync(path.join(root, "admin.css"), "utf8");

assert.match(html, /id="daily-progress"/);
assert.match(html, /id="access-page"/);
assert.match(html, /id="access-password"[^>]*type="password"/);
assert.match(html, /id="admin-page" hidden/);
assert.match(html, /id="member-count"/);
assert.match(html, /id="daily-list"/);
assert.match(html, /id="yearly-list"/);
assert.match(html, /id="back-button"[^>]*href="\.\/"/);
assert.match(html, /class="admin-topbar"/);
assert.match(html, /class="admin-topbar"[\s\S]*id="back-button"[\s\S]*id="refresh-button"[\s\S]*<\/nav>/);
assert.match(html, /id="refresh-button"[^>]*aria-label="Refresh reports"[^>]*>[\s\S]*<svg/);
assert.match(html, /id="daily-tab"[^>]*role="tab"/);
assert.match(html, /id="yearly-tab"[^>]*role="tab"/);
assert.match(html, /id="daily-panel"[^>]*role="tabpanel"/);
assert.match(html, /id="yearly-panel"[^>]*role="tabpanel"[^>]*hidden/);
assert.match(script, /action: "reports"/);
assert.match(script, /summit-check-in-admin-password/);
assert.match(script, /JSON\.stringify\(\{ action: "reports", password \}\)/);
assert.match(script, /error\.code === "AUTH_REQUIRED"/);
assert.match(script, /Google Apps Script deployment is out of date/);
assert.match(script, /daily\.families\.map\(makeStatusRow\)/);
assert.match(script, /yearly\.families\.map\(makeYearRow\)/);
assert.match(script, /yearly\.thursdaysWithData/);
assert.match(script, /back\.href = "\.\/\?demo=1"/);
assert.match(script, /function selectTab/);
assert.match(script, /"ArrowLeft", "ArrowRight", "Home", "End"/);
assert.match(styles, /\.progress-track/);
assert.match(styles, /\.report-tab\[aria-selected="true"\]/);
assert.match(styles, /\.admin-topbar[\s\S]*justify-content: space-between/);

console.log("Admin report page tests passed.");
