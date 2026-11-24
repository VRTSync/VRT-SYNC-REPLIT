import express, { type RequestHandler } from "express";
import path from "node:path";

declare const __STATIC_VERSION__: string | undefined;

export function getStaticVersion(): string {
  if (typeof __STATIC_VERSION__ !== "undefined" && __STATIC_VERSION__) return __STATIC_VERSION__;
  if (process.env.NODE_ENV === "development") return Date.now().toString(36);
  throw new Error("Static asset version missing: run the web-portal build before starting");
}

export function versionedStatic(root: string): RequestHandler {
  return express.static(root, {
    etag: true,
    maxAge: 0,
    setHeaders(res, filePath) {
      // HTML must always be fresh, including any future HTML inside public/.
      if (path.extname(filePath).toLowerCase() === ".html") {
        res.setHeader("Cache-Control", "no-store");
      } else if (new URL(res.req.originalUrl, "http://static.local").searchParams.has("v")) {
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      }
    },
  });
}
