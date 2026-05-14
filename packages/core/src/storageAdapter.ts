import type { Project } from "./project";
import type { Show } from "./show";
import type { Hotcard } from "./hotcard";
import type { Song } from "./song";
import type { Template } from "./template";

/**
 * Backend-agnostic persistence interface for OverlaySys's domain entities.
 * The Electron-embedded Fastify server implements this against the local
 * filesystem (see server/src/storage.ts). The Phase 3 web operator
 * implements it against Supabase row queries + Storage objects.
 *
 * Operations are scoped to a single org. The FS implementation ignores
 * the orgId argument (single-tenant by definition); the Supabase
 * implementation uses it as the RLS scope.
 */
export interface StorageAdapter {
  // Projects
  listProjects(orgId: string): Promise<Project[]>;
  getProject(orgId: string, id: string): Promise<Project | null>;
  saveProject(orgId: string, project: Project): Promise<void>;
  deleteProject(orgId: string, id: string): Promise<boolean>;

  // Shows (scoped to a project)
  listShows(orgId: string, projectId?: string): Promise<Show[]>;
  getShow(orgId: string, id: string): Promise<Show | null>;
  saveShow(orgId: string, show: Show): Promise<void>;
  deleteShow(orgId: string, id: string): Promise<boolean>;

  // Hotcards (scoped to a project)
  listHotcards(orgId: string, projectId?: string): Promise<Hotcard[]>;
  getHotcard(orgId: string, id: string): Promise<Hotcard | null>;
  saveHotcard(orgId: string, hotcard: Hotcard): Promise<void>;
  deleteHotcard(orgId: string, id: string): Promise<boolean>;

  // Songs (org library — no project scoping)
  listSongs(orgId: string): Promise<Song[]>;
  getSong(orgId: string, id: string): Promise<Song | null>;
  saveSong(orgId: string, song: Song): Promise<void>;
  deleteSong(orgId: string, id: string): Promise<boolean>;

  // Templates (org library — no project scoping)
  listTemplates(orgId: string): Promise<Template[]>;
  getTemplate(orgId: string, id: string): Promise<Template | null>;
  saveTemplate(orgId: string, template: Template): Promise<void>;
  deleteTemplate(orgId: string, id: string): Promise<boolean>;

  // Assets — bytes addressed by sha256. The FS adapter stores them under
  // data/assets/; the Supabase adapter uses the `assets` Storage bucket
  // with object path `<org_id>/<filename>`.
  putAsset(
    orgId: string,
    filename: string,
    bytes: Uint8Array,
    mime?: string,
  ): Promise<void>;
  hasAsset(orgId: string, filename: string): Promise<boolean>;
  getAssetUrl(orgId: string, filename: string): Promise<string | null>;
}

/**
 * Sentinel orgId used by the local-only FS adapter. The Electron app
 * runs in single-tenant mode and never needs a real org until the user
 * pairs it to a cloud org (Phase 4); pass this value to satisfy the
 * interface in the meantime.
 */
export const LOCAL_ORG_ID = "local";
