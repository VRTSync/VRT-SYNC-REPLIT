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
  app.get("/leaflet-map.html", (_req: Request, res: Response) => {
    res.sendFile(path.resolve(process.cwd(), "server", "public", "leaflet-map.html"));
  });
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
body{font-family:'Inter',-apple-system,BlinkMacSystemFont,sans-serif;background:linear-gradient(160deg,#06101c 0%,#0C1D31 40%,#132a45 100%);display:flex;align-items:center;justify-content:center;min-height:100vh;color:#fff;-webkit-font-smoothing:antialiased}
body::before{content:'';position:fixed;top:0;left:0;right:0;bottom:0;background:radial-gradient(ellipse at 30% 20%,rgba(37,193,172,0.08) 0%,transparent 60%),radial-gradient(ellipse at 70% 80%,rgba(37,193,172,0.05) 0%,transparent 50%);pointer-events:none}
.login-wrapper{position:relative;z-index:1;width:100%;max-width:420px;padding:20px}
.brand{text-align:center;margin-bottom:32px}
.brand-logo{display:inline-flex;align-items:center;justify-content:center;width:52px;height:52px;background:linear-gradient(135deg,#25C1AC,#1da393);border-radius:14px;font-size:24px;font-weight:800;color:#fff;margin-bottom:16px;box-shadow:0 4px 16px rgba(37,193,172,0.35);letter-spacing:-1px}
.brand h1{font-size:28px;font-weight:700;letter-spacing:0.5px;margin-bottom:4px}
.brand p{font-size:12px;color:rgba(37,193,172,0.6);text-transform:uppercase;letter-spacing:2px;font-weight:600}
.login-box{background:rgba(255,255,255,0.97);border-radius:20px;padding:36px;color:#1f2937;box-shadow:0 20px 60px rgba(0,0,0,0.3),0 0 0 1px rgba(255,255,255,0.05)}
.login-box h2{font-size:18px;margin-bottom:4px;color:#0C1D31;font-weight:700}
.login-box .subtitle{font-size:14px;color:#6b7280;margin-bottom:24px}
.form-group{margin-bottom:16px}
.form-group label{display:block;font-size:13px;font-weight:600;margin-bottom:5px;color:#374151}
.form-group input{width:100%;padding:12px 16px;border:1px solid #e5e7eb;border-radius:10px;font-size:14px;font-family:inherit;background:#f9fafb;transition:all 0.2s}
.form-group input:focus{outline:none;border-color:#25C1AC;box-shadow:0 0 0 3px rgba(37,193,172,0.15);background:#fff}
.btn{width:100%;padding:12px;background:linear-gradient(135deg,#25C1AC,#1da393);color:#fff;border:none;border-radius:10px;font-size:15px;font-weight:600;cursor:pointer;font-family:inherit;transition:all 0.2s;box-shadow:0 2px 8px rgba(37,193,172,0.3);margin-top:8px}
.btn:hover{background:linear-gradient(135deg,#1da393,#189985);box-shadow:0 4px 16px rgba(37,193,172,0.4);transform:translateY(-1px)}
.error{color:#ef4444;font-size:13px;margin-bottom:12px;display:none;background:rgba(239,68,68,0.08);padding:8px 12px;border-radius:8px}
</style></head><body>
<div class="login-wrapper">
<div class="brand">
<div class="brand-logo">V</div>
<h1>VRTSync</h1>
<p>Admin Hub</p>
</div>
<div class="login-box">
<h2>Welcome back</h2>
<p class="subtitle">Sign in to manage your field operations</p>
<div class="error" id="login-error"></div>
<div class="form-group"><label>Username</label><input type="text" id="username" autofocus placeholder="Enter your username" /></div>
<div class="form-group"><label>Password</label><input type="password" id="password" placeholder="Enter your password" /></div>
<button class="btn" id="login-btn">Sign In</button>
</div>
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

function configurePortalHub(app: express.Application) {
  app.use("/portal-static", express.static(path.resolve(process.cwd(), "server", "public", "portal")));

  const contractorShell = fs.readFileSync(path.resolve(process.cwd(), "server", "templates", "contractor-shell.html"), "utf-8");
  const hoaShell        = fs.readFileSync(path.resolve(process.cwd(), "server", "templates", "hoa-shell.html"), "utf-8");
  const pmShell         = fs.readFileSync(path.resolve(process.cwd(), "server", "templates", "pm-shell.html"), "utf-8");

  /* ── Unified login (all non-admin roles) ─────────────────────────────── */
  const loginHtml = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>VRTSync — Sign In</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Inter',-apple-system,BlinkMacSystemFont,sans-serif;background:linear-gradient(160deg,#06101c 0%,#0C1D31 40%,#132a45 100%);display:flex;align-items:center;justify-content:center;min-height:100vh;color:#fff;-webkit-font-smoothing:antialiased}
body::before{content:'';position:fixed;inset:0;background:radial-gradient(ellipse at 30% 20%,rgba(37,193,172,0.08) 0%,transparent 60%),radial-gradient(ellipse at 70% 80%,rgba(37,193,172,0.05) 0%,transparent 50%);pointer-events:none}
.wrap{position:relative;z-index:1;width:100%;max-width:420px;padding:20px}
.brand{text-align:center;margin-bottom:32px}
.brand-logo{display:inline-flex;align-items:center;justify-content:center;width:56px;height:56px;background:linear-gradient(135deg,#25C1AC,#1da393);border-radius:16px;font-size:26px;font-weight:800;color:#fff;margin-bottom:16px;box-shadow:0 4px 20px rgba(37,193,172,0.4);letter-spacing:-1px}
.brand h1{font-size:28px;font-weight:700;letter-spacing:0.5px;margin-bottom:4px}
.brand p{font-size:12px;color:rgba(37,193,172,0.6);text-transform:uppercase;letter-spacing:2px;font-weight:600}
.box{background:rgba(255,255,255,0.97);border-radius:20px;padding:36px;color:#1f2937;box-shadow:0 20px 60px rgba(0,0,0,0.3),0 0 0 1px rgba(255,255,255,0.05)}
.box h2{font-size:18px;margin-bottom:4px;color:#0C1D31;font-weight:700}
.sub{font-size:14px;color:#6b7280;margin-bottom:24px}
.fg{margin-bottom:16px}
.fg label{display:block;font-size:13px;font-weight:600;margin-bottom:5px;color:#374151}
.fg input{width:100%;padding:12px 16px;border:1px solid #e5e7eb;border-radius:10px;font-size:14px;font-family:inherit;background:#f9fafb;transition:all .2s;color:#1f2937}
.fg input:focus{outline:none;border-color:#25C1AC;box-shadow:0 0 0 3px rgba(37,193,172,0.15);background:#fff}
.btn{width:100%;padding:12px;background:linear-gradient(135deg,#25C1AC,#1da393);color:#fff;border:none;border-radius:10px;font-size:15px;font-weight:600;cursor:pointer;font-family:inherit;transition:all .2s;box-shadow:0 2px 8px rgba(37,193,172,0.3);margin-top:8px}
.btn:hover{background:linear-gradient(135deg,#1da393,#189985);box-shadow:0 4px 16px rgba(37,193,172,0.4);transform:translateY(-1px)}
.btn:disabled{opacity:.6;cursor:not-allowed;transform:none}
.err{color:#ef4444;font-size:13px;margin-bottom:12px;display:none;background:rgba(239,68,68,0.08);padding:8px 12px;border-radius:8px;border:1px solid rgba(239,68,68,0.2)}
.admin-link{text-align:center;margin-top:18px;font-size:12px;color:rgba(255,255,255,0.4)}
.admin-link a{color:rgba(37,193,172,0.7);text-decoration:none}
.admin-link a:hover{color:#25C1AC}
</style></head><body>
<div class="wrap">
  <div class="brand">
    <div class="brand-logo">V</div>
    <h1>VRTSync</h1>
    <p>Field Operations Platform</p>
  </div>
  <div class="box">
    <h2>Welcome back</h2>
    <p class="sub">Sign in to your VRTSync portal</p>
    <div class="err" id="err"></div>
    <div class="fg"><label>Username</label><input type="text" id="u" autofocus placeholder="Enter your username" /></div>
    <div class="fg"><label>Password</label><input type="password" id="p" placeholder="Enter your password" /></div>
    <button class="btn" id="btn">Sign In</button>
  </div>
  <p class="admin-link">Super Admin? <a href="/web/admin/login">Admin Hub →</a></p>
</div>
<script>
const roleMap={admin:'/web/admin/dashboard',property_manager:'/web/pm/dashboard',contractor:'/web/contractor/dashboard',hoa_admin:'/web/hoa/dashboard',hoa_member:'/web/hoa/dashboard'};
document.getElementById('btn').addEventListener('click',doLogin);
document.getElementById('p').addEventListener('keydown',e=>{if(e.key==='Enter')doLogin()});
async function doLogin(){
  const u=document.getElementById('u').value.trim();
  const p=document.getElementById('p').value;
  const err=document.getElementById('err');
  const btn=document.getElementById('btn');
  err.style.display='none';
  if(!u||!p){err.textContent='Please enter your username and password';err.style.display='block';return}
  btn.disabled=true;btn.textContent='Signing in…';
  try{
    const r=await fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify({username:u,password:p})});
    if(!r.ok){const d=await r.json().catch(()=>({}));err.textContent=d.message||'Login failed. Check your credentials.';err.style.display='block';btn.disabled=false;btn.textContent='Sign In';return}
    const me=await fetch('/api/auth/me',{credentials:'same-origin'}).then(r=>r.json());
    const dest=roleMap[me.user?.role];
    if(!dest){err.textContent='Your account does not have portal access. Contact your administrator.';err.style.display='block';await fetch('/api/auth/logout',{method:'POST',credentials:'same-origin'});btn.disabled=false;btn.textContent='Sign In';return}
    window.location.href=dest;
  }catch(e){err.textContent='Network error. Please try again.';err.style.display='block';btn.disabled=false;btn.textContent='Sign In'}
}
</script></body></html>`;

  app.get("/web/login", (_req: Request, res: Response) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(loginHtml);
  });

  /* ── Catch-all redirects for bare /web/* paths ───────────────────────── */
  app.get("/web", (_req: Request, res: Response) => res.redirect("/web/login"));
  app.get("/web/contractor", (_req: Request, res: Response) => res.redirect("/web/contractor/dashboard"));
  app.get("/web/hoa",        (_req: Request, res: Response) => res.redirect("/web/hoa/dashboard"));
  app.get("/web/pm",         (_req: Request, res: Response) => res.redirect("/web/pm/dashboard"));

  /* ── Portal shell routes ─────────────────────────────────────────────── */
  app.get(/^\/web\/contractor\/.*$/, (_req: Request, res: Response) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(contractorShell);
  });

  app.get(/^\/web\/hoa\/.*$/, (_req: Request, res: Response) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(hoaShell);
  });

  app.get(/^\/web\/pm\/.*$/, (_req: Request, res: Response) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(pmShell);
  });

  log("Portal hub configured at /web/contractor, /web/hoa, /web/pm");
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
  configurePortalHub(app);

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
