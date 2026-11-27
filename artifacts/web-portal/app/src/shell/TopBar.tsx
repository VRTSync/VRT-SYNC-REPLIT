import { forwardRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { roleLabel } from "@workspace/roles";
import { api, errorMessage } from "../api";
import { useCommunity } from "../community";
import { plusActionsFor } from "../nav";
import { initials, isHoa, isStaff, webBase, type Me } from "../session";
import { CommunitySwitcher } from "./CommunitySwitcher";
import { Menu } from "./Menu";
import { Notifications } from "./Notifications";
import { Search } from "./Search";
import { Icon } from "./icons";

function HoaLabel() {
  const c = useCommunity();
  return (
    <div className="topbar-community-label vrt-fixed-community" data-testid="text-active-community">
      <Icon name="home" size={16} />
      <span>{c.fixedLabel ?? "Your community"}</span>
    </div>
  );
}

function ProfileMenu({ me }: { me: Me }) {
  const qc = useQueryClient();
  const name = me.user.displayName || me.user.username || "User";
  const label = roleLabel(me.user.role);
  const logout = useMutation({
    mutationFn: () => api<unknown>("/api/auth/logout", { method: "POST" }),
    onSuccess: () => { qc.clear(); window.location.assign("/web/login"); },
  });
  return (
    <Menu
      wrapperClassName="vrt-profile"
      buttonClassName="user-profile-chip"
      buttonLabel={"Account menu for " + name + ", " + label}
      buttonTestId="button-profile"
      panelLabel="Account"
      panelStyle={{ width: 260 }}
      onOpenChange={() => logout.reset()}
      buttonContent={
        <>
          <span className="user-avatar" aria-hidden="true">{initials(name)}</span>
          <span className="vrt-chip-text">
            <span className="user-name" data-testid="text-user-name">{name}</span>
            <span className="user-role-tag" data-testid="text-user-role">{label}</span>
          </span>
          <Icon name="caret" size={14} className="vrt-caret vrt-chip-caret" />
        </>
      }
    >
      {() => (
        <>
          <div className="vrt-profile-head">
            <div className="vrt-profile-name">{name}</div>
            <div className="vrt-profile-role">{label}</div>
            {me.user.companyName && <div className="vrt-profile-company" data-testid="text-company-name">{me.user.companyName}</div>}
          </div>
          <div className="tb-menu-divider" />
          <a role="menuitem" className="tb-menu-item" href={webBase(me.user.role) + "/account"} data-testid="link-account-settings">
            <Icon name="settings" size={16} />
            <span className="tb-menu-item-label">Account settings</span>
          </a>
          <button
            type="button"
            role="menuitem"
            className="tb-menu-item tb-menu-item--danger vrt-menu-btn"
            disabled={logout.isPending}
            onClick={() => logout.mutate()}
            data-testid="button-logout"
          >
            <Icon name="logout" size={16} />
            <span className="tb-menu-item-label">{logout.isPending ? "Logging out" : "Log out"}</span>
          </button>
          {logout.error && <div className="vrt-inline-error" role="alert">{errorMessage(logout.error, "Couldn't log out. Try again.")}</div>}
        </>
      )}
    </Menu>
  );
}

interface TopBarProps { me: Me | null; narrow: boolean; drawerOpen: boolean; onMenu: () => void }

export const TopBar = forwardRef<HTMLButtonElement, TopBarProps>(function TopBar({ me, narrow, drawerOpen, onMenu }, menuRef) {
  const role = me?.user.role ?? "";
  const plus = me ? plusActionsFor(role) : [];
  return (
    <header id="topbar" data-testid="topbar">
      <div className="topbar-left vrt-topbar-left">
        {narrow && me && (
          <button
            ref={menuRef}
            type="button"
            className="topbar-icon-btn vrt-menu-toggle"
            aria-label="Open navigation"
            aria-controls="sidebar"
            aria-expanded={drawerOpen}
            onClick={onMenu}
            data-testid="button-open-drawer"
          >
            <Icon name="menu" />
          </button>
        )}
        {me && (isHoa(role) ? <HoaLabel /> : <CommunitySwitcher staff={isStaff(role)} />)}
        {me && <Search role={role} />}
      </div>
      {me && (
        <div className="topbar-right">
          {plus.length > 0 && (
            <Menu
              buttonClassName="topbar-icon-btn btn-primary-icon"
              buttonLabel="Create"
              buttonTestId="button-plus"
              panelLabel="Create"
              buttonContent={<Icon name="plus" />}
            >
              {() => (
                <>
                  <div className="tb-menu-header">Create</div>
                  {plus.map((a) => (
                    <a key={a.href} role="menuitem" className="tb-menu-item" href={a.href} data-testid={"link-plus-" + a.label.toLowerCase().replace(/\s+/g, "-")}>
                      <Icon name={a.icon} size={16} />
                      <span className="tb-menu-item-label">{a.label}</span>
                    </a>
                  ))}
                </>
              )}
            </Menu>
          )}
          <Notifications role={role} />
          <div className="topbar-divider" aria-hidden="true" />
          <ProfileMenu me={me} />
        </div>
      )}
    </header>
  );
});
