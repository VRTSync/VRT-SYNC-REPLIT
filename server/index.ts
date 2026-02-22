import express from "express";
import type { Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { sendDueReminders } from "./pushNotifications";
import { startSchedulerInterval } from "./scheduler";
import * as fs from "fs";
import * as path from "path";

const app = express();
const log = console.log;

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

function setupCors(app: express.Application) {
  app.use((req, res, next) => {
    const origins = new Set<string>();

    if (process.env.REPLIT_DEV_DOMAIN) {
      origins.add(`https://${process.env.REPLIT_DEV_DOMAIN}`);
    }

    if (process.env.REPLIT_DOMAINS) {
      process.env.REPLIT_DOMAINS.split(",").forEach((d) => {
        origins.add(`https://${d.trim()}`);
      });
    }

    const origin = req.header("origin");

    // Allow localhost origins for Expo web development (any port)
    const isLocalhost =
      origin?.startsWith("http://localhost:") ||
      origin?.startsWith("http://127.0.0.1:");

    if (origin && (origins.has(origin) || isLocalhost)) {
      res.header("Access-Control-Allow-Origin", origin);
      res.header(
        "Access-Control-Allow-Methods",
        "GET, POST, PUT, DELETE, OPTIONS",
      );
      res.header("Access-Control-Allow-Headers", "Content-Type");
      res.header("Access-Control-Allow-Credentials", "true");
    }

    if (req.method === "OPTIONS") {
      return res.sendStatus(200);
    }

    next();
  });
}

function setupBodyParsing(app: express.Application) {
  app.use(
    express.json({
      verify: (req, _res, buf) => {
        req.rawBody = buf;
      },
    }),
  );

  app.use(express.urlencoded({ extended: false }));
}

function setupRequestLogging(app: express.Application) {
  app.use((req, res, next) => {
    const start = Date.now();
    const path = req.path;
    let capturedJsonResponse: Record<string, unknown> | undefined = undefined;

    const originalResJson = res.json;
    res.json = function (bodyJson, ...args) {
      capturedJsonResponse = bodyJson;
      return originalResJson.apply(res, [bodyJson, ...args]);
    };

    res.on("finish", () => {
      if (!path.startsWith("/api")) return;

      const duration = Date.now() - start;

      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    });

    next();
  });
}

function getAppName(): string {
  try {
    const appJsonPath = path.resolve(process.cwd(), "app.json");
    const appJsonContent = fs.readFileSync(appJsonPath, "utf-8");
    const appJson = JSON.parse(appJsonContent);
    return appJson.expo?.name || "App Landing Page";
  } catch {
    return "App Landing Page";
  }
}

function serveExpoManifest(platform: string, res: Response) {
  const manifestPath = path.resolve(
    process.cwd(),
    "static-build",
    platform,
    "manifest.json",
  );

  if (!fs.existsSync(manifestPath)) {
    return res
      .status(404)
      .json({ error: `Manifest not found for platform: ${platform}` });
  }

  res.setHeader("expo-protocol-version", "1");
  res.setHeader("expo-sfv-version", "0");
  res.setHeader("content-type", "application/json");

  const manifest = fs.readFileSync(manifestPath, "utf-8");
  res.send(manifest);
}

function serveLandingPage({
  req,
  res,
  landingPageTemplate,
  appName,
}: {
  req: Request;
  res: Response;
  landingPageTemplate: string;
  appName: string;
}) {
  const forwardedProto = req.header("x-forwarded-proto");
  const protocol = forwardedProto || req.protocol || "https";
  const forwardedHost = req.header("x-forwarded-host");
  const host = forwardedHost || req.get("host");
  const baseUrl = `${protocol}://${host}`;
  const expsUrl = `${host}`;

  log(`baseUrl`, baseUrl);
  log(`expsUrl`, expsUrl);

  const html = landingPageTemplate
    .replace(/BASE_URL_PLACEHOLDER/g, baseUrl)
    .replace(/EXPS_URL_PLACEHOLDER/g, expsUrl)
    .replace(/APP_NAME_PLACEHOLDER/g, appName);

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.status(200).send(html);
}

function configureExpoAndLanding(app: express.Application) {
  const templatePath = path.resolve(
    process.cwd(),
    "server",
    "templates",
    "landing-page.html",
  );
  const landingPageTemplate = fs.readFileSync(templatePath, "utf-8");
  const appName = getAppName();

  log("Serving static Expo files with dynamic manifest routing");

  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith("/api")) {
      return next();
    }

    if (req.path !== "/" && req.path !== "/manifest") {
      return next();
    }

    const platform = req.header("expo-platform");
    if (platform && (platform === "ios" || platform === "android")) {
      return serveExpoManifest(platform, res);
    }

    if (req.path === "/") {
      return serveLandingPage({
        req,
        res,
        landingPageTemplate,
        appName,
      });
    }

    next();
  });

  app.use("/assets", express.static(path.resolve(process.cwd(), "assets")));
  app.use(express.static(path.resolve(process.cwd(), "static-build")));

  log("Expo routing: Checking expo-platform header on / and /manifest");
}

