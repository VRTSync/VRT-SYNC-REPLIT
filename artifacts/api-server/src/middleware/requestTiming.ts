import type { RequestHandler } from "express";
import onHeaders from "on-headers";
import { performance } from "node:perf_hooks";

/** Header measures time to headers; slow log measures the full response lifetime.
 * Injected clock/sink keep boundary and privacy tests deterministic.
 */
export function requestTiming(
  log: (line: string) => void,
  now: () => number = () => performance.now(),
): RequestHandler {
  return (req, res, next) => {
    const started = now();
    // Capture before Express routers temporarily rewrite req.url.
    const pathname = (req.originalUrl || req.url).split("?")[0];
    if (!/^\/api(?:\/|$)/i.test(pathname)) return next();
    const safePath = pathname.replace(/[\r\n\t\u0000-\u001f\u007f]/g, "");
    onHeaders(res, function () {
      this.appendHeader("Server-Timing", `app;dur=${Math.max(0, now() - started).toFixed(2)}`);
    });
    let recorded = false;
    const record = () => {
      if (recorded) return;
      recorded = true;
      const duration = Math.max(0, now() - started);
      if (duration > 1000) {
        log(`slow-request ${req.method} ${safePath} ${res.statusCode} ${duration.toFixed(2)}`);
      }
    };
    res.once("finish", record);
    res.once("close", record);
    next();
  };
}
