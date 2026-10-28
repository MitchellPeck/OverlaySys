"use client";

import Link from "next/link";
import { Pencil } from "lucide-react";
import { useStore } from "@/lib/store";
import { useWs } from "@/lib/useWs";
import { useDialog } from "@/lib/dialog";
import { anythingOnAir } from "@/lib/onAir";

export function ShowPicker() {
  const { send } = useWs();
  const showMetas = useStore((s) => s.showMetas);
  const show = useStore((s) => s.show);
  const { confirm, dialog } = useDialog();

  async function switchTo(id: string) {
    if (!id || id === show?.id) return;
    if (show && anythingOnAir(useStore.getState().channelStates)) {
      const name = showMetas.find((m) => m.id === id)?.name ?? "this show";
      const ok = await confirm({
        title: "Switch show while on air?",
        message: `Something is on air. Switching to "${name}" changes the rundown; what's on air stays up until you clear it.`,
        confirmLabel: "Switch show",
      });
      if (!ok) return;
    }
    // useWs ignores show broadcasts for other shows; mark this one as wanted.
    useStore.getState().setRequestedShowId(id);
    send({ type: "get_show", showId: id });
  }

  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
      <select
        aria-label="Show"
        value={show?.id ?? ""}
        onChange={(e) => {
          // Hand the keyboard back to the show shortcuts once a show is picked.
          e.currentTarget.blur();
          void switchTo(e.target.value);
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
          <Pencil size={14} aria-hidden />
        </Link>
      )}
      <Link href="/shows" title="Manage shows" style={iconLink}>
        +
      </Link>
      {dialog}
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
