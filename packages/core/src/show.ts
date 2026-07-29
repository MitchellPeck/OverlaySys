/**
 * The show / rundown schemas now live in the shared contract package
 * `@ovation/overlay-bridge` (single source of truth shared with Ovation). This
 * module re-exports them verbatim so every existing `@overlaysys/core` importer
 * — plus the `./show` deep-path imports inside core (`bundle.ts`,
 * `songResolution.ts`, `pco/mapPlanItems.ts`) — keep working unchanged.
 *
 * `RowSourceRef` was previously defined here as a flat `{ provider: "pco", ... }`
 * object; it is now a discriminated union (`pco` | `ovation`) in the shared
 * package. The PCO variant is unchanged, so existing show JSON still parses.
 * Consumers that read `sourceRef.itemId` must first narrow on `provider`.
 */
export {
  GraphicRowSchema,
  SongRowSchema,
  ShowSongSchema,
  ScriptureSlideSchema,
  ScriptureRowSchema,
  RundownRowSchema,
  ShowSchema,
  RowSourceRefSchema,
  PcoSourceRefSchema,
  OvationSourceRefSchema,
} from "@ovation/overlay-bridge";
export type {
  GraphicRow,
  SongRow,
  ShowSong,
  ScriptureSlide,
  ScriptureRow,
  RundownRow,
  Show,
  RowSourceRef,
  PcoSourceRef,
  OvationSourceRef,
} from "@ovation/overlay-bridge";
