import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useMe, type Me } from "../session";
import { CommunityProvider } from "../community";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";

const NARROW_Q = "(max-width: 899.98px)";

function useNarrow(): boolean {
  const get = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(NARROW_Q).matches;
  const [narrow, setNarrow] = useState(get);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(NARROW_Q);
    const on = () => setNarrow(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return narrow;
}

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),[tabindex]:not([tabindex="-1"])';

function Frame({ me, children }: { me: Me | null; children: ReactNode }) {
  const narrow = useNarrow();
  const [drawer, setDrawer] = useState(false);
  const sideRef = useRef<HTMLElement>(null);
  const menuBtnRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);

  useEffect(() => { if (!narrow) setDrawer(false); }, [narrow]);

  useEffect(() => {
    if (drawer) {
      wasOpen.current = true;
      const raf = requestAnimationFrame(() => {
        const first = sideRef.current?.querySelector<HTMLElement>(FOCUSABLE);
        first?.focus();
      });
      const onEsc = (e: globalThis.KeyboardEvent) => { if (e.key === "Escape") setDrawer(false); };
      document.addEventListener("keydown", onEsc);
      return () => { cancelAnimationFrame(raf); document.removeEventListener("keydown", onEsc); };
    }
    if (wasOpen.current) {
      wasOpen.current = false;
      menuBtnRef.current?.focus();
    }
  }, [drawer]);

  const closeDrawer = useCallback(() => setDrawer(false), []);

  const trap = (e: KeyboardEvent<HTMLElement>) => {
    if (!drawer || e.key !== "Tab") return;
    const els = Array.from(sideRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
    if (!els.length) return;
    const first = els[0];
    const last = els[els.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };

  const modal = narrow && drawer;

  return (
    <div id="app" className={"vrt-app" + (modal ? " vrt-drawer-open" : "")}>
      <Sidebar ref={sideRef} me={me} drawerOpen={drawer} narrow={narrow} onClose={closeDrawer} onKeyDown={trap} />
      {narrow && <div className={"vrt-overlay" + (drawer ? " is-visible" : "")} aria-hidden="true" onClick={closeDrawer} data-testid="overlay-drawer" />}
      <div id="main-content" inert={modal ? true : undefined}>
        <TopBar ref={menuBtnRef} me={me} narrow={narrow} drawerOpen={drawer} onMenu={() => setDrawer(true)} />
        <main id="page-content" tabIndex={-1}>{children}</main>
      </div>
    </div>
  );
}

export default function Shell({ children }: { children: ReactNode }) {
  const me = useMe();
  if (me.isLoading || (me.error && (me.error as { status?: number }).status === 401)) {
    return <Frame me={null}><div aria-busy="true" aria-label="Loading VRTSync" /></Frame>;
  }
  if (me.error || !me.data) {
    return (
      <Frame me={null}>
        <div className="vrt-state-card" role="alert" data-testid="status-load-error">
          <h1 className="vrt-state-title">Something went wrong loading VRTSync. Reload the page.</h1>
          <button type="button" className="btn btn-primary" onClick={() => window.location.reload()} data-testid="button-reload">Reload</button>
        </div>
      </Frame>
    );
  }
  return (
    <CommunityProvider me={me.data}>
      <Frame me={me.data}>{children}</Frame>
    </CommunityProvider>
  );
}
