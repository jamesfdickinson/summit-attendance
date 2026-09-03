"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..", "www");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.webmanifest"), "utf8"));
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");

assert.equal(manifest.display, "standalone");
assert.equal(manifest.start_url, "./");
assert.match(html, /rel="manifest" href="manifest\.webmanifest"/);
assert.match(html, /rel="apple-touch-icon"/);
assert.match(html, /mobile-web-app-capable/);
assert.match(html, /id="install-button"[^>]*hidden/);
assert.match(html, /id="admin-link"[^>]*href="admin\.html"/);
assert.match(app, /adminLink\.href = "admin\.html\?demo=1"/);
assert.match(app, /beforeinstallprompt/);
assert.match(app, /\/Android\/i/);
assert.match(app, /display-mode: standalone/);
assert.match(app, /\.prompt\(\)/);
assert.match(html, /id="visitor-field" hidden/);
assert.match(html, /id="access-page"/);
assert.match(html, /id="access-password"[^>]*type="password"/);
assert.match(html, /id="app-shell" hidden/);
assert.match(app, /summit-check-in-access-password/);
assert.doesNotMatch(app, /summit-check-in-admin-password/);
assert.match(app, /password: state\.password/);
assert.match(app, /error\.code === "AUTH_REQUIRED"/);
assert.match(html, /id="visitor-names"/);
assert.match(app, /new Option\(VISITOR_FAMILY, VISITOR_FAMILY\)/);
assert.match(app, /\.split\(\/\[\\n,\]\+\//);
assert.match(app, /elements\.visitorNames\.addEventListener\("input", setFormControls\)/);
assert.match(app, /submissionId: createSubmissionId\(\)/);
assert.match(app, /request\("status"/);
assert.match(app, /await confirmSaved\(payload\)/);

for (const icon of manifest.icons) {
  const iconPath = path.join(root, icon.src);
  assert.equal(fs.existsSync(iconPath), true, `missing manifest icon: ${icon.src}`);
  const png = fs.readFileSync(iconPath);
  const [expectedWidth, expectedHeight] = icon.sizes.split("x").map(Number);
  assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  assert.equal(png.readUInt32BE(16), expectedWidth);
  assert.equal(png.readUInt32BE(20), expectedHeight);
  assert.match(icon.purpose, /maskable/);
}

assert.equal(fs.existsSync(path.join(root, "service-worker.js")), false);
assert.match(app, /getRegistration\(appScope\)/);
assert.match(app, /registration\.unregister\(\)/);

console.log("Online-only PWA manifest tests passed.");
