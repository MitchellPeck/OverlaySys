"use client";

import Link from "next/link";
import { useStore } from "@/lib/store";
import { useWs } from "@/lib/useWs";

export function ShowPicker() {
  const { send } = useWs();
  const showMetas = useStore((s) => s.showMetas);
  const show = useStore((s) => s.show);

  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
      <select
        value={show?.id ?? ""}
        onChange={(e) => {
          const id = e.target.value;
          if (id) send({ type: "get_show", showId: id });
        }}
        style={{
          padding: "4px 8px",
          background: "var(--panel-2)",
          border: "1px solid var(--border)",
          color: "var(--text)",
          borderRadius: 4,
          fontSize: 12,
        }}
      >
        {showMetas.length === 0 && <option value="">(no shows)</option>}
        {showMetas.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name} ({s.rowCount})
          </option>
        ))}
      </select>
      {show && (
        <Link href={`/shows/edit?id=${encodeURIComponent(show.id)}`} title="Edit show" style={iconLink}>
          ✎
        </Link>
      )}
      <Link href="/shows" title="Manage shows" style={iconLink}>
        +
      </Link>
    </div>
  );
}

const iconLink: React.CSSProperties = {
  width: 26,
  height: 24,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  background: "var(--panel-2)",
  border: "1px solid var(--border)",
  borderRadius: 4,
  color: "var(--text)",
  textDecoration: "none",
  fontSize: 13,
};
