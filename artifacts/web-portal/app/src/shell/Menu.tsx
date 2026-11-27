import { useCallback, useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";

export interface MenuControls { close: (returnFocus?: boolean) => void }

interface MenuProps {
  buttonClassName: string;
  buttonLabel: string;
  buttonContent: ReactNode;
  buttonTestId: string;
  buttonId?: string;
  panelClassName?: string;
  panelLabel: string;
  panelStyle?: CSSProperties;
  align?: "left" | "right";
  kind?: "menu" | "dialog";
  wrapperClassName?: string;
  onOpenChange?: (open: boolean) => void;
  children: (controls: MenuControls) => ReactNode;
}

const ITEM_SEL = '[role="menuitem"],[role="menuitemradio"],[role="menuitemcheckbox"]';
const FOCUSABLE_SEL = 'input:not([disabled]),button:not([disabled]),a[href],[tabindex]:not([tabindex="-1"])';

/** Shared dropdown: click-outside and Escape close, focus returns to the trigger. */
export function Menu(props: MenuProps) {
  const { onOpenChange } = props;
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const onOpenChangeRef = useRef(onOpenChange);
  onOpenChangeRef.current = onOpenChange;
  const kind = props.kind ?? "menu";

  const setOpenState = useCallback((v: boolean) => {
    setOpen(v);
    onOpenChangeRef.current?.(v);
  }, []);

  const close = useCallback((returnFocus = true) => {
    setOpenState(false);
    if (returnFocus) requestAnimationFrame(() => btnRef.current?.focus());
  }, [setOpenState]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpenState(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    const raf = requestAnimationFrame(() => {
      const p = panelRef.current;
      if (!p) return;
      const target = p.querySelector<HTMLElement>("[data-autofocus]") || p.querySelector<HTMLElement>(ITEM_SEL) || p.querySelector<HTMLElement>(FOCUSABLE_SEL) || p;
      target.focus();
    });
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      cancelAnimationFrame(raf);
    };
  }, [open, setOpenState]);

  const onPanelKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close(true);
      return;
    }
    if (kind !== "menu") return;
    const items = Array.from(panelRef.current?.querySelectorAll<HTMLElement>(ITEM_SEL) ?? []).filter((el) => !el.hasAttribute("disabled"));
    if (!items.length) return;
    const idx = items.indexOf(document.activeElement as HTMLElement);
    const inInput = (document.activeElement as HTMLElement | null)?.tagName === "INPUT";
    if (e.key === "ArrowDown") { e.preventDefault(); items[(idx + 1 + items.length) % items.length].focus(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); items[idx <= 0 ? items.length - 1 : idx - 1].focus(); }
    else if (e.key === "Home" && !inInput) { e.preventDefault(); items[0].focus(); }
    else if (e.key === "End" && !inInput) { e.preventDefault(); items[items.length - 1].focus(); }
  };

  const onBtnKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === "ArrowDown" && !open) { e.preventDefault(); setOpenState(true); }
    if (e.key === "Escape" && open) { e.preventDefault(); close(true); }
  };

  return (
    <div
      ref={wrapRef}
      className={"vrt-menu " + (props.wrapperClassName ?? "")}
      onBlur={(e) => {
        if (open && e.relatedTarget && wrapRef.current && !wrapRef.current.contains(e.relatedTarget as Node)) setOpenState(false);
      }}
    >
      <button
        ref={btnRef}
        id={props.buttonId}
        type="button"
        className={props.buttonClassName}
        aria-label={props.buttonLabel}
        aria-haspopup={kind === "menu" ? "menu" : "dialog"}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        data-testid={props.buttonTestId}
        onClick={() => (open ? close(false) : setOpenState(true))}
        onKeyDown={onBtnKey}
      >
        {props.buttonContent}
      </button>
      {open && (
        <div
          ref={panelRef}
          id={panelId}
          role={kind}
          aria-label={props.panelLabel}
          tabIndex={-1}
          className={"vrt-menu-panel tb-dropdown " + (props.align === "left" ? "vrt-menu-panel--left " : "") + (props.panelClassName ?? "tb-menu-dropdown")}
          style={props.panelStyle}
          onKeyDown={onPanelKey}
        >
          {props.children({ close })}
        </div>
      )}
    </div>
  );
}
