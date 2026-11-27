import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { api, errorMessage } from "../api";
import { useCommunity } from "../community";
import { taskHref } from "../dest";
import { isStaff, webBase } from "../session";
import { Menu } from "./Menu";
import { Icon } from "./icons";

interface Notification {
  id: string;
  communityId: string | null;
  type: string;
  title: string;
  body: string;
  relatedTaskId: string | null;
  createdAt: string;
  readAt: string | null;
}

function timeAgo(iso: string): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60); if (m < 60) return m + "m ago";
  const h = Math.round(m / 60); if (h < 24) return h + "h ago";
  const d = Math.round(h / 24); if (d < 7) return d + "d ago";
  return new Date(t).toLocaleDateString();
}

export function Notifications({ role }: { role: string }) {
  const qc = useQueryClient();
  const c = useCommunity();
  const [, setLocation] = useLocation();
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const unread = useQuery({
    queryKey: ["notifications", "unread"],
    queryFn: ({ signal }) => api<{ count: number }>("/api/notifications/unread-count", { signal }),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
  useEffect(() => {
    const refresh = () => { void qc.invalidateQueries({ queryKey: ["notifications", "unread"] }); };
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [qc]);
  const list = useQuery({
    queryKey: ["notifications", "list"],
    queryFn: ({ signal }) => api<Notification[]>("/api/notifications?limit=20", { signal }),
    enabled: open,
    staleTime: 0,
  });
  const markAll = useMutation({
    mutationFn: () => api<unknown>("/api/notifications/read-all", { method: "PUT" }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["notifications"] }); },
  });

  const count = unread.data?.count ?? 0;
  const items = Array.isArray(list.data) ? list.data : [];

  const openItem = async (n: Notification, close: (f?: boolean) => void) => {
    setErr(null);
    setBusyId(n.id);
    try {
      if (!n.readAt) {
        await api<unknown>("/api/notifications/" + encodeURIComponent(n.id) + "/read", { method: "PUT" });
        void qc.invalidateQueries({ queryKey: ["notifications"] });
      }
      const type = (n.type || "").toLowerCase();
      let href: string | null = null;
      if (n.relatedTaskId) {
        const task = await api<{ id: string; communityId: string | null }>("/api/tasks/" + encodeURIComponent(n.relatedTaskId));
        if (!c.persistFor(task.communityId)) throw new Error("That task belongs to a community you can't open from here.");
        href = taskHref(role, task.id, task.communityId);
        if (!href) throw new Error("That task has no community, so it can't be opened.");
      } else if (type.includes("invoice")) {
        if (n.communityId && !c.persistFor(n.communityId)) throw new Error("That invoice belongs to a community you can't open from here.");
        href = webBase(role) + "/invoices";
      } else if (type.includes("document")) {
        if (isStaff(role)) throw new Error("Documents are not available in the staff portal.");
        if (n.communityId && !c.persistFor(n.communityId)) throw new Error("That document belongs to a community you can't open from here.");
        href = webBase(role) + "/documents";
      }
      if (href) { window.location.assign(href); return; }
      close(false);
      setLocation("/");
    } catch (e) {
      setErr(errorMessage(e, "Couldn't open that notification."));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Menu
      kind="dialog"
      buttonId="notif-btn"
      buttonClassName={"topbar-icon-btn" + (count > 0 ? " has-unread" : "")}
      buttonLabel={count > 0 ? "Notifications, " + count + " unread" : "Notifications"}
      buttonTestId="button-notifications"
      panelLabel="Notifications"
      panelClassName="tb-notif-panel"
      onOpenChange={(o) => { setOpen(o); setErr(null); }}
      buttonContent={
        <>
          <Icon name="bell" />
          <span className={"notif-dot" + (count > 0 ? " visible" : "")} data-testid="badge-unread-count">{count > 0 ? (count > 99 ? "99+" : count) : ""}</span>
        </>
      }
    >
      {({ close }) => (
        <>
          <div className="tb-notif-header">
            <span className="tb-notif-title">Notifications</span>
            {count > 0 && <span className="tb-notif-count">{count} unread</span>}
            <span style={{ flex: 1 }} />
            <button
              type="button"
              className="btn btn-ghost btn-xs tb-notif-mark-all"
              disabled={markAll.isPending || count === 0}
              onClick={() => markAll.mutate()}
              data-testid="button-mark-all-read"
            >
              {markAll.isPending ? "Marking" : "Mark all as read"}
            </button>
          </div>
          {unread.error && <div className="vrt-inline-error" role="alert">Unable to refresh unread notifications.</div>}
          {(err || markAll.error) && <div className="vrt-inline-error" role="alert">{err ?? errorMessage(markAll.error)}</div>}
          <div className="tb-notif-body">
            {list.isLoading ? (
              <div className="vrt-menu-msg">{[0, 1, 2].map((i) => <span key={i} className="vrt-skel" style={{ width: 90 - i * 15 + "%" }} />)}</div>
            ) : list.error ? (
              <div className="vrt-menu-msg" role="alert">
                <span>{errorMessage(list.error, "Couldn't load notifications.")}</span>
                <button type="button" className="btn btn-sm btn-secondary" onClick={() => void list.refetch()} data-testid="button-retry-notifications">Try again</button>
              </div>
            ) : items.length === 0 ? (
              <div className="tb-notif-empty">You're all caught up. New task updates and requests will show here.</div>
            ) : (
              <ul className="vrt-plain-list">
                {items.map((n) => (
                  <li key={n.id}>
                    <button
                      type="button"
                      className={"tb-notif-item vrt-notif-btn" + (n.readAt ? "" : " tb-notif-unread")}
                      onClick={() => void openItem(n, close)}
                      disabled={busyId !== null}
                      aria-busy={busyId === n.id}
                      data-testid={"button-notification-" + n.id}
                    >
                      <span className="tb-notif-item-icon"><Icon name={n.relatedTaskId ? "check" : (n.type || "").includes("invoice") ? "dollar" : (n.type || "").includes("document") ? "file" : "bell"} size={16} /></span>
                      <span className="tb-notif-item-body">
                        <span className="tb-notif-item-title">{n.title}</span>
                        <span className="tb-notif-item-text">{n.body}</span>
                        <span className="tb-notif-item-time">{busyId === n.id ? "Opening" : timeAgo(n.createdAt)}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </Menu>
  );
}
