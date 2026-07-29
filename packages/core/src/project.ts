/**
 * `Project` now lives in the shared contract package `@ovation/overlay-bridge`
 * (single source of truth shared with Ovation). This module re-exports it so
 * every existing `@overlaysys/core` importer — and the `./project` deep-path
 * imports inside core (`show.ts`, `hotcard.ts`, `storageAdapter.ts`) — keep
 * working unchanged.
 */
export { ProjectSchema, DEFAULT_PROJECT_ID } from "@ovation/overlay-bridge";
export type { Project } from "@ovation/overlay-bridge";
