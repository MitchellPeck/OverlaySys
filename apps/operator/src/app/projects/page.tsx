"use client";

import { useEffect, useState } from "react";
import {
  Button,
  EntityList,
  EntityRow,
  IconButton,
  Input,
  colors,
} from "@overlaysys/ui";
import { DEFAULT_PROJECT_ID, type Project } from "@overlaysys/core";
import { useWs } from "@/lib/useWs";
import { useStore } from "@/lib/store";
import { useDialog } from "@/lib/dialog";
import { AppHeader } from "@/app/components/AppHeader";
import { PageShell, PageBody } from "@/app/components/PageShell";
import { CloudPullModal } from "@/app/projects/CloudPullModal";
import { isCloudMode } from "@/lib/mode";
import {
  deleteProjectCloud,
  refreshProjectsCloud,
  saveProjectCloud,
} from "@/lib/cloudData";
import { isElectron } from "@/lib/desktop";
import {
  publishProjectToCloud,
} from "@/lib/projectSync";
import { defaultServerUrl } from "@/lib/wsClient";
import { hasCloudSessionHint } from "@/lib/cloudSession";

/**
 * The Projects page lists every Project in the local data dir and lets the
 * operator create, rename, and delete them. A Project groups Shows + Hotcards
 * for an ongoing event series; Songs and Templates are shared org-wide and
 * are not project-scoped today.
 */
function httpBase(): string {
  try {
    const u = new URL(defaultServerUrl());
    const proto = u.protocol === "wss:" ? "https:" : "http:";
    return `${proto}//${u.host}`;
  } catch {
    return typeof window !== "undefined" ? window.location.origin : "";
  }
}

