import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { api, errorMessage } from "../api";
import { useCommunity } from "../community";
import { assetHref, taskHref } from "../dest";
import { Icon } from "./icons";

interface SearchResult { id: string; type: "asset" | "task"; label: string; status?: string | null; communityId?: string | null }
interface SearchState { key: string; status: "idle" | "loading" | "done" | "error"; items: SearchResult[]; error?: string }

export function Search({ role }: { role: string }) {
  const c = useCommunity();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const [navError, setNavError] = useState<string | null>(null);
  const [state, setState] = useState<SearchState>({ key: "", status: "idle", items: [] });
  const wrapRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const trimmed = q.trim();
  const cid = c.activeId;
  const key = c.ready && trimmed.length >= 2 ? trimmed + "\u0000" + (cid ?? "") : "";

  useEffect(() => {
    setHi(0);
    setNavError(null);
    if (!key) { setState({ key: "", status: "idle", items: [] }); return; }
    setState({ key, status: "loading", items: [] });
    const ctrl = new AbortController();
    const params = new URLSearchParams({ q: trimmed });
    if (cid) params.set("communityId", cid);
    const t = window.setTimeout(() => {
      api<SearchResult[]>("/api/search?" + params.toString(), { signal: ctrl.signal })
        .then((r) => { if (!ctrl.signal.aborted) setState({ key, status: "done", items: (Array.isArray(r) ? r : []).slice(0, 8) }); })
        .catch((e) => { if (!ctrl.signal.aborted) setState({ key, status: "error", items: [], error: errorMessage(e, "Search failed.") }); });
    }, 250);
    return () => { window.clearTimeout(t); ctrl.abort(); };
  }, [key, trimmed, cid]);

  const fresh = state.key === key && state.status === "done";
  const items = fresh ? state.items : [];

  const go = (r: SearchResult) => {
    const rc = r.communityId ?? null;
    if (!c.persistFor(rc)) {
      setNavError("That result belongs to a community you can't open from here.");
      return;
    }
    const href = r.type === "task" ? taskHref(role, r.id, rc) : assetHref(role, rc);
    if (!href) { setNavError("That result has no community, so it can't be opened."); return; }
    window.location.assign(href);
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") { if (open) { e.preventDefault(); setOpen(false); } return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); if (items.length) setHi((h) => (h + 1) % items.length); return; }
    if (e.key === "ArrowUp") { e.preventDefault(); if (items.length) setHi((h) => (h <= 0 ? items.length - 1 : h - 1)); return; }
    if (e.key === "Enter") {
      e.preventDefault();
      if (open && fresh && items[hi]) go(items[hi]); // never open a stale result
    }
  };

  const showPanel = open && !!key;
  const activeOpt = showPanel && items[hi] ? listId + "-opt-" + hi : undefined;

  return (
    <div
      className="vrt-search"
      ref={wrapRef}
      onBlur={(e) => { if (!wrapRef.current?.contains(e.relatedTarget as Node)) setOpen(false); }}
    >
      <Icon name="search" size={16} className="vrt-search-icon" />
      <input
        type="search"
        role="combobox"
        aria-label="Search tasks and assets"
        aria-expanded={showPanel}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={activeOpt}
        placeholder="Search"
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKey}
        data-testid="input-search"
      />
      {showPanel && (
        <div className="vrt-search-panel tb-dropdown" data-testid="panel-search-results">
          {navError && <div className="vrt-inline-error" role="alert">{navError}</div>}
          <ul id={listId} role="listbox" aria-label="Search results" className="vrt-search-list">
            {items.map((r, i) => (
              <li
                key={r.type + r.id}
                id={listId + "-opt-" + i}
                role="option"
                aria-selected={i === hi}
                className={"vrt-search-opt" + (i === hi ? " is-hi" : "")}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setHi(i)}
                onClick={() => go(r)}
                data-testid={"option-search-" + r.type + "-" + r.id}
              >
                <span className="vrt-search-label">{r.label}</span>
                <span className={"vrt-type-tag vrt-type-tag--" + r.type}>{r.type === "task" ? "Task" : "Asset"}</span>
              </li>
            ))}
          </ul>
          {state.key === key && state.status === "loading" && (
            <div className="vrt-search-msg" aria-live="polite"><span className="vrt-skel" style={{ width: "80%" }} /><span className="vrt-skel" style={{ width: "60%" }} /></div>
          )}
          {state.key === key && state.status === "error" && <div className="vrt-inline-error" role="alert">{state.error}</div>}
          {fresh && items.length === 0 && <div className="vrt-search-msg" aria-live="polite">No results</div>}
        </div>
      )}
    </div>
  );
}