function configureAdminHub(app: express.Application) {
  app.use("/admin-static", express.static(path.resolve(process.cwd(), "server", "public", "admin")));

  const adminShellPath = path.resolve(process.cwd(), "server", "templates", "admin-shell.html");
  const adminShell = fs.readFileSync(adminShellPath, "utf-8");

  app.get("/web/admin/login", (_req: Request, res: Response) => {
    const loginHtml = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>VRTSync Admin Login</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Inter',sans-serif;background:#0C1D31;display:flex;align-items:center;justify-content:center;min-height:100vh;color:#fff}
.login-box{background:#fff;border-radius:12px;padding:40px;width:100%;max-width:400px;color:#1f2937}
.login-box h1{font-size:22px;margin-bottom:8px;color:#0C1D31}
.login-box p{font-size:14px;color:#6b7280;margin-bottom:24px}
.form-group{margin-bottom:16px}
.form-group label{display:block;font-size:13px;font-weight:600;margin-bottom:4px;color:#374151}
.form-group input{width:100%;padding:10px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;font-family:inherit}
.form-group input:focus{outline:none;border-color:#25C1AC;box-shadow:0 0 0 3px rgba(37,193,172,0.1)}
.btn{width:100%;padding:10px;background:#25C1AC;color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;font-family:inherit}
.btn:hover{background:#1da393}
.error{color:#ef4444;font-size:13px;margin-bottom:12px;display:none}
</style></head><body>
<div class="login-box">
<h1>VRTSync Admin</h1>
<p>Sign in to access the admin hub</p>
<div class="error" id="login-error"></div>
<div class="form-group"><label>Username</label><input type="text" id="username" autofocus /></div>
<div class="form-group"><label>Password</label><input type="password" id="password" /></div>
<button class="btn" id="login-btn">Sign In</button>
</div>
<script>
document.getElementById('login-btn').addEventListener('click',doLogin);
document.getElementById('password').addEventListener('keydown',e=>{if(e.key==='Enter')doLogin()});
async function doLogin(){
  const u=document.getElementById('username').value.trim();
  const p=document.getElementById('password').value;
  const err=document.getElementById('login-error');
  err.style.display='none';
  if(!u||!p){err.textContent='Enter username and password';err.style.display='block';return}
  try{
    const r=await fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify({username:u,password:p})});
    if(!r.ok){const d=await r.json().catch(()=>({}));err.textContent=d.message||'Login failed';err.style.display='block';return}
    const me=await fetch('/api/auth/me',{credentials:'same-origin'}).then(r=>r.json());
    if(me.user?.role!=='admin'){err.textContent='Admin access required';err.style.display='block';await fetch('/api/auth/logout',{method:'POST',credentials:'same-origin'});return}
    window.location.href='/web/admin/dashboard';
  }catch(e){err.textContent='Network error';err.style.display='block'}
}
</script></body></html>`;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(loginHtml);
  });

  app.get("/web/admin", (_req: Request, res: Response) => {
    res.redirect("/web/admin/dashboard");
  });

  app.get(/^\/web\/admin\/(?!login).*$/, (_req: Request, res: Response) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(adminShell);
  });

  log("Admin hub configured at /web/admin/*");
}

function setupErrorHandler(app: express.Application) {
  app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    const error = err as {
      status?: number;
      statusCode?: number;
      message?: string;
    };

    const status = error.status || error.statusCode || 500;
    const message = error.message || "Internal Server Error";

    console.error("Internal Server Error:", err);

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });
}

(async () => {
  setupCors(app);
  setupBodyParsing(app);
  setupRequestLogging(app);

  configureExpoAndLanding(app);
  configureAdminHub(app);

  const server = await registerRoutes(app);

  setupErrorHandler(app);

  const port = parseInt(process.env.PORT || "5000", 10);
  server.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    () => {
      log(`express server serving on port ${port}`);

      const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
      setInterval(() => {
        log("Running daily due reminder check...");
        sendDueReminders().catch(err => console.error("Due reminder error:", err));
      }, TWENTY_FOUR_HOURS);

      startSchedulerInterval(3600000);
    },
  );
})();
