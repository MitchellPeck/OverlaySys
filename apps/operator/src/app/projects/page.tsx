"use client";

import { Cloud } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  Button,
  LibraryList,
  OfflineState,
  Pill,
  colors,
  confirm,
  prompt,
  toast,
  type Column,
} from "@overlaysys/ui";
import { DEFAULT_PROJECT_ID, type Project } from "@overlaysys/core";
import { getClient, useWs } from "@/lib/useWs";
import { useConnection } from "@/lib/useConnection";
import { ackErrorText, requestOne, sendAndAwaitAck } from "@/lib/awaitAck";
import { useStore } from "@/lib/store";
import { useDialog } from "@/lib/dialog";
import { PageBody } from "@/app/components/PageShell";
import { isCloudMode } from "@/lib/mode";
import { isElectron } from "@/lib/desktop";
import { useAuthStore } from "@/lib/useAuth";
import {
  deleteProjectCloud,
  getHotcardCloud,
  getShowCloud,
  refreshHotcardMetasCloud,
  refreshProjectsCloud,
  refreshShowMetasCloud,
  saveHotcardCloud,
  saveProjectCloud,
  saveShowCloud,
} from "@/lib/cloudData";
import { publishProjectToCloud } from "@/lib/projectPublish";
import { CustomFieldSchemaModal } from "./CustomFieldSchemaModal";
import {
  projectMenuItems,
  projectNameError,
  projectSecondary,
  projectSorts,
  unassignedItems,
  type ProjectActions,
  type ProjectRow,
} from "./projectsList";

/**
 * The Projects page lists every Project for the org and lets the
 * operator create, rename, delete them, and edit their custom-field
 * schemas. Entity JSON is reconciled automatically by the SyncEngine in
 * @overlaysys/core whenever the desktop is paired to apps-portal; the
 * per-row **Publish** button is the explicit push — it also carries the
 * project's assets, which automatic sync never moves, and makes the
 * local version the newest one everywhere (see lib/projectPublish.ts).
 * Songs and Templates are org-wide and not project-scoped today;
 * Shows + Hotcards belong to a Project.
 */
