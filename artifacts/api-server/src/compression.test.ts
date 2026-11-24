import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { gzipSync, gunzipSync } from "node:zlib";
import { Readable } from "node:stream";
import express from "express";
import helmet from "helmet";
import { responseCompression } from "./middleware/responseCompression";
import { requestTiming } from "./middleware/requestTiming";

const payload = JSON.stringify({ rows: Array.from({ length: 100 }, (_, id) => ({ id, label: "repeatable asset data" })) });
const encoded = gzipSync(payload);
const logs: string[] = [];
let clock = 0;
const app = express();
app.use(helmet({ contentSecurityPolicy: false }));
app.use(responseCompression);
app.use(requestTiming((line) => logs.push(line), () => clock));
app.use((req, res) => {
  if (req.path === "/api/slow") clock += 1001;
  if (req.path === "/api/boundary") clock += 1000;
  if (req.path === "/api/preencoded") {
    res.setHeader("Content-Encoding", "gzip");
    res.type("json").send(encoded);
  } else if (req.path === "/api/small") {
    res.json({ ok: true });
  } else if (req.path === "/api/no-transform") {
    res.setHeader("Cache-Control", "no-transform");
    res.type("json").send(payload);
  } else if (req.path === "/api/binary") {
    res.type("image/png").send(Buffer.from(payload));
  } else if (req.path === "/api/stream-timing") {
    res.type("text");
    res.flushHeaders();
    clock += 1500;
    res.end("done");
  } else if (/download/i.test(req.path) || /^\/(?:objects|public-objects)\//i.test(req.path)) {
    // Compressible streamed bytes ensure the exclusion, not the MIME type,
    // is what protects content lengths and partial downloads.
    const partial = req.headers.range === "bytes=0-1023";
    const body = partial ? payload.slice(0, 1024) : payload;
    res.status(partial ? 206 : 200).set({
      "Content-Type": "text/plain",
      "Content-Length": String(Buffer.byteLength(body)),
      "Accept-Ranges": "bytes",
      "Content-Disposition": 'attachment; filename="fixture.txt"',
      ...(partial ? { "Content-Range": `bytes 0-1023/${Buffer.byteLength(payload)}` } : {}),
    });
    Readable.from([body]).pipe(res);
  } else {
    res.status(req.path === "/api/error" ? 503 : 200).type("json").send(payload);
  }
});
const server = http.createServer(app);
before(async () => { await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve)); });
after(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); });

function request(path: string, headers: http.OutgoingHttpHeaders = {}, method = "GET") {
  return new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }>((resolve, reject) => {
    const req = http.request({
      hostname: "127.0.0.1", port: (server.address() as AddressInfo).port,
      path, method, headers: { "Accept-Encoding": "gzip", ...headers },
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode!, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on("error", reject);
    req.end();
  });
}

test("gzip JSON above 1 KB is byte-equivalent and negotiates encoding", async () => {
  const gzip = await request("/api/assets");
  assert.equal(gzip.headers["content-encoding"], "gzip");
  assert.equal(gunzipSync(gzip.body).toString(), payload);
  assert.match(String(gzip.headers.vary), /Accept-Encoding/i);
  const identity = await request("/api/assets", { "Accept-Encoding": "identity" });
  assert.equal(identity.headers["content-encoding"], undefined);
  assert.equal(identity.body.toString(), payload);
});

test("sub-threshold, incompressible and no-transform responses retain default filtering", async () => {
  for (const path of ["/api/small", "/api/binary", "/api/no-transform"]) {
    assert.equal((await request(path)).headers["content-encoding"], undefined, path);
  }
});

test("pre-existing content encoding is not recompressed", async () => {
  const res = await request("/api/preencoded");
  assert.equal(res.headers["content-encoding"], "gzip");
  assert.deepEqual(res.body, encoded);
});

for (const path of [
  "/objects/fixture.txt", "/public-objects/fixture.txt",
  "/api/exports/job/download/pdf", "/api/exports/job/download/zip",
  "/api/drive/files/file/download", "/API/EXPORTS/job/DOWNLOAD/pdf",
]) {
  test(`stream exclusion preserves body, length and range headers: ${path}`, async () => {
    for (const partial of [false, true]) {
      const res = await request(path, partial ? { Range: "bytes=0-1023" } : {});
      assert.equal(res.headers["content-encoding"], undefined);
      assert.equal(res.status, partial ? 206 : 200);
      assert.equal(res.body.toString(), partial ? payload.slice(0, 1024) : payload);
      assert.equal(Number(res.headers["content-length"]), res.body.length);
      assert.equal(res.headers["accept-ranges"], "bytes");
      assert.equal(res.headers["content-disposition"], 'attachment; filename="fixture.txt"');
      if (partial) assert.match(String(res.headers["content-range"]), /^bytes 0-1023\//);
    }
  });
}

test("API success, error and OPTIONS responses get valid timing before headers; non-API does not", async () => {
  for (const [path, method] of [["/api/assets", "GET"], ["/api/error", "GET"], ["/api/assets", "OPTIONS"]]) {
    const res = await request(path!, {}, method);
    assert.match(String(res.headers["server-timing"]), /^app;dur=\d+\.\d{2}$/);
    assert.equal(res.headers["content-security-policy"], undefined);
    assert.equal(res.headers["x-content-type-options"], "nosniff");
  }
  assert.equal((await request("/elsewhere")).headers["server-timing"], undefined);
});

test("slow requests log exactly once with no query, body, cookie or authorization values", async () => {
  logs.length = 0;
  const res = await request("/api/slow?token=private-query", { Cookie: "private-cookie", Authorization: "private-auth" });
  assert.equal(res.headers["server-timing"], "app;dur=1001.00");
  assert.deepEqual(logs, ["slow-request GET /api/slow 200 1001.00"]);
  await request("/api/boundary");
  await request("/api/assets");
  assert.equal(logs.length, 1);
});

test("stream timing header measures first headers and one slow line measures completion", async () => {
  logs.length = 0;
  const res = await request("/api/stream-timing?private=value");
  assert.equal(res.headers["server-timing"], "app;dur=0.00");
  assert.deepEqual(logs, ["slow-request GET /api/stream-timing 200 1500.00"]);
});
