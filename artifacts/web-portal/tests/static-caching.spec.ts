import { test, expect } from "@playwright/test";

for (const file of [
  "/admin-static/router.js",
  "/portal-static/portal.js",
  "/common-static/utils.js",
  "/portfolio-static/portfolio.js",
]) {
  test(`version-aware caching and ETags: ${file}`, async ({ request }) => {
    const plain = await request.get(file);
    expect(plain.status()).toBe(200);
    expect(plain.headers()["cache-control"]).toBe("public, max-age=0");
    expect(plain.headers().etag).toBeTruthy();
    const versioned = await request.get(`${file}?v=build-fixture`);
    expect(versioned.headers()["cache-control"]).toBe("public, max-age=31536000, immutable");
    expect(await versioned.body()).toEqual(await plain.body());
    const validated = await request.get(file, { headers: { "If-None-Match": plain.headers().etag! } });
    expect(validated.status()).toBe(304);
    expect(validated.headers()["cache-control"]).toBe("public, max-age=0");
    const otherQuery = await request.get(`${file}?other=value`);
    expect(otherQuery.headers()["cache-control"]).toBe("public, max-age=0");
  });
}

test("HTML stays no-store with the existing CSP and gzip", async ({ request }) => {
  const res = await request.get("/web/login", { headers: { "Accept-Encoding": "gzip" } });
  expect(res.headers()["cache-control"]).toBe("no-store");
  expect(res.headers()["content-encoding"]).toBe("gzip");
  expect(res.headers()["content-security-policy"]).toBe(
    "default-src 'self';base-uri 'self';font-src 'self' https://fonts.gstatic.com;form-action 'self';frame-ancestors 'self';img-src 'self' data: https:;object-src 'none';script-src 'self' 'unsafe-inline' https://unpkg.com;script-src-attr 'none';style-src 'self' 'unsafe-inline' https://unpkg.com https://fonts.googleapis.com;upgrade-insecure-requests;connect-src 'self'"
  );
  expect(res.headers()["set-cookie"]).toBeUndefined();
  const map = await request.get("/leaflet-map.html");
  expect(map.headers()["cache-control"]).toBe("no-store");
});
