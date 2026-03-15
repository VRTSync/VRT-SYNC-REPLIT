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
    res.redirect("/web/login");
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
<link rel="icon" href="https://vrtsync.com/favicon.png" type="image/png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Outfit:wght@600;700&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%}
body{font-family:'Inter',sans-serif;background:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;color:#0C1D31;-webkit-font-smoothing:antialiased;overflow:hidden;position:relative}
.topo{position:fixed;pointer-events:none;z-index:0;width:520px;height:520px;background-image:url('/portal-static/topography.png');background-size:cover;background-repeat:no-repeat;opacity:0.12;filter:invert(1) sepia(1) saturate(3) hue-rotate(130deg) brightness(1.1)}
.topo--left{bottom:-80px;left:-80px;transform:rotate(15deg)}
.topo--right{top:-80px;right:-80px;transform:rotate(-20deg)}
.page{position:relative;z-index:1;display:flex;flex-direction:column;align-items:center;justify-content:center;flex:1;width:100%;padding:40px 20px 20px}
.brand{text-align:center;margin-bottom:40px}
.brand img{height:48px;margin-bottom:0}
.card{background:rgba(230,248,245,0.55);border-radius:16px;padding:40px 44px;width:100%;max-width:440px;box-shadow:0 1px 3px rgba(0,0,0,0.04)}
.card h2{font-family:'Outfit',sans-serif;font-size:28px;font-weight:700;color:#0C1D31;margin-bottom:6px;text-align:center}
.tagline{text-align:center;font-size:13px;font-weight:600;letter-spacing:3px;color:#25C1AC;text-transform:uppercase;margin-bottom:28px}
.fg{margin-bottom:18px}
.fg label{display:block;font-size:13px;font-weight:600;margin-bottom:6px;color:#374151}
.input-wrap{position:relative}
.input-wrap .icon{position:absolute;left:14px;top:50%;transform:translateY(-50%);color:#9ca3af;pointer-events:none;display:flex;align-items:center}
.input-wrap .icon svg{width:18px;height:18px}
.input-wrap input{width:100%;padding:13px 14px 13px 42px;border:1px solid #d1d5db;border-radius:10px;font-size:14px;font-family:'Inter',sans-serif;background:#fff;transition:border-color .2s,box-shadow .2s;color:#1f2937}
.input-wrap input:focus{outline:none;border-color:#25C1AC;box-shadow:0 0 0 3px rgba(37,193,172,0.12)}
.input-wrap input::placeholder{color:#9ca3af}
.toggle-pw{position:absolute;right:14px;top:50%;transform:translateY(-50%);background:none;border:none;cursor:pointer;color:#9ca3af;display:flex;align-items:center;padding:0}
.toggle-pw:hover{color:#6b7280}
.toggle-pw svg{width:20px;height:20px}
.btn{width:100%;padding:13px;background:#25C1AC;color:#fff;border:none;border-radius:9999px;font-size:15px;font-weight:600;cursor:pointer;font-family:'Inter',sans-serif;transition:background .2s,box-shadow .2s,transform .15s;box-shadow:0 4px 14px rgba(37,193,172,0.25);margin-top:6px}
.btn:hover{background:#1fb89e;box-shadow:0 6px 20px rgba(37,193,172,0.35);transform:translateY(-1px)}
.btn:active{transform:translateY(0)}
.btn:disabled{opacity:.55;cursor:not-allowed;transform:none}
.err{color:#dc2626;font-size:13px;margin-bottom:14px;display:none;background:rgba(220,38,38,0.06);padding:10px 14px;border-radius:10px;border:1px solid rgba(220,38,38,0.15);line-height:1.4}
.forgot{text-align:center;margin-top:18px;font-size:14px;color:#6b7280}
.forgot a{color:#0C1D31;text-decoration:none;font-weight:500}
.forgot a:hover{text-decoration:underline}
footer{position:relative;z-index:1;padding:20px;text-align:center;font-size:12px;color:#9ca3af}
@media(max-width:520px){
  .card{padding:32px 24px;margin:0 8px}
  .topo{width:300px;height:300px;opacity:0.08}
}
</style></head><body>
<div class="topo topo--left"></div>
<div class="topo topo--right"></div>
<div class="page">
  <div class="brand">
    <img src="https://vrtsync.com/assets/FINAL-02_1768843649073-eIfol9Dz.png" alt="VRTSync" />
  </div>
  <div class="card">
    <h2>Log In</h2>
    <p class="tagline">DATA. MAPPED. SYNCED.</p>
    <div class="err" id="err"></div>
    <div class="fg">
      <label>Email</label>
      <div class="input-wrap">
        <span class="icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="3"/><path d="M22 7l-10 6L2 7"/></svg></span>
        <input type="text" id="u" autofocus placeholder="Email" />
      </div>
    </div>
    <div class="fg">
      <label>Password</label>
      <div class="input-wrap">
        <span class="icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg></span>
        <input type="password" id="p" placeholder="Password" />
        <button type="button" class="toggle-pw" id="togglePw" tabindex="-1" aria-label="Toggle password visibility">
          <svg id="eyeOpen" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
          <svg id="eyeClosed" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="display:none"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/></svg>
        </button>
      </div>
    </div>
    <button class="btn" id="btn">Log in</button>
    <p class="forgot"><a href="#">Forgot your password?</a></p>
  </div>
</div>
<footer>&copy; 2026 VRTSync</footer>
<script>
const roleMap={admin:'/web/admin/dashboard',property_manager:'/web/pm/dashboard',contractor:'/web/contractor/dashboard',hoa_admin:'/web/hoa/dashboard',hoa_member:'/web/hoa/dashboard'};
document.getElementById('btn').addEventListener('click',doLogin);
document.getElementById('u').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();document.getElementById('p').focus()}});
document.getElementById('p').addEventListener('keydown',e=>{if(e.key==='Enter')doLogin()});
document.getElementById('togglePw').addEventListener('click',function(){
  const p=document.getElementById('p');
  const isHidden=p.type==='password';
  p.type=isHidden?'text':'password';
  document.getElementById('eyeOpen').style.display=isHidden?'none':'block';
  document.getElementById('eyeClosed').style.display=isHidden?'block':'none';
});
async function doLogin(){
  const u=document.getElementById('u').value.trim();
  const p=document.getElementById('p').value;
  const err=document.getElementById('err');
  const btn=document.getElementById('btn');
  err.style.display='none';
  if(!u||!p){err.textContent='Please enter your email and password.';err.style.display='block';return}
  btn.disabled=true;btn.textContent='Signing in\\u2026';
  try{
    const r=await fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify({username:u,password:p})});
    if(!r.ok){const d=await r.json().catch(()=>({}));err.textContent=d.message||'Login failed. Check your credentials.';err.style.display='block';btn.disabled=false;btn.textContent='Log in';return}
    const me=await fetch('/api/auth/me',{credentials:'same-origin'}).then(r=>r.json());
    const dest=roleMap[me.user?.role];
    if(!dest){err.textContent='Your account does not have portal access. Contact your administrator.';err.style.display='block';await fetch('/api/auth/logout',{method:'POST',credentials:'same-origin'});btn.disabled=false;btn.textContent='Log in';return}
    window.location.href=dest;
  }catch(e){err.textContent='Network error. Please try again.';err.style.display='block';btn.disabled=false;btn.textContent='Log in'}
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
