import { kindColor, type ItemKind } from "./tokens";

/** Thin vertical colour bar marking an item's kind (graphic, song, slides…). */
export function KindBar({ kind }: { kind: ItemKind }) {
  return (
    <span
      aria-hidden
      style={{
        display: "block",
        width: 3,
        flexShrink: 0,
        alignSelf: "stretch",
        borderRadius: 2,
        background: kindColor[kind],
      }}
    />
  );
}