export default function ProjectsIndexPage() {
  const { send } = useWs();
  const conn = useStore((s) => s.conn);
  const projects = useStore((s) => s.projects);
  const currentProjectId = useStore((s) => s.currentProjectId);
  const setCurrentProjectId = useStore((s) => s.setCurrentProjectId);
  const showMetas = useStore((s) => s.showMetas);
  const hotcards = useStore((s) => s.hotcards);
  const { alert, confirm, prompt, dialog } = useDialog();
  const cloud = isCloudMode();

  async function showError(action: string, err: unknown) {
    const message =
      err instanceof Error ? err.message : JSON.stringify(err);
    console.warn(`[projects] cloud ${action} failed`, err);
    await alert({
      title: `Cloud ${action} failed`,
      message: (
        <pre
          style={{
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            fontSize: 12,
            margin: 0,
          }}
        >
          {message}
        </pre>
      ),
    });
  }

  useEffect(() => {
    if (cloud) {
      // No WS in cloud mode — pull projects directly from Supabase. The
      // call is fire-and-forget; refreshProjectsCloud pushes into the
      // same Zustand slice that the WS message would have populated, so
      // the rest of this component reads from `projects` either way.
      refreshProjectsCloud().catch((err) =>
        console.warn("[projects] cloud list failed", err),
      );
    } else if (conn === "open") {
      send({ type: "list_projects" });
    }
  }, [cloud, conn, send]);

  async function newProject() {
    const name = await prompt({
      title: "New project",
      message: "Name this project",
      placeholder: "e.g. Christmas Eve",
      confirmLabel: "Create",
    });
    if (!name) return;
    const id = slugify(name);
    if (!id) return;
    const now = new Date().toISOString();
    const project: Project = {
      id,
      name,
      createdAt: now,
      updatedAt: now,
    };
    if (cloud) {
      try {
        await saveProjectCloud(project);
        await refreshProjectsCloud();
        setCurrentProjectId(id);
      } catch (err) {
        await showError("create", err);
      }
    } else {
      send({ type: "save_project", project });
      setCurrentProjectId(id);
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

  async function remove(p: Project) {
    if (p.id === DEFAULT_PROJECT_ID) return; // can't delete the seeded default
    const showsInProject = showMetas.filter((s) => s.projectId === p.id).length;
    const hotcardsInProject = hotcards.filter((h) => h.projectId === p.id).length;
    const ok = await confirm({
      title: "Delete project",
      message: (
        <>
          Delete <strong>{p.name}</strong>?
          {showsInProject + hotcardsInProject > 0 && (
            <>
              <br />
              <span style={{ color: colors.red }}>
                {showsInProject} show{showsInProject === 1 ? "" : "s"} and{" "}
                {hotcardsInProject} hotcard
                {hotcardsInProject === 1 ? "" : "s"} reference this project and
                will become orphaned. Move them first or they won't appear in any
                project view.
              </span>
            </>
          )}
        </>
      ),
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    if (cloud) {
      try {
        await deleteProjectCloud(p.id);
        await refreshProjectsCloud();
      } catch (err) {
        await showError("delete", err);
      }
    } else {
      send({ type: "delete_project", projectId: p.id });
    }
    if (currentProjectId === p.id) setCurrentProjectId(DEFAULT_PROJECT_ID);
  }

  // ── Cloud publish/pull (Electron + signed-in only) ──────────────────
  // These are absent in the cloud-mode operator (data already lives in
  // the cloud) and in the web operator without a paired device.
  const inElectron = isElectron();
  const cloudReady = inElectron && hasCloudSessionHint();
  const [syncBusy, setSyncBusy] = useState<string | null>(null);
  const [pullOpen, setPullOpen] = useState(false);

  async function publishToCloud(p: Project) {
    if (syncBusy) return;
    setSyncBusy(`publish:${p.id}`);
    try {
      // Pre-publish: make sure the local store has every show/hotcard +
      // their referenced templates/songs cached. Without this the
      // dependency walk drops entities that haven't been opened yet.
      if (conn === "open") {
        for (const s of showMetas.filter((s) => s.projectId === p.id)) {
          send({ type: "get_show", showId: s.id });
        }
        for (const h of hotcards.filter((h) => h.projectId === p.id)) {
          send({ type: "get_hotcard", hotcardId: h.id });
        }
        send({ type: "list_templates" });
        send({ type: "list_songs" });
        // Let the WS replies settle. Crude but good enough for a
        // user-clickable button — proper progress tracking is Phase 4.4+.
        await new Promise((r) => setTimeout(r, 750));
      }
      const result = await publishProjectToCloud(p.id);
      await alert({
        title: result.ok ? "Published to cloud" : "Published with errors",
        message: (
          <div style={{ fontSize: 12, lineHeight: 1.5 }}>
            {Object.entries(result.counts).map(([k, v]) => (
              <div key={k}>
                {k}: {v}
              </div>
            ))}
            {result.errors.length > 0 && (
              <details style={{ marginTop: 8 }}>
                <summary style={{ cursor: "pointer", color: colors.red }}>
                  {result.errors.length} error
                  {result.errors.length === 1 ? "" : "s"}
                </summary>
                <pre style={{ whiteSpace: "pre-wrap", fontSize: 11 }}>
                  {result.errors
                    .map((e) => `[${e.kind}:${e.id}] ${e.message}`)
                    .join("\n")}
                </pre>
              </details>
            )}
          </div>
        ),
      });
    } catch (err) {
      await showError("publish", err);
    } finally {
      setSyncBusy(null);
    }
  }

  function openPullModal() {
    setPullOpen(true);
  }

  function onPullDone() {
    // Refresh local meta lists once the modal reports success.
    send({ type: "list_projects" });
    send({ type: "list_shows" });
    send({ type: "list_hotcards" });
    send({ type: "list_templates" });
    send({ type: "list_songs" });
  }

  return (
    <PageShell>
      <AppHeader
        title="Projects"
        actions={
          <Button
            onClick={newProject}
            disabled={!cloud && conn !== "open"}
            variant="primary"
            size="sm"
          >
            + New Project
          </Button>
        }
      />
      <PageBody maxWidth={720}>
          {cloudReady && (
            <div
              style={{
                marginBottom: 16,
                padding: "10px 12px",
                background: "var(--panel-2)",
                border: "1px solid var(--border)",
                borderRadius: 6,
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontSize: 12,
              }}
            >
              <span style={{ color: "var(--text-dim)" }}>☁ Cloud sync:</span>
              <Button
                size="sm"
                onClick={openPullModal}
                disabled={syncBusy !== null || pullOpen}
              >
                Pull from cloud
              </Button>
              <span style={{ color: "var(--text-dim)", flex: 1 }}>
                {syncBusy?.startsWith("publish:")
                  ? "Publishing…"
                  : "Use the row's Publish button to push a project to the cloud."}
              </span>
            </div>
          )}
          {projects.length === 0 ? (
            <p style={{ color: colors.textDim, fontSize: 13 }}>Loading…</p>
          ) : (
            <EntityList>
              {projects.map((p) => {
                const showCount = showMetas.filter(
                  (s) => s.projectId === p.id,
                ).length;
                const hotcardCount = hotcards.filter(
                  (h) => h.projectId === p.id,
                ).length;
                const isDefault = p.id === DEFAULT_PROJECT_ID;
                const isCurrent = p.id === currentProjectId;
                return (
                  <EntityRow
                    key={p.id}
                    primary={
                      <>
                        {p.name}
                        {isCurrent && (
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
                    }
                    secondary={`${p.id} · ${showCount} show${showCount === 1 ? "" : "s"}, ${hotcardCount} hotcard${hotcardCount === 1 ? "" : "s"}`}
                    actions={
                      <>
                        {cloudReady && (
                          <Button
                            onClick={() => publishToCloud(p)}
                            size="sm"
                            style={{ width: 92 }}
                            disabled={syncBusy !== null}
                          >
                            {syncBusy === `publish:${p.id}` ? "…" : "Publish"}
                          </Button>
                        )}
                        {!isCurrent && (
                          <Button
                            onClick={() => setCurrentProjectId(p.id)}
                            size="sm"
                            style={{ width: 88 }}
                          >
                            Switch to
                          </Button>
                        )}
                        <Button
                          onClick={() => rename(p)}
                          size="sm"
                          style={{ width: 70 }}
                        >
                          Rename
                        </Button>
                        <IconButton
                          onClick={() => remove(p)}
                          title={
                            isDefault
                              ? "The default project can't be deleted"
                              : "Delete project"
                          }
                          size={44}
                          disabled={isDefault}
                          style={{
                            color: isDefault ? colors.textDim : colors.red,
                            fontSize: 16,
                            borderRadius: 6,
                          }}
                        >
                          ×
                        </IconButton>
                      </>
                    }
                  />
                );
              })}
            </EntityList>
          )}
      </PageBody>
      {pullOpen && (
        <CloudPullModal
          onClose={() => setPullOpen(false)}
          onSuccess={onPullDone}
        />
      )}
      {dialog}
    </PageShell>
  );
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
