// @ts-nocheck
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import pinoHttp from "pino-http";
import { setupSession } from "./auth";
import { logger } from "./lib/logger";
import healthRouter from "./routes/health";

const app: Express = express();

app.set("trust proxy", 1);

app.use((req: Request, res: Response, next: NextFunction) => {
  const origin = req.header("origin");
  const isLocalhost =
    origin?.startsWith("http://localhost:") ||
    origin?.startsWith("http://127.0.0.1:");
  const isReplitDomain =
    origin?.endsWith(".replit.dev") ||
    origin?.endsWith(".replit.app") ||
    origin?.endsWith(".janeway.replit.dev") ||
    origin?.endsWith(".expo.janeway.replit.dev");

  const knownOrigins = new Set<string>();
  if (process.env.REPLIT_DEV_DOMAIN) {
    knownOrigins.add(`https://${process.env.REPLIT_DEV_DOMAIN}`);
  }
  if (process.env.REPLIT_EXPO_DEV_DOMAIN) {
    knownOrigins.add(`https://${process.env.REPLIT_EXPO_DEV_DOMAIN}`);
  }
  if (process.env.REPLIT_DOMAINS) {
    process.env.REPLIT_DOMAINS.split(",").forEach((d) => {
      knownOrigins.add(`https://${d.trim()}`);
    });
  }

  if (origin && (knownOrigins.has(origin) || isLocalhost || isReplitDomain)) {
    res.header("Access-Control-Allow-Origin", origin);
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.header("Access-Control-Allow-Credentials", "true");
  }
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

app.use(
  express.json({
    verify: (req: any, _res: any, buf: any) => {
      req.rawBody = buf;
    },
  })
);
app.use(express.urlencoded({ extended: false }));

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return { id: req.id, method: req.method, url: req.url?.split("?")[0] };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
  })
);

setupSession(app);

app.use("/api", healthRouter);

app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
  const error = err as { status?: number; statusCode?: number; message?: string };
  const status = error.status || error.statusCode || 500;
  const message = error.message || "Internal Server Error";
  console.error("Internal Server Error:", err);
  if (res.headersSent) return next(err);
  return res.status(status).json({ message });
});

export default app;
