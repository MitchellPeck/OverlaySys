"use client";

import { Cloud } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, colors } from "@overlaysys/ui";
import { DEFAULT_PROJECT_ID, type Project } from "@overlaysys/core";
import { useWs } from "@/lib/useWs";
import { useStore } from "@/lib/store";
import { useDialog } from "@/lib/dialog";
import { ManagementList } from "@/app/components/ManagementList";
import { isCloudMode } from "@/lib/mode";
import { isElectron } from "@/lib/desktop";
import { useAuthStore } from "@/lib/useAuth";
import {
  deleteProjectCloud,
  refreshProjectsCloud,
  saveProjectCloud,
} from "@/lib/cloudData";
import { publishProjectToCloud } from "@/lib/projectPublish";
import { CustomFieldSchemaModal } from "./CustomFieldSchemaModal";

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
  const { alert, prompt, dialog } = useDialog();
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
      refreshProjectsCloud().catch((err) =>
        console.warn("[projects] cloud list failed", err),
      );
    } else if (conn === "open") {
      send({ type: "list_projects" });
    }
  }, [cloud, conn, send]);

  async function createProject(name: string): Promise<string> {
    const id = slugify(name);
    if (!id) throw new Error("Name produced an empty slug");
    if (projects.some((p) => p.id === id)) {
      throw new Error(`A project with id "${id}" already exists`);
    }
    const now = new Date().toISOString();
    const project: Project = {
      id,
      name,
      createdAt: now,
      updatedAt: now,
    };
    if (cloud) {
      await saveProjectCloud(project);
      await refreshProjectsCloud();
    } else {
      send({ type: "save_project", project });
    }
    setCurrentProjectId(id);
    return id;
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

  return (
    <>
      <ManagementList<Project>
        title="Projects"
        entityNoun="project"
        items={projects}
        disabled={disabled}
        createFn={createProject}
        deleteFn={deleteProject}
        rowKey={(p) => p.id}
        rowPrimary={(p) => (
          <>
            {p.name}
            {p.id === currentProjectId && (
              <span
                style={{
                  marginLeft: 8,
                  color: colors.textDim,
                  fontSize: 11,
                }}
              >
                ◆ current
              </span>
            )}
          </>
        )}
        rowSecondary={(p) => {
          const showCount = showMetas.filter((s) => s.projectId === p.id).length;
          const hotcardCount = hotcards.filter((h) => h.projectId === p.id).length;
          return `${p.id} · ${showCount} show${showCount === 1 ? "" : "s"}, ${hotcardCount} hotcard${hotcardCount === 1 ? "" : "s"}`;
        }}
        rowActions={(p) => (
          <>
            {inElectron && (
              <Button
                onClick={() => publish(p)}
                disabled={publishBlockedReason !== null}
                title={
                  publishBlockedReason ??
                  "Push this project — shows, hotcards, templates, songs and assets — to the cloud"
                }
                variant="primary"
                size="sm"
                style={{ width: 96 }}
              >
                {publishing === p.id ? "Publishing…" : <><Cloud size={14} aria-hidden style={{ verticalAlign: "-2px" }} /> Publish</>}
              </Button>
            )}
            {p.id !== currentProjectId && (
              <Button
                onClick={() => setCurrentProjectId(p.id)}
                size="sm"
                style={{ width: 88 }}
              >
                Switch to
              </Button>
            )}
            <Button onClick={() => rename(p)} size="sm" style={{ width: 70 }}>
              Rename
            </Button>
            <Button
              onClick={() => setSchemaEditing(p)}
              size="sm"
              style={{ width: 104 }}
              title="Edit recommended song custom fields"
            >
              Custom fields
            </Button>
          </>
        )}
        itemDisplayName={(p) => p.name || p.id}
        canDelete={(p) => p.id !== DEFAULT_PROJECT_ID}
        cannotDeleteReason={() => "The default project can't be deleted"}
        deleteConfirmDetails={(p) => {
          const showsInProject = showMetas.filter((s) => s.projectId === p.id).length;
          const hotcardsInProject = hotcards.filter((h) => h.projectId === p.id).length;
          if (showsInProject + hotcardsInProject === 0) return null;
          return (
            <span style={{ color: colors.red }}>
              {showsInProject} show{showsInProject === 1 ? "" : "s"} and{" "}
              {hotcardsInProject} hotcard
              {hotcardsInProject === 1 ? "" : "s"} reference this project and will
              become orphaned. Move them first or they won&apos;t appear in any project
              view.
            </span>
          );
        }}
        emptyMessage={
          <span style={{ color: colors.textDim, fontSize: 13 }}>Loading…</span>
        }
      />
      {dialog}
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
    </>
  );
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
