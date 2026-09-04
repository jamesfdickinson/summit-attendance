"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..", "sites", "SummitCheckIn.Node", "public");
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
assert.match(script, /fetch\("\/api\/reports"/);
assert.match(script, /"X-Summit-Password": password/);
assert.match(script, /summit-check-in-admin-password/);
assert.match(script, /localStorage\.setItem\(ADMIN_PASSWORD_STORAGE_KEY, value\)/);
assert.match(script, /readAdminPassword\(\)/);
assert.doesNotMatch(script, /CLIENT_ADMIN_PASSWORD/);
assert.match(script, /daily\.families\.map\(makeStatusRow\)/);
assert.match(script, /family=\$\{encodeURIComponent\(family\.name\)\}/);
assert.match(script, /&return=reports/);
assert.match(script, /checkIn\.textContent = "Check in"/);
assert.match(script, /if \(!family\.checkedIn\)/);
assert.match(script, /yearly\.families\.map\(makeYearRow\)/);
assert.match(script, /yearly\.thursdaysWithData/);
assert.match(script, /back\.href = "\.\/\?demo=1"/);
assert.match(script, /function selectTab/);
assert.match(script, /"ArrowLeft", "ArrowRight", "Home", "End"/);
assert.match(styles, /\.progress-track/);
assert.match(styles, /\.report-tab\[aria-selected="true"\]/);
assert.match(styles, /\.admin-topbar[\s\S]*justify-content: space-between/);
assert.match(styles, /\.check-in-link/);

console.log("Admin report page tests passed.");
