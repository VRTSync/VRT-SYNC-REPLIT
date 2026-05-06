// @ts-nocheck
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import pinoHttp from "pino-http";
import path from "path";
import fs from "fs";
import { setupSession } from "./auth";
import { logger } from "./lib/logger";
import { LEAFLET_MAP_HTML } from "./shared/leaflet-map-template";
import healthRouter from "./routes/health";

const app: Express = express();

app.set("trust proxy", 1);

const STATIC_VERSION = Date.now().toString(36);

function stampHtml(html: string): string {
  return html.replace(
    /(\/(?:admin|portal)-static\/[^"'?]+\.(?:css|js))/g,
    `$1?v=${STATIC_VERSION}`
  );
}

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

const PUBLIC_ROOT = path.resolve(process.cwd(), "public");
const TEMPLATES_ROOT = path.resolve(process.cwd(), "templates");

app.use("/admin-static", express.static(path.join(PUBLIC_ROOT, "admin")));

const adminShell = stampHtml(
  fs.readFileSync(path.join(TEMPLATES_ROOT, "admin-shell.html"), "utf-8")
);

app.get("/web/admin/login", (_req: Request, res: Response) => {
  res.redirect("/web/login");
});

app.get("/web/admin", (_req: Request, res: Response) => {
  res.redirect("/web/admin/dashboard");
});

app.get(/^\/web\/admin\/(?!login).*$/, (req: Request, res: Response) => {
  if (!(req.session as any)?.userId) {
    return res.redirect("/web/login");
  }
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(adminShell);
});

app.use("/portal-static", express.static(path.join(PUBLIC_ROOT, "portal")));

const contractorShell = stampHtml(
  fs.readFileSync(path.join(TEMPLATES_ROOT, "contractor-shell.html"), "utf-8")
);
const hoaShell = stampHtml(
  fs.readFileSync(path.join(TEMPLATES_ROOT, "hoa-shell.html"), "utf-8")
);
const pmShell = stampHtml(
  fs.readFileSync(path.join(TEMPLATES_ROOT, "pm-shell.html"), "utf-8")
);

const loginHtml = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>VRTSync — Sign In</title>
<link rel="icon" href="https://vrtsync.com/favicon.png" type="image/png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Outfit:wght@600;700&display=swap" rel="stylesheet">
<style>
:root{--fl-base-color:#0a1628;--fl-overlay-opacity:0.92;--fl-topo-opacity:0.18;--fl-topo-size:480px;--fl-static-overlay-opacity:0.6;--fl-static-topo-opacity:0.1}
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%}
body{font-family:'Inter',sans-serif;background:var(--fl-base-color);display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;color:#e2e8f0;-webkit-font-smoothing:antialiased;overflow:hidden;position:relative}
.bg-base{position:fixed;inset:0;z-index:0;background:var(--fl-base-color)}
.bg-topo{position:fixed;inset:0;z-index:1;background-image:url('/portal-static/topography.png');background-size:var(--fl-topo-size) var(--fl-topo-size);background-repeat:repeat;opacity:var(--fl-topo-opacity);filter:invert(1) sepia(1) saturate(3) hue-rotate(130deg) brightness(1.1);pointer-events:none}
.bg-overlay{position:fixed;inset:0;z-index:2;background:rgba(10,22,40,var(--fl-overlay-opacity));pointer-events:none}
.page{position:relative;z-index:10;display:flex;flex-direction:column;align-items:center;justify-content:center;flex:1;width:100%;padding:40px 20px 20px}
.brand{text-align:center;margin-bottom:40px}
.brand img{height:48px;margin-bottom:0}
.card{background:rgba(15,25,45,0.85);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border:1px solid rgba(37,193,172,0.15);border-radius:16px;padding:40px 44px;width:100%;max-width:440px;box-shadow:0 4px 30px rgba(0,0,0,0.4),0 0 60px rgba(37,193,172,0.06)}
.card h2{font-family:'Outfit',sans-serif;font-size:28px;font-weight:700;color:#e2e8f0;margin-bottom:6px;text-align:center}
.tagline{text-align:center;font-size:13px;font-weight:600;letter-spacing:3px;color:#25C1AC;text-transform:uppercase;margin-bottom:28px}
.fg{margin-bottom:18px}
.fg label{display:block;font-size:13px;font-weight:600;margin-bottom:6px;color:#94a3b8}
.input-wrap{position:relative}
.input-wrap .icon{position:absolute;left:14px;top:50%;transform:translateY(-50%);color:#64748b;pointer-events:none;display:flex;align-items:center}
.input-wrap .icon svg{width:18px;height:18px}
.input-wrap input{width:100%;padding:13px 14px 13px 42px;border:1px solid rgba(100,116,139,0.3);border-radius:10px;font-size:14px;font-family:'Inter',sans-serif;background:rgba(15,23,42,0.6);transition:border-color .2s,box-shadow .2s;color:#e2e8f0}
.input-wrap input:focus{outline:none;border-color:#25C1AC;box-shadow:0 0 0 3px rgba(37,193,172,0.18)}
.input-wrap input::placeholder{color:#64748b}
.toggle-pw{position:absolute;right:14px;top:50%;transform:translateY(-50%);background:none;border:none;cursor:pointer;color:#64748b;display:flex;align-items:center;padding:0}
.toggle-pw:hover{color:#94a3b8}
.toggle-pw svg{width:20px;height:20px}
.btn{width:100%;padding:13px;background:#25C1AC;color:#fff;border:none;border-radius:9999px;font-size:15px;font-weight:600;cursor:pointer;font-family:'Inter',sans-serif;transition:background .2s,box-shadow .2s,transform .15s;box-shadow:0 4px 14px rgba(37,193,172,0.3);margin-top:6px}
.btn:hover{background:#1fb89e;box-shadow:0 6px 20px rgba(37,193,172,0.4);transform:translateY(-1px)}
.btn:active{transform:translateY(0)}
.btn:disabled{opacity:.55;cursor:not-allowed;transform:none}
.err{color:#fca5a5;font-size:13px;margin-bottom:14px;display:none;background:rgba(220,38,38,0.12);padding:10px 14px;border-radius:10px;border:1px solid rgba(220,38,38,0.25);line-height:1.4}
.forgot{text-align:center;margin-top:18px;font-size:14px;color:#64748b}
.forgot a{color:#94a3b8;text-decoration:none;font-weight:500}
.forgot a:hover{color:#e2e8f0;text-decoration:underline}
footer{position:relative;z-index:10;padding:20px;text-align:center;font-size:12px;color:#475569}
@media(max-width:520px){.card{padding:32px 24px;margin:0 8px}}
.static-fallback .bg-overlay{opacity:var(--fl-static-overlay-opacity)}
.static-fallback .bg-topo{opacity:var(--fl-static-topo-opacity)}
@media(prefers-reduced-motion:reduce){.bg-overlay{opacity:var(--fl-static-overlay-opacity) !important;-webkit-mask-image:none !important;mask-image:none !important}.bg-topo{opacity:var(--fl-static-topo-opacity) !important}}
</style></head><body>
<div class="bg-base"></div>
<div class="bg-topo"></div>
<div class="bg-overlay" id="bgOverlay"></div>
<div class="page">
  <div class="brand"><img src="https://vrtsync.com/assets/FINAL-02_1768843649073-eIfol9Dz.png" alt="VRTSync" /></div>
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
  btn.disabled=true;btn.textContent='Signing in\u2026';
  try{
    const r=await fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify({username:u,password:p})});
    if(!r.ok){const d=await r.json().catch(()=>({}));err.textContent=d.message||'Login failed. Check your credentials.';err.style.display='block';btn.disabled=false;btn.textContent='Log in';return}
    const me=await fetch('/api/auth/me',{credentials:'same-origin'}).then(r=>r.json());
    const dest=roleMap[me.user?.role];
    if(!dest){err.textContent='Your account does not have portal access. Contact your administrator.';err.style.display='block';await fetch('/api/auth/logout',{method:'POST',credentials:'same-origin'});btn.disabled=false;btn.textContent='Log in';return}
    window.location.href=dest;
  }catch(e){err.textContent='Network error. Please try again.';err.style.display='block';btn.disabled=false;btn.textContent='Log in'}
}
(function(){
  var REVEAL_RADIUS=220,EASING=0.08,SETTLE_THRESHOLD=0.5;
  var overlay=document.getElementById('bgOverlay');
  if(!overlay)return;
  var noHoverPointer=window.matchMedia('(hover: none)').matches;
  var prefersReduced=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var supportsMask=(typeof CSS!=='undefined'&&CSS.supports&&(CSS.supports('mask-image','radial-gradient(circle 1px at 0 0, red, blue)')||CSS.supports('-webkit-mask-image','radial-gradient(circle 1px at 0 0, red, blue)')));
  if(noHoverPointer||prefersReduced||!supportsMask){document.body.classList.add('static-fallback');return;}
  var mouseX=-9999,mouseY=-9999,curX=-9999,curY=-9999,active=false,raf=null;
  function applyMask(){var g='radial-gradient(circle '+REVEAL_RADIUS+'px at '+curX+'px '+curY+'px, transparent 0%, transparent 40%, black 100%)';overlay.style.webkitMaskImage=g;overlay.style.maskImage=g;}
  function loop(){if(!active){raf=null;return}var dx=mouseX-curX,dy=mouseY-curY;curX+=dx*EASING;curY+=dy*EASING;applyMask();if(Math.abs(dx)<SETTLE_THRESHOLD&&Math.abs(dy)<SETTLE_THRESHOLD){curX=mouseX;curY=mouseY;applyMask();raf=null;return}raf=requestAnimationFrame(loop);}
  function startLoop(){if(!raf)raf=requestAnimationFrame(loop);}
  document.addEventListener('mousemove',function(e){mouseX=e.clientX;mouseY=e.clientY;if(!active){active=true;curX=mouseX;curY=mouseY;applyMask();}startLoop();});
  function resetOverlay(){active=false;if(raf){cancelAnimationFrame(raf);raf=null}overlay.style.webkitMaskImage='none';overlay.style.maskImage='none';}
  document.addEventListener('mouseleave',resetOverlay);
  window.addEventListener('blur',resetOverlay);
})();
</script></body></html>`;

app.get("/web/login", (_req: Request, res: Response) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(loginHtml);
});

app.get("/web", (_req: Request, res: Response) => res.redirect("/web/login"));
app.get("/web/contractor", (_req: Request, res: Response) =>
  res.redirect("/web/contractor/dashboard")
);
app.get("/web/hoa", (_req: Request, res: Response) =>
  res.redirect("/web/hoa/dashboard")
);
app.get("/web/pm", (_req: Request, res: Response) =>
  res.redirect("/web/pm/dashboard")
);

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

app.get("/leaflet-map.html", (_req: Request, res: Response) => {
  res.setHeader("Cache-Control", "no-store");
  res.type("html").send(LEAFLET_MAP_HTML);
});

app.get("/pin-picker.html", (req: Request, res: Response) => {
  res.setHeader("Cache-Control", "no-store");
  const latParsed = parseFloat(req.query.lat as string);
  const lngParsed = parseFloat(req.query.lng as string);
  const zoomParsed = parseInt(req.query.zoom as string);
  const lat = Number.isFinite(latParsed) ? latParsed : 39.5;
  const lng = Number.isFinite(lngParsed) ? lngParsed : -104.9;
  const zoom = Number.isFinite(zoomParsed) ? zoomParsed : 15;
  const html = `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
<style>* { margin: 0; padding: 0; box-sizing: border-box; } html, body, #map { width: 100%; height: 100%; }</style>
</head>
<body>
<div id="map"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
(function() {
  var initLat=${lat},initLng=${lng},initZoom=${zoom};
  var map=L.map('map',{zoomControl:true,attributionControl:false}).setView([initLat,initLng],initZoom);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:20}).addTo(map);
  var pinIcon=L.divIcon({html:'<svg xmlns="http://www.w3.org/2000/svg" width="28" height="36" viewBox="0 0 28 36"><path d="M14 0C6.27 0 0 6.27 0 14c0 9.33 14 22 14 22S28 23.33 28 14C28 6.27 21.73 0 14 0z" fill="#E53935"/><circle cx="14" cy="14" r="6" fill="#fff"/></svg>',className:'',iconSize:[28,36],iconAnchor:[14,36]});
  var marker=L.marker([initLat,initLng],{icon:pinIcon,draggable:true}).addTo(map);
  function emitPin(lat,lng){if(window.parent!==window)window.parent.postMessage({type:'pin',lat:lat,lng:lng},'*');}
  marker.on('dragend',function(){var ll=marker.getLatLng();emitPin(ll.lat,ll.lng);});
  map.on('click',function(e){marker.setLatLng(e.latlng);emitPin(e.latlng.lat,e.latlng.lng);});
  window.addEventListener('message',function(e){if(!e.data)return;var msg=e.data;if(msg.type==='setPin'&&msg.lat!=null&&msg.lng!=null){marker.setLatLng([msg.lat,msg.lng]);map.setView([msg.lat,msg.lng],map.getZoom());}});
})();
</script>
</body>
</html>`;
  res.type("html").send(html);
});

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
