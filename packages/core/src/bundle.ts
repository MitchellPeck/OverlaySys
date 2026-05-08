import { z } from "zod";
import { SongSchema, type Song } from "./song";
import { TemplateSchema, type Template } from "./template";
import { ShowSchema, type Show } from "./show";

export const BundleSchema = z.object({
  format: z.literal("overlaysys-bundle"),
  version: z.literal(1),
  exportedAt: z.string(),
  name: z.string().optional(),
  songs: z.array(SongSchema).default([]),
  templates: z.array(TemplateSchema).default([]),
  shows: z.array(ShowSchema).default([]),
});
export type Bundle = z.infer<typeof BundleSchema>;

export interface BundleSelection {
  songIds: string[];
  templateIds: string[];
  showIds: string[];
}

export interface MissingRef {
  kind: "song" | "template";
  id: string;
  referencedBy: string;
}

export interface BundlePayload {
  songs: Song[];
  templates: Template[];
  shows: Show[];
  missing: MissingRef[];
}

export interface StoreSnapshot {
  songs: Map<string, Song>;
  templates: Map<string, Template>;
  shows: Map<string, Show>;
}

export function collectDependencies(
  _selection: BundleSelection,
  _store: StoreSnapshot,
): BundlePayload {
  return { songs: [], templates: [], shows: [], missing: [] };
}

export type Detected =
  | { kind: "bundle"; bundle: Bundle }
  | { kind: "song"; song: Song }
  | { kind: "template"; template: Template }
  | { kind: "show"; show: Show }
  | { kind: "error"; message: string };

export function detectImport(_json: unknown): Detected {
  return { kind: "error", message: "not yet implemented" };
}
