import { useMemo, useState } from "react";
import { Menu } from "./Menu";
import { Icon } from "./icons";
import { useCommunity } from "../community";
import { errorMessage } from "../api";

export function CommunitySwitcher({ staff }: { staff: boolean }) {
  const c = useCommunity();
  const [filter, setFilter] = useState("");
  const showSearch = c.communities.length > 6;
  const visible = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return f ? c.communities.filter((x) => x.name.toLowerCase().includes(f)) : c.communities;
  }, [c.communities, filter]);

  const name = !c.ready ? (c.error ? "Communities unavailable" : "Loading communities") : c.active ? c.active.name : staff ? "All communities" : "Select a community";

  return (
    <Menu
      align="left"
      wrapperClassName="vrt-switcher"
      buttonClassName="vrt-switcher-btn"
      buttonLabel={"Community: " + name + ". Switch community"}
      buttonTestId="button-community-switcher"
      panelLabel="Switch community"
      panelStyle={{ width: 300 }}
      onOpenChange={(o) => { if (!o) setFilter(""); }}
      buttonContent={
        <>
          <Icon name="home" size={16} />
          <span className="vrt-switcher-name" data-testid="text-active-community">{name}</span>
          {c.ready && <span className="vrt-count-pill" aria-hidden="true">{c.communities.length}</span>}
          <Icon name="caret" size={14} className="vrt-caret" />
        </>
      }
    >
      {({ close }) => (
        <>
          <div className="tb-menu-header">Switch community</div>
          {c.error && !c.ready ? (
            <div className="vrt-menu-msg" role="alert">
              <span>{errorMessage(c.error, "Couldn't load communities.")}</span>
              <button type="button" role="menuitem" className="btn btn-sm btn-secondary" onClick={() => c.retry()} data-testid="button-retry-communities">Try again</button>
            </div>
          ) : !c.ready ? (
            <div className="vrt-menu-msg"><span className="vrt-skel" style={{ width: "70%" }} /><span className="vrt-skel" style={{ width: "50%" }} /></div>
          ) : (
            <>
              {showSearch && (
                <div className="vrt-menu-search">
                  <Icon name="search" size={15} />
                  <input
                    data-autofocus
                    type="search"
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    placeholder="Find a community"
                    aria-label="Find a community"
                    data-testid="input-community-filter"
                  />
                </div>
              )}
              <div className="vrt-menu-list">
                {staff && !filter && (
                  <button
                    type="button"
                    role="menuitemradio"
                    aria-checked={c.activeId === null}
                    className={"tb-menu-item vrt-community-item" + (c.activeId === null ? " tb-menu-item--active" : "")}
                    onClick={() => { c.setActive(null); close(true); }}
                    data-testid="button-community-all"
                  >
                    <span className="tb-menu-item-label">All communities</span>
                    {c.activeId === null && <Icon name="tick" size={16} />}
                  </button>
                )}
                {visible.map((x) => {
                  const active = x.id === c.activeId;
                  return (
                    <button
                      key={x.id}
                      type="button"
                      role="menuitemradio"
                      aria-checked={active}
                      className={"tb-menu-item vrt-community-item" + (active ? " tb-menu-item--active" : "")}
                      onClick={() => { c.setActive(x.id); close(true); }}
                      data-testid={"button-community-" + x.id}
                    >
                      <span className="tb-menu-item-label">{x.name}</span>
                      {active && <Icon name="tick" size={16} />}
                    </button>
                  );
                })}
                {visible.length === 0 && <div className="vrt-menu-empty">{filter ? "No communities match" : "No communities yet"}</div>}
              </div>
            </>
          )}
        </>
      )}
    </Menu>
  );
}
