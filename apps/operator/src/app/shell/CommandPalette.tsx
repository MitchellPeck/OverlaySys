"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Modal, colors, fontSize, radius } from "@overlaysys/ui";
import { isCloudMode } from "@/lib/mode";
import { getDesktopApi } from "@/lib/desktop";
import { useStore } from "@/lib/store";
import { buildPaletteEntries, rankEntries, type PaletteEntry } from "./paletteEntries";
import { enterArea } from "./TopBar";
import { OPEN_FIRST_RUN_EVENT } from "./FirstRunChecklist";
import { AREAS, LAST_NON_LIVE_KEY, areasFor, destinationsFor, liveToggleTarget, routeToArea } from "./areas";

/**
 * ⌘K palette: destinations, library items (shows, songs, designs, hotcards)
 * and app actions, ranked by `rankEntries`. Built on the kit Modal (focus trap, Esc from anywhere,
 * keys stopped before the live shortcuts) with an ARIA combobox: the input
 * owns focus and points at the highlighted option via aria-activedescendant.
 */
export function CommandPalette() {
  const router = useRouter();
  const pathname = usePathname() ?? "/";
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const baseId = useId();
  const listId = `${baseId}-list`;
  const optionId = (i: number) => `${baseId}-opt-${i}`;

  // Global meta-combo listener — never intercepts the live bare-key shortcuts.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (meta && e.shiftKey && e.key.toLowerCase() === "l") {
        e.preventDefault();
        setOpen(false);
        const cloud = isCloudMode();
        const last = typeof window !== "undefined" ? localStorage.getItem(LAST_NON_LIVE_KEY) : null;
        router.push(liveToggleTarget(routeToArea(pathname), last, cloud));
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router, pathname]);

  // Reset query + highlight each time it opens.
  useEffect(() => {
    if (open) {
      setQuery("");
      setIndex(0);
    }
  }, [open]);

  const shows = useStore((s) => s.showMetas);
  const songs = useStore((s) => s.songs);
  const templates = useStore((s) => s.templates);
  const stageLayouts = useStore((s) => s.stageLayouts);
  const hotcards = useStore((s) => s.hotcards);
  const projectId = useStore((s) => s.currentProjectId);

  const entries: PaletteEntry[] = useMemo(() => {
    const cloud = isCloudMode();
    const destinations = areasFor(cloud).flatMap((id) =>
      destinationsFor(id, cloud).map((d) => ({ label: `${AREAS[id].label} · ${d.label}`, href: d.route })),
    );
    const extras: PaletteEntry[] = areasFor(cloud).map((id) => ({
      id: `area:${id}`,
      label: `Go to ${AREAS[id].label}`,
      group: "Go to",
      run: () => enterArea(router, id, cloud),
    }));
    const api = getDesktopApi();
    if (api) {
      extras.push({ id: "app:first-run", label: "Getting started checklist", group: "App", run: () => window.dispatchEvent(new Event(OPEN_FIRST_RUN_EVENT)) });
      if (api.copyDiagnostics) extras.push({ id: "app:copy-diagnostics", label: "Copy diagnostics", group: "App", run: () => void api.copyDiagnostics?.() });
      if (api.revealLogs) extras.push({ id: "app:reveal-logs", label: "Reveal logs", group: "App", run: () => void api.revealLogs?.() });
    }
    return buildPaletteEntries({ destinations, shows, songs, templates, stageLayouts, hotcards, projectId, cloud, extras });
  }, [router, shows, songs, templates, stageLayouts, hotcards, projectId]);

  const filtered = useMemo(() => rankEntries(query, entries), [entries, query]);

  const clampedIndex = Math.min(index, Math.max(0, filtered.length - 1));

  // Keep the highlighted option visible while arrowing through a long list.
  useEffect(() => {
    if (!open) return;
    document.getElementById(optionId(clampedIndex))?.scrollIntoView({ block: "nearest" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, clampedIndex]);

  function runAt(i: number) {
    const entry = filtered[i];
    if (!entry) return;
    setOpen(false);
    if (entry.href) router.push(entry.href);
    else entry.run?.();
  }

  return (
    <Modal
      open={open}
      onClose={() => setOpen(false)}
      ariaLabel="Command palette"
      placement="top"
      zIndex={2000}
      containerStyle={{ width: 520, minWidth: 0, maxWidth: "90vw", background: colors.surface, borderRadius: radius.xl, overflow: "hidden" }}
      bodyStyle={{ padding: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}
    >
      <input
        data-autofocus
        value={query}
        placeholder="Jump to or find…"
        role="combobox"
        aria-label="Jump to"
        aria-expanded={filtered.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={filtered.length > 0 ? optionId(clampedIndex) : undefined}
        onChange={(e) => {
          setQuery(e.target.value);
          setIndex(0);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setIndex((i) => Math.min(i + 1, filtered.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setIndex((i) => Math.max(i - 1, 0));
          } else if (e.key === "Enter") {
            e.preventDefault();
            e.stopPropagation();
            runAt(clampedIndex);
          }
          // Escape is handled by Modal, wherever focus is.
        }}
        style={{
          width: "100%",
          padding: "12px 14px",
          background: colors.surface2,
          border: "none",
          borderBottom: `1px solid ${colors.border}`,
          color: colors.text,
          fontSize: fontSize.base,
          outline: "none",
        }}
      />
      <ul
        id={listId}
        role="listbox"
        aria-label="Results"
        style={{ listStyle: "none", margin: 0, padding: 4, maxHeight: 360, overflow: "auto" }}
      >
        {filtered.map((c, i) => (
          <li
            key={c.id}
            id={optionId(i)}
            role="option"
            aria-selected={i === clampedIndex}
            onMouseEnter={() => setIndex(i)}
            // Keep focus in the input so typing continues after a hover.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => runAt(i)}
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: 12,
              padding: "8px 10px",
              borderRadius: radius.md,
              cursor: "pointer",
              color: colors.text,
              background: i === clampedIndex ? colors.brandSubtle : "transparent",
            }}
          >
            <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.label}</span>
            <span style={{ flexShrink: 0, fontSize: fontSize.xs, color: colors.textDim }}>{c.group}</span>
          </li>
        ))}
        {filtered.length === 0 && (
          <li role="presentation" style={{ padding: "8px 10px", color: colors.textDim }}>
            No matches
          </li>
        )}
      </ul>
      <div
        aria-hidden
        style={{
          padding: "6px 12px",
          borderTop: `1px solid ${colors.border}`,
          color: colors.textDim,
          fontSize: fontSize.xs,
        }}
      >
        ↑↓ to move · ↵ to open · esc to close
      </div>
    </Modal>
  );
}
