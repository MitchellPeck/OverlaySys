import type { Show } from "@overlaysys/core";

/**
 * Props of every show-editor item form (contracts §9). `onChange` gets the
 * whole edited row (same id, unknown keys kept); nothing persists until Save.
 */
export type ItemFormProps<R> = { row: R; show: Show; onChange(next: R): void };
