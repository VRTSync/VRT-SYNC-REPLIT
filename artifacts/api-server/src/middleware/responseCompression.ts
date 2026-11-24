import compression from "compression";

// Keep object streams, export archives and drive downloads byte-for-byte intact.
// Match the actual registered routes (including Express's case-insensitive paths).
export const responseCompression = compression({
  threshold: 1024,
  filter(req, res) {
    if (res.hasHeader("Content-Encoding")) return false;
    if (
      /^\/(?:objects|public-objects)(?:\/|$)/i.test(req.path) ||
      /^\/api\/exports\/[^/]+\/download(?:\/|$)/i.test(req.path) ||
      /^\/api\/drive\/files\/[^/]+\/download\/?$/i.test(req.path)
    ) return false;
    return compression.filter(req, res);
  },
});
