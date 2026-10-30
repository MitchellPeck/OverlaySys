"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRightLeft, ChevronDown, Pencil } from "lucide-react";
import { Dialog, LibraryList, colors, fontSize, useConfirm, type Column, type MenuItem, type SortSpec } from "@overlaysys/ui";
import { useStore, type ShowMeta } from "@/lib/store";
import { useWs } from "@/lib/useWs";
import { useConnection } from "@/lib/useConnection";
import { anythingOnAir } from "@/lib/onAir";
import { formatServiceDate } from "@/lib/listFormat";
import { metaDate, showSorts } from "../shows/showListModel";

/** The picker offers service date (newest first, the default) and name. */
const PICKER_SORTS: SortSpec<ShowMeta>[] = showSorts.filter((s) => s.id === "date-desc" || s.id === "name-asc");

/** The service date as a column, so the list header isn't a lone "Name". */
const PICKER_COLUMNS: Column<ShowMeta>[] = [
  {
    id: "date",
    label: "Service date",
    width: "130px",
    render: (s) => {
      const d = metaDate(s);
      return d ? formatServiceDate(d, new Date()) : "—";
    },
  },
];

/**
 * The Live page's show picker (top bar context): the current show's name —
 * pressing it opens the show library to switch from — and an edit link.
 */
export function ShowPicker() {
  const { send } = useWs();
  const { connected } = useConnection();
  const showMetas = useStore((s) => s.showMetas);
  const show = useStore((s) => s.show);
  const confirm = useConfirm();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  // Every row's "⋯" menu has real actions: switch to it, or edit it.
  const menuItems = (s: ShowMeta): MenuItem[] => [
    {
      id: "switch",
      label: "Switch to this show",
      icon: <ArrowRightLeft size={14} />,
      disabled: s.id === show?.id ? "Already the current show" : false,
      onSelect: () => {
        setOpen(false);
        void switchTo(s.id);
      },
    },
    {
      id: "edit",
      label: "Edit show",
      icon: <Pencil size={14} />,
      onSelect: () => {
        setOpen(false);
        router.push(`/shows/edit?id=${encodeURIComponent(s.id)}`);
      },
    },
  ];

  async function switchTo(id: string) {
    if (!id || id === show?.id) return;
    if (show && anythingOnAir(useStore.getState().channelStates)) {
      const ok = await confirm({
        title: "Switch show?",
        message: `${show.name} is on air. Switching won't clear the outputs.`,
        confirmLabel: "Switch show",
      });
      if (!ok) return;
    }
    // useWs ignores show broadcasts for other shows; mark this one as wanted.
    useStore.getState().setRequestedShowId(id);
    send({ type: "get_show", showId: id });
  }

  // Offline keeps the last show's name, dimmed.
  const currentName = show ? show.name || "Untitled show" : showMetas.length === 0 ? "No shows" : "Choose a show";

  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center", opacity: connected ? 1 : 0.55 }}>
      <button
        type="button"
        aria-label={show ? `Show: ${currentName}. Choose another show` : "Choose a show"}
        aria-haspopup="dialog"
        title={connected ? "Shows" : "Not connected to the server"}
        disabled={!connected}
        onClick={(e) => {
          // Hand the keyboard back to the show shortcuts.
          e.currentTarget.blur();
          setOpen(true);
        }}
        style={showButton}
      >
        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "left" }}>
          {currentName}
        </span>
        <ChevronDown size={14} aria-hidden style={{ flexShrink: 0, color: colors.textDim }} />
      </button>
      {show && (
        <Link
          href={`/shows/edit?id=${encodeURIComponent(show.id)}`}
          title="Edit show"
          aria-label={`Edit ${show.name}`}
          style={iconLink}
        >
          <Pencil size={14} aria-hidden />
        </Link>
      )}
      <Dialog open={open} onClose={() => setOpen(false)} title="Shows" size="lg" bodyStyle={{ height: "min(60vh, 560px)", display: "flex", flexDirection: "column" }}>
        <LibraryList<ShowMeta>
          items={showMetas}
          getId={(s) => s.id}
          primary={(s) => (
            <span style={{ color: s.id === show?.id ? colors.brand : undefined }}>{s.name || "Untitled show"}</span>
          )}
          columns={PICKER_COLUMNS}
          searchText={(s) => s.name}
          sorts={PICKER_SORTS}
          defaultSort="date-desc"
          menuItems={menuItems}
          onOpen={(s) => {
            setOpen(false);
            void switchTo(s.id);
          }}
          storageKey="live-show-picker"
          emptyState={{ title: "No shows yet", body: "Create a show on the Shows page." }}
        />
      </Dialog>
    </div>
  );
}

const showButton: React.CSSProperties = {
  width: 220,
  height: 28,
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "0 8px",
  border: `1px solid ${colors.border}`,
  borderRadius: 6,
  background: colors.surface,
  color: colors.text,
  font: "inherit",
  fontSize: fontSize.sm,
  cursor: "pointer",
};

const iconLink: React.CSSProperties = {
  width: 28,
  height: 28,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  borderRadius: 6,
  color: "var(--text)",
  textDecoration: "none",
};
