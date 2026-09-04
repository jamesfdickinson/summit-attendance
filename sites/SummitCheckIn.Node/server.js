"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");
const { ApiError, GoogleSheetsStore } = require("./google-sheets");

const publicDirectory = path.join(__dirname, "public");
const store = new GoogleSheetsStore();
const port = Number(process.env.PORT || 3000);
const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml"
};

function sameSecret(submitted, expected) {
  const left = Buffer.from(submitted || "");
  const right = Buffer.from(expected || "");
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function requireAccess(request, adminOnly = false) {
  const basic = process.env.SUMMIT_ACCESS_PASSWORD;
  const admin = process.env.SUMMIT_ADMIN_PASSWORD;
  if (!basic || !admin) throw new ApiError("Access passwords are not configured.", "AUTH_NOT_CONFIGURED", 503);
  const submitted = String(request.headers["x-summit-password"] || "");
  if (sameSecret(submitted, admin)) return "admin";
  if (!adminOnly && sameSecret(submitted, basic)) return "basic";
  throw new ApiError("The password is incorrect. Please try again.", "AUTH_REQUIRED", 401);
}

function json(response, status, body) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1024 * 1024) throw new ApiError("The request is too large.", "VALIDATION_ERROR", 413);
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); }
  catch (_error) { throw new ApiError("The request body is invalid.", "VALIDATION_ERROR", 400); }
}

async function handleApi(request, response, pathname) {
  if (request.method === "GET" && pathname === "/api/health") return json(response, 200, { ok: true });
  if (request.method === "POST" && pathname === "/api/access") {
    const accessLevel = requireAccess(request);
    return json(response, 200, { ok: true, accessLevel });
  }
  if (request.method === "GET" && pathname === "/api/families") {
    const accessLevel = requireAccess(request);
    const families = await store.getFamilies();
    return json(response, 200, { ok: true, accessLevel, families });
  }
  if (request.method === "POST" && pathname === "/api/check-ins") {
    const accessLevel = requireAccess(request);
    const result = await store.save(await readJson(request));
    return json(response, 200, { ok: true, accessLevel, ...result });
  }
  if (request.method === "POST" && pathname === "/api/check-ins/status") {
    const accessLevel = requireAccess(request);
    const record = await store.getStatus(await readJson(request));
    return json(response, 200, { ok: true, accessLevel, saved: Boolean(record), record });
  }
  if (request.method === "GET" && pathname === "/api/reports") {
    requireAccess(request, true);
    const reports = await store.getReports();
    return json(response, 200, { ok: true, accessLevel: "admin", reports });
  }
  throw new ApiError("API route not found.", "NOT_FOUND", 404);
}

async function serveStatic(request, response, pathname) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD" });
    return response.end();
  }
  let relativePath;
  try { relativePath = decodeURIComponent(pathname); }
  catch (_error) { throw new ApiError("Page not found.", "NOT_FOUND", 404); }
  if (relativePath === "/") relativePath = "/index.html";
  let filename = path.resolve(publicDirectory, `.${relativePath}`);
  if (!filename.startsWith(`${publicDirectory}${path.sep}`)) throw new ApiError("Page not found.", "NOT_FOUND", 404);
  try {
    const stat = await fs.stat(filename);
    if (stat.isDirectory()) filename = path.join(filename, "index.html");
  } catch (_error) {
    if (!path.extname(relativePath)) filename = path.join(publicDirectory, "index.html");
    else throw new ApiError("Page not found.", "NOT_FOUND", 404);
  }
  const content = await fs.readFile(filename);
  response.writeHead(200, {
    "Content-Type": mimeTypes[path.extname(filename).toLowerCase()] || "application/octet-stream",
    "Cache-Control": /\.(html|js|css|webmanifest)$/.test(filename) ? "no-cache" : "public, max-age=86400",
    "X-Content-Type-Options": "nosniff"
  });
  response.end(request.method === "HEAD" ? undefined : content);
}

const server = http.createServer(async (request, response) => {
  const started = Date.now();
  let pathname = "/";
  try {
    pathname = new URL(request.url, "http://localhost").pathname;
    if (pathname.startsWith("/api/")) await handleApi(request, response, pathname);
    else await serveStatic(request, response, pathname);
  } catch (error) {
    const failure = error instanceof ApiError
      ? error
      : new ApiError("The request could not be completed.", "SERVER_ERROR", 500);
    if (!(error instanceof ApiError)) console.error(error);
    if (!response.headersSent) json(response, failure.status, { ok: false, error: failure.message, code: failure.code });
    else response.end();
  } finally {
    if (pathname.startsWith("/api/"))
      console.log(`${request.method} ${pathname} ${response.statusCode} ${Date.now() - started}ms`);
  }
});

if (require.main === module) {
  server.listen(port, () => console.log(`Summit Check-In listening on http://localhost:${port}`));
}

module.exports = { requireAccess, server };
