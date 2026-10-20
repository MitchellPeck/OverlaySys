import { colors, fontSize, fontWeight, radius } from "./tokens";

export type AreaTabItem<T extends string> = { id: T; label: string; tone: "onair" | "brand" };

/** Segmented Live · Library · Settings control in the shell top bar. */
export function AreaTabs<T extends string>({
  items,
  active,
  onSelect,
}: {
  items: AreaTabItem<T>[];
  active: T | null;
  onSelect: (id: T) => void;
}) {
  return (
    <div
      role="tablist"
      style={{
        display: "flex",
        gap: 2,
        padding: 2,
        background: colors.surface2,
        border: `1px solid ${colors.borderStrong}`,
        borderRadius: radius.md,
      }}
    >
      {items.map((it) => {
        const on = it.id === active;
        return (
          <button
            key={it.id}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onSelect(it.id)}
            style={{
              padding: "4px 12px",
              border: "none",
              borderRadius: radius.sm,
              cursor: "pointer",
              fontSize: fontSize.xs,
              fontWeight: fontWeight.semibold,
              background: on ? (it.tone === "onair" ? colors.onair : colors.brand) : "transparent",
              color: on ? "#fff" : colors.textDim,
            }}
          >
            {it.label}
          </button>
        );
      })}
    </div>
  );
}
