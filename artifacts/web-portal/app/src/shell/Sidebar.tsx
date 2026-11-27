import { forwardRef, type KeyboardEvent } from "react";
import { Link, useLocation } from "wouter";
import { roleLabel } from "@workspace/roles";
import { navFor } from "../nav";
import { Icon } from "./icons";
import type { Me } from "../session";

interface SidebarProps {
  me: Me | null;
  drawerOpen: boolean;
  narrow: boolean;
  onClose: () => void;
  onKeyDown?: (e: KeyboardEvent<HTMLElement>) => void;
}

export const Sidebar = forwardRef<HTMLElement, SidebarProps>(function Sidebar({ me, drawerOpen, narrow, onClose, onKeyDown }, ref) {
  const [location] = useLocation();
  const groups = me ? navFor(me.user.role) : [];
  const asDialog = narrow && drawerOpen;
  return (
    <nav
      id="sidebar"
      ref={ref}
      className={drawerOpen ? "is-open" : ""}
      aria-label="Main navigation"
      role={asDialog ? "dialog" : undefined}
      aria-modal={asDialog ? true : undefined}
      onKeyDown={onKeyDown}
      data-testid="sidebar"
    >
      <div className="sidebar-brand">
        <div className="vrt-brand-tile" aria-hidden="true">
          <img src="/portal-static/brand/mark.svg" width={24} height={29} alt="" />
        </div>
        <div className="vrt-brand-copy">
          <div className="brand-text">VRTSync</div>
          <div className="brand-sub" data-testid="text-sidebar-role">{me ? roleLabel(me.user.role) : "\u00a0"}</div>
        </div>
        {narrow && (
          <button type="button" className="vrt-drawer-close" aria-label="Close navigation" onClick={onClose} data-testid="button-close-drawer">
            <Icon name="close" />
          </button>
        )}
      </div>
      <div className="nav-links vrt-nav-scroll">
        {groups.map((g, gi) => (
          <div className="vrt-nav-group" key={g.heading ?? gi} role="group" aria-labelledby={g.heading ? "navgrp-" + gi : undefined}>
            {g.heading && <div className="vrt-nav-heading" id={"navgrp-" + gi}>{g.heading}</div>}
            {g.items.map((item) => {
              const testId = "link-nav-" + item.label.toLowerCase().replace(/[^a-z0-9]+/g, "-");
              if (item.app) {
                const active = location === item.href;
                return (
                  <Link key={item.label} href={item.href} className={"nav-link" + (active ? " active" : "")} aria-current={active ? "page" : undefined} onClick={onClose} data-testid={testId}>
                    <Icon name={item.icon} />
                    <span>{item.label}</span>
                  </Link>
                );
              }
              return (
                <a key={item.label} href={item.href} className="nav-link" onClick={onClose} data-testid={testId}>
                  <Icon name={item.icon} />
                  <span>{item.label}</span>
                </a>
              );
            })}
          </div>
        ))}
      </div>
    </nav>
  );
});
