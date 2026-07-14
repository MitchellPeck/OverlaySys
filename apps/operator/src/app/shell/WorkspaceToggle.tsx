"use client";

import { useRouter } from "next/navigation";
import { colors } from "@overlaysys/ui";
import { WORKSPACES, lastRouteKey, type WorkspaceId } from "./workspaces";

/** Navigate to a workspace's last-visited route, falling back to its default.
 *  Shared by the toggle button and the ⌘⇧L / palette actions. */
export function enterWorkspace(router: { push: (r: string) => void }, id: WorkspaceId): void {
  const saved = typeof window !== "undefined" ? localStorage.getItem(lastRouteKey(id)) : null;
  router.push(saved || WORKSPACES[id].defaultRoute);
}

export function WorkspaceToggle({ active }: { active: WorkspaceId }) {
  const router = useRouter();
  function go(id: WorkspaceId) {
    if (id === active) return;
    enterWorkspace(router, id);
  }
  return (
    <div
      role="tablist"
      style={{
        display: "flex",
        background: colors.surface2,
        border: `1px solid ${colors.borderStrong}`,
        borderRadius: 8,
        padding: 2,
        gap: 2,
      }}
    >
      {(["live", "prep"] as const).map((id) => {
        const on = id === active;
        const bg = id === "live" ? colors.onair : colors.brand;
        return (
          <button
            key={id}
            role="tab"
            aria-selected={on}
            onClick={() => go(id)}
            style={{
              padding: "4px 12px",
              borderRadius: 6,
              border: "none",
              fontWeight: 600,
              fontSize: 11,
              letterSpacing: 0.4,
              cursor: "pointer",
              background: on ? bg : "transparent",
              color: on ? "#fff" : colors.textDim,
            }}
          >
            {WORKSPACES[id].label.toUpperCase()}
          </button>
        );
      })}
    </div>
  );
}
