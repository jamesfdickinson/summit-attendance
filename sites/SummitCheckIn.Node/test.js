"use strict";

const assert = require("node:assert/strict");
const { dateInTimeZone } = require("./google-sheets");

process.env.SUMMIT_ACCESS_PASSWORD = "basic-test";
process.env.SUMMIT_ADMIN_PASSWORD = "admin-test";
delete process.env.GOOGLE_SPREADSHEET_ID;
delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;

const { server } = require("./server");

async function request(origin, pathname, password, options = {}) {
  return fetch(`${origin}${pathname}`, {
    ...options,
    headers: { ...(password ? { "X-Summit-Password": password } : {}), ...options.headers }
  });
}

async function run() {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const origin = `http://127.0.0.1:${address.port}`;
  try {
    const health = await request(origin, "/api/health");
    assert.equal(health.status, 200);
    assert.equal((await health.json()).ok, true);

    const page = await request(origin, "/");
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Summit Leadership Academy/);

    const adminPage = await request(origin, "/admin.html");
    assert.equal(adminPage.status, 200);
    assert.match(await adminPage.text(), /Attendance reports/);

    const basic = await request(origin, "/api/access", "basic-test", { method: "POST" });
    assert.equal(basic.status, 200);
    assert.equal((await basic.json()).accessLevel, "basic");

    const elevated = await request(origin, "/api/access", "admin-test", { method: "POST" });
    assert.equal(elevated.status, 200);
    assert.equal((await elevated.json()).accessLevel, "admin");

    const wrong = await request(origin, "/api/families", "wrong");
    assert.equal(wrong.status, 401);
    assert.equal((await wrong.json()).code, "AUTH_REQUIRED");

    const basicReport = await request(origin, "/api/reports", "basic-test");
    assert.equal(basicReport.status, 401);
    assert.equal((await basicReport.json()).code, "AUTH_REQUIRED");

    const missingGoogle = await request(origin, "/api/families", "basic-test");
    assert.equal(missingGoogle.status, 503);
    assert.equal((await missingGoogle.json()).code, "GOOGLE_NOT_CONFIGURED");

    assert.equal(dateInTimeZone(new Date("2026-09-04T02:00:00Z"), "America/Los_Angeles"), "2026-09-03");
    console.log("Node site tests passed.");
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
