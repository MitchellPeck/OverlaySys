"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { colors, shadow } from "@overlaysys/ui";
import { isCloudMode } from "@/lib/mode";
import { fuzzyMatch } from "./fuzzyMatch";
import { enterWorkspace } from "./WorkspaceToggle";
import { WORKSPACES, destinationsFor, otherWorkspace, routeToWorkspace, type WorkspaceId } from "./workspaces";

type Command = { label: string; run: () => void };

export function CommandPalette() {
  const router = useRouter();
  const pathname = usePathname() ?? "/";
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Global meta-combo listener — never intercepts the live bare-key shortcuts.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (meta && e.shiftKey && e.key.toLowerCase() === "l") {
        e.preventDefault();
        enterWorkspace(router, otherWorkspace(routeToWorkspace(pathname)));
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router, pathname]);

  // Reset query + highlight and focus the input each time it opens.
  useEffect(() => {
    if (open) {
      setQuery("");
      setIndex(0);
      // focus after paint
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const commands: Command[] = useMemo(() => {
    const cloud = isCloudMode();
    const current = routeToWorkspace(pathname);
    const nav: Command[] = (["live", "prep"] as const).flatMap((id: WorkspaceId) =>
      destinationsFor(id, cloud).map((d) => ({
        label: `${WORKSPACES[id].label} · ${d.label}`,
        run: () => router.push(d.route),
      })),
    );
    const actions: Command[] = [];
    if (!cloud) {
      const other = otherWorkspace(current);
      actions.push({ label: `Switch to ${WORKSPACES[other].label}`, run: () => enterWorkspace(router, other) });
    }
    actions.push({ label: "Open account", run: () => router.push("/account") });
    return [...nav, ...actions];
  }, [pathname, router]);

  const filtered = useMemo(
    () => commands.filter((c) => fuzzyMatch(query, c.label)),
    [commands, query],
  );

  if (!open) return null;

  const clampedIndex = Math.min(index, Math.max(0, filtered.length - 1));

  function runAt(i: number) {
    const cmd = filtered[i];
    if (cmd) {
      setOpen(false);
      cmd.run();
    }
  }

  return (
    <div
      onClick={() => setOpen(false)}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        paddingTop: "12vh",
        zIndex: 2000,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 520,
          maxWidth: "90vw",
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: 14,
          boxShadow: shadow.modal,
          overflow: "hidden",
        }}
      >
        <input
          ref={inputRef}
          value={query}
          placeholder="Jump to…"
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
              runAt(clampedIndex);
            } else if (e.key === "Escape") {
              e.preventDefault();
              setOpen(false);
            }
          }}
          style={{
            width: "100%",
            padding: "12px 14px",
            background: colors.surface2,
            border: "none",
            borderBottom: `1px solid ${colors.border}`,
            color: colors.text,
            fontSize: 14,
            outline: "none",
          }}
        />
        <ul style={{ listStyle: "none", margin: 0, padding: 4, maxHeight: 360, overflow: "auto" }}>
          {filtered.map((c, i) => (
            <li
              key={c.label}
              onMouseEnter={() => setIndex(i)}
              onClick={() => runAt(i)}
              style={{
                padding: "8px 10px",
                borderRadius: 8,
                cursor: "pointer",
                color: colors.text,
                background: i === clampedIndex ? colors.brandSubtle : "transparent",
              }}
            >
              {c.label}
            </li>
          ))}
          {filtered.length === 0 && (
            <li style={{ padding: "8px 10px", color: colors.textDim }}>No matches</li>
          )}
        </ul>
      </div>
    </div>
  );
}