export default function ProjectsIndexPage() {
  const { send } = useWs();
  const conn = useStore((s) => s.conn);
  const projects = useStore((s) => s.projects);
  const currentProjectId = useStore((s) => s.currentProjectId);
  const setCurrentProjectId = useStore((s) => s.setCurrentProjectId);
  const showMetas = useStore((s) => s.showMetas);
  const hotcards = useStore((s) => s.hotcards);
  const { alert } = useDialog();
  const { retry } = useConnection();
  const cloud = isCloudMode();
  const disabled = !cloud && conn !== "open";

  const [schemaEditing, setSchemaEditing] = useState<Project | null>(null);

  // ── Publish to cloud (desktop only) ───────────────────────────────────
  // Absent in the cloud build (the data already lives there) and in the
  // bare web operator (nothing to publish to). On desktop the button is
  // always visible so the capability is discoverable; it's enabled once
  // the user is signed in and the local server is connected.
  const inElectron = isElectron();
  const signedIn = useAuthStore((s) => s.status === "signed_in");
  const [publishing, setPublishing] = useState<string | null>(null);
  const publishBlockedReason = !signedIn
    ? "Sign in to cloud to publish"
    : conn !== "open"
      ? "Not connected to the local server"
      : publishing
        ? "A publish is already running"
        : null;

  async function publish(p: Project) {
    if (publishBlockedReason) return;
    setPublishing(p.id);
    try {
      const result = await publishProjectToCloud(p.id);
      await alert({
        title: result.ok ? "Published to cloud" : "Published with errors",
        message: (
          <div style={{ fontSize: 12, lineHeight: 1.5 }}>
            <div style={{ marginBottom: 6 }}>
              <strong>{p.name}</strong> pushed to the cloud.
            </div>
            {Object.entries(result.counts).map(([k, v]) => (
              <div key={k}>
                {k}: {v}
              </div>
            ))}
            {result.errors.length > 0 && (
              <details style={{ marginTop: 8 }} open>
                <summary style={{ cursor: "pointer", color: colors.red }}>
                  {result.errors.length} error{result.errors.length === 1 ? "" : "s"}
                </summary>
                <pre style={{ whiteSpace: "pre-wrap", fontSize: 11, margin: 0 }}>
                  {result.errors.map((e) => `[${e.kind}:${e.id}] ${e.message}`).join("\n")}
                </pre>
              </details>
            )}
          </div>
        ),
      });
    } catch (err) {
      await showError("publish", err);
    } finally {
      setPublishing(null);
    }
  }

  async function showError(action: string, err: unknown) {
    const message =
      err instanceof Error ? err.message : JSON.stringify(err);
    console.warn(`[projects] cloud ${action} failed`, err);
    await alert({
      title: `Cloud ${action} failed`,
      message: (
        <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: 12, margin: 0 }}>
          {message}
        </pre>
      ),
    });
  }

  useEffect(() => {
    if (cloud) {
      Promise.all([
        refreshProjectsCloud(),
        refreshShowMetasCloud(),
        refreshHotcardMetasCloud(),
      ]).catch((err) => console.warn("[projects] cloud list failed", err));
    } else if (conn === "open") {
      send({ type: "list_projects" });
      // Counts per project come from these two lists.
      send({ type: "list_shows" });
      send({ type: "list_hotcards" });
    }
  }, [cloud, conn, send]);

  async function newProject() {
    const name = await prompt({
      title: "New project",
      message: "Name the project",
      confirmLabel: "Create",
      required: true,
      validate: (v) => projectNameError(v, names) ?? (slugify(v) ? null : "Use at least one letter or number"),
    });
    if (!name) return;
    const id = uniqueId(slugify(name), projects.map((p) => p.id));
    const now = new Date().toISOString();
    const project: Project = {
      id,
      name,
      createdAt: now,
      updatedAt: now,
    };
    try {
      if (cloud) {
        await saveProjectCloud(project);
        await refreshProjectsCloud();
      } else {
        send({ type: "save_project", project });
      }
      setCurrentProjectId(id);
    } catch (err) {
      await showError("create", err);
    }
  }

  async function saveSchema(
    p: Project,
    schema: Project["songCustomFieldSchema"],
  ) {
    const updated: Project = {
      ...p,
      updatedAt: new Date().toISOString(),
    };
    // Empty list → field absent (it's .optional() in the schema). Avoid
    // persisting `[]` since that's semantically distinct.
    if (schema && schema.length > 0) {
      updated.songCustomFieldSchema = schema;
    } else {
      delete updated.songCustomFieldSchema;
    }
    if (cloud) {
      try {
        await saveProjectCloud(updated);
        await refreshProjectsCloud();
      } catch (err) {
        await showError("save custom fields", err);
      }
    } else {
      send({ type: "save_project", project: updated });
    }
  }

  async function rename(p: Project) {
    const next = await prompt({
      title: "Rename project",
      message: `Rename "${p.name}"`,
      defaultValue: p.name,
      confirmLabel: "Rename",
      required: true,
      validate: (v) =>
        projectNameError(v, names.filter((n) => n !== p.name)),
    });
    if (!next || next === p.name) return;
    const updated = { ...p, name: next, updatedAt: new Date().toISOString() };
    if (cloud) {
      try {
        await saveProjectCloud(updated);
        await refreshProjectsCloud();
      } catch (err) {
        await showError("rename", err);
      }
    } else {
      send({ type: "save_project", project: updated });
    }
  }

  async function deleteProject(p: Project): Promise<void> {
    if (cloud) {
      await deleteProjectCloud(p.id);
      await refreshProjectsCloud();
    } else {
      send({ type: "delete_project", projectId: p.id });
    }
    if (currentProjectId === p.id) setCurrentProjectId(DEFAULT_PROJECT_ID);
  }

  const names = projects.map((p) => p.name);
  const rows: ProjectRow[] = useMemo(
    () =>
      projects.map((p) => ({
        id: p.id,
        name: p.name || p.id,
        shows: showMetas.filter((s) => s.projectId === p.id).length,
        hotcards: hotcards.filter((h) => h.projectId === p.id).length,
        isCurrent: p.id === currentProjectId,
        isDefault: p.id === DEFAULT_PROJECT_ID,
      })),
    [projects, showMetas, hotcards, currentProjectId],
  );
  const projectOf = (id: string) => projects.find((p) => p.id === id);
  const currentName = projectOf(currentProjectId)?.name ?? "the current project";

  const orphans = useMemo(
    () => unassignedItems(showMetas, hotcards, projects.map((p) => p.id)),
    [showMetas, hotcards, projects],
  );
  const orphanCount = orphans.shows.length + orphans.hotcards.length;
  const [moving, setMoving] = useState(false);

  async function moveUnassigned() {
    if (!projectOf(currentProjectId)) return;
    setMoving(true);
    try {
      for (const s of orphans.shows) {
        if (cloud) {
          const full = await getShowCloud(s.id);
          if (full) await saveShowCloud({ ...full, projectId: currentProjectId });
        } else {
          const full = await requestOne(
            getClient(),
            { type: "get_show", showId: s.id },
            (m) => (m.type === "show" && m.show.id === s.id ? m.show : undefined),
          );
          await sendAndAwaitAck(
            getClient(),
            { type: "save_show", show: { ...full, projectId: currentProjectId } },
            { op: "save_show", id: s.id },
          );
        }
      }
      for (const h of orphans.hotcards) {
        if (cloud) {
          const full = await getHotcardCloud(h.id);
          if (full) await saveHotcardCloud({ ...full, projectId: currentProjectId });
        } else {
          const full = await requestOne(
            getClient(),
            { type: "get_hotcard", hotcardId: h.id },
            (m) => (m.type === "hotcard" && m.hotcard.id === h.id ? m.hotcard : undefined),
          );
          await sendAndAwaitAck(
            getClient(),
            { type: "save_hotcard", hotcard: { ...full, projectId: currentProjectId } },
            { op: "save_hotcard", id: h.id },
          );
        }
      }
      toast({ message: `Moved ${orphanCount} items to ${currentName}`, tone: "ok" });
    } catch (err) {
      toast({ message: `Couldn't move items. ${ackErrorText(err)}`, tone: "error" });
    } finally {
      setMoving(false);
      if (cloud) {
        refreshShowMetasCloud().catch(() => {});
        refreshHotcardMetasCloud().catch(() => {});
      } else {
        send({ type: "list_shows" });
        send({ type: "list_hotcards" });
      }
    }
  }

  async function confirmDelete(row: ProjectRow) {
    const p = projectOf(row.id);
    if (!p) return;
    const ok = await confirm({
      title: "Delete project",
      message: `Delete "${p.name}"? This can't be undone.`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (ok) await deleteProject(p);
  }

  function copyId(id: string) {
    navigator.clipboard
      ?.writeText(id)
      .then(() => toast({ message: "Copied id", tone: "ok" }))
      .catch(() => toast({ message: "Couldn't copy the id", tone: "error" }));
  }

  const actionsFor = (row: ProjectRow): ProjectActions => {
    const p = projectOf(row.id);
    return {
      makeCurrent: () => setCurrentProjectId(row.id),
      rename: () => p && void rename(p),
      customFields: () => p && setSchemaEditing(p),
      copyId: () => copyId(row.id),
      remove: () => void confirmDelete(row),
      ...(inElectron
        ? {
            publish: {
              run: () => p && void publish(p),
              disabledReason: publishBlockedReason ?? undefined,
            },
          }
        : {}),
    };
  };

  const columns: Column<ProjectRow>[] = [
    {
      id: "items",
      label: "Items",
      width: "90px",
      align: "right",
      render: (r) => String(r.shows + r.hotcards),
    },
    {
      id: "current",
      label: "",
      width: "120px",
      render: (r) =>
        r.isCurrent ? (
          <Pill tone="accent">Current</Pill>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            aria-label={`Make ${r.name} the current project`}
            onClick={(e) => {
              e.stopPropagation();
              setCurrentProjectId(r.id);
            }}
          >
            Make current
          </Button>
        ),
    },
  ];

  const offlineEmpty = !cloud && conn !== "open" && projects.length === 0;
  const stale = !cloud && conn !== "open" && projects.length > 0;

  return (
    <PageBody variant="list">
      {offlineEmpty ? (
        <OfflineState noun="projects" onRetry={retry} />
      ) : (
        <>
          {stale && <OfflineState noun="projects" variant="stale" onRetry={retry} />}
          {orphanCount > 0 && (
            <div
              role="status"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "6px 10px",
                background: colors.surface2,
                border: `1px solid ${colors.border}`,
                borderRadius: 6,
                fontSize: 12,
                color: colors.textDim,
              }}
            >
              <span style={{ flex: 1 }}>
                <strong style={{ color: colors.text }}>Unassigned.</strong>{" "}
                {orphanCount} item{orphanCount === 1 ? "" : "s"} {orphanCount === 1 ? "isn't" : "aren't"} in any project
                ({orphans.shows.length} show{orphans.shows.length === 1 ? "" : "s"}, {orphans.hotcards.length} hotcard
                {orphans.hotcards.length === 1 ? "" : "s"}).
              </span>
              <Button
                size="sm"
                variant="secondary"
                disabled={moving || disabled || !projectOf(currentProjectId)}
                onClick={() => void moveUnassigned()}
              >
                {moving ? "Moving…" : `Move to ${currentName}`}
              </Button>
            </div>
          )}
          <LibraryList<ProjectRow>
            items={rows}
            getId={(r) => r.id}
            primary={(r) => r.name}
            secondary={projectSecondary}
            columns={columns}
            searchText={(r) => r.name}
            sorts={projectSorts}
            defaultSort="name-asc"
            menuItems={(r) => projectMenuItems(r, actionsFor(r))}
            onOpen={(r) => setCurrentProjectId(r.id)}
            storageKey="projects"
            primaryAction={{
              label: "New project",
              disabledReason: disabled ? "Reconnect to create a project" : undefined,
              onClick: () => void newProject(),
            }}
            emptyState={{
              title: "No projects yet",
              body: "A project groups shows and hotcards.",
              action: { label: "New project", onClick: () => void newProject() },
            }}
            loading={projects.length === 0 && (cloud || conn === "open")}
          />
        </>
      )}
      {schemaEditing && (
        <CustomFieldSchemaModal
          project={schemaEditing}
          onCancel={() => setSchemaEditing(null)}
          onSave={async (schema) => {
            const p = schemaEditing;
            setSchemaEditing(null);
            await saveSchema(p, schema);
          }}
        />
      )}
    </PageBody>
  );
}

function uniqueId(base: string, taken: string[]): string {
  if (!taken.includes(base)) return base;
  for (let n = 2; ; n++) if (!taken.includes(`${base}-${n}`)) return `${base}-${n}`;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
