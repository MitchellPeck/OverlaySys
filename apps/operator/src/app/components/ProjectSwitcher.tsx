"use client";

import { useStore } from "@/lib/store";

/**
 * Compact dropdown in the global header that switches the operator's
 * "current project" — the slug used to filter shows/hotcards and stamp
 * onto newly-created entities. Selection persists per tab via
 * sessionStorage (see lib/currentProject.ts).
 */
export function ProjectSwitcher() {
  const projects = useStore((s) => s.projects);
  const currentProjectId = useStore((s) => s.currentProjectId);
  const setCurrentProjectId = useStore((s) => s.setCurrentProjectId);

  if (projects.length === 0) return null;

  return (
    <label
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        color: "var(--text-dim)",
        fontSize: 13,
      }}
    >
      <span>Project</span>
      <select
        value={currentProjectId}
        onChange={(e) => setCurrentProjectId(e.target.value)}
        style={{
          background: "var(--panel-2)",
          color: "var(--text)",
          border: "1px solid var(--border)",
          borderRadius: 4,
          padding: "3px 6px",
          fontSize: 13,
        }}
      >
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
    </label>
  );
}
