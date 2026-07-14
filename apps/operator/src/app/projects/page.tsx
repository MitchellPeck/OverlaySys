"use client";

import { useEffect, useState } from "react";
import { Button, colors } from "@overlaysys/ui";
import { DEFAULT_PROJECT_ID, type Project } from "@overlaysys/core";
import { useWs } from "@/lib/useWs";
import { useStore } from "@/lib/store";
import { useDialog } from "@/lib/dialog";
import { ManagementList } from "@/app/components/ManagementList";
import { isCloudMode } from "@/lib/mode";
import {
  deleteProjectCloud,
  refreshProjectsCloud,
  saveProjectCloud,
} from "@/lib/cloudData";
import { CustomFieldSchemaModal } from "./CustomFieldSchemaModal";

/**
 * The Projects page lists every Project for the org and lets the
 * operator create, rename, delete them, and edit their custom-field
 * schemas. Cloud sync (publish + pull) is no longer manual — the
 * SyncEngine in @overlaysys/core handles bidirectional reconciliation
 * on a periodic cadence whenever the desktop is paired to apps-portal.
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
