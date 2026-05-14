"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { v4 as uuid } from "uuid";
import { blankTemplate } from "@overlaysys/editor-kit";
import { Button, EntityList, EntityRow, IconButton, colors } from "@overlaysys/ui";
import { useWs } from "@/lib/useWs";
import { useStore } from "@/lib/store";
import { useDialog } from "@/lib/dialog";
import { downloadJson } from "@/lib/download";
import { AppHeader } from "@/app/components/AppHeader";
import { PageShell, PageBody } from "@/app/components/PageShell";
import { isCloudMode } from "@/lib/mode";
import {
  deleteTemplateCloud,
  getTemplateCloud,
  refreshTemplateMetasCloud,
  saveTemplateCloud,
} from "@/lib/cloudData";

export default function DesignIndexPage() {
  const router = useRouter();
  const { send } = useWs();
  const conn = useStore((s) => s.conn);
  const templates = useStore((s) => s.templates);
  const [busy, setBusy] = useState(false);
  const { alert, confirm, dialog } = useDialog();
  const cloud = isCloudMode();

  async function showError(action: string, err: unknown) {
    const message = err instanceof Error ? err.message : JSON.stringify(err);
    console.warn(`[design] cloud ${action} failed`, err);
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
      refreshTemplateMetasCloud().catch((err) =>
        console.warn("[design] cloud list failed", err),
      );
    } else if (conn === "open") {
      send({ type: "list_templates" });
    }
  }, [cloud, conn, send]);

  async function createNew() {
    if (busy) return;
    setBusy(true);
    const id = `template-${uuid().slice(0, 8)}`;
    const tpl = blankTemplate(id, "Untitled");
    try {
      if (cloud) {
        await saveTemplateCloud(tpl);
        await refreshTemplateMetasCloud();
        router.push(`/design/edit?id=${encodeURIComponent(id)}`);
      } else {
        send({ type: "save_template", template: tpl });
        setTimeout(() => {
          router.push(`/design/edit?id=${encodeURIComponent(id)}`);
        }, 150);
      }
    } catch (err) {
      setBusy(false);
      await showError("create", err);
    }
  }

  async function duplicate(id: string) {
    if (cloud) {
      try {
        const src = await getTemplateCloud(id);
        if (!src) throw new Error("source template not found");
        const copyId = `template-${uuid().slice(0, 8)}`;
        // Editor-kit's blankTemplate isn't quite the right shape for a
        // full duplicate — just spread + new id + " (copy)" name.
        const copy = { ...src, id: copyId, name: `${src.name} (copy)` };
        await saveTemplateCloud(copy);
        await refreshTemplateMetasCloud();
      } catch (err) {
        await showError("duplicate", err);
      }
      return;
    }
    if (conn !== "open") return;
    send({ type: "duplicate_template", templateId: id });
  }

  async function exportTemplate(id: string) {
    if (cloud) {
      try {
        const t = await getTemplateCloud(id);
        if (t) downloadJson(`${id}.json`, t);
      } catch (err) {
        await showError("export", err);
      }
      return;
    }
    const cached = useStore.getState().templateCache[id];
    if (cached) {
      downloadJson(`${id}.json`, cached);
      return;
    }
    if (conn !== "open") return;
    send({ type: "get_template", templateId: id });
    const start = Date.now();
    const tick = () => {
      const c = useStore.getState().templateCache[id];
      if (c) { downloadJson(`${id}.json`, c); return; }
      if (Date.now() - start > 2000) return;
      setTimeout(tick, 50);
    };
    setTimeout(tick, 50);
  }

  async function remove(templateId: string) {
    const ok = await confirm({
      title: "Delete template",
      message: (
        <>
          Delete <strong>{templateId}</strong>? This removes the JSON file.
        </>
      ),
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    if (cloud) {
      try {
        await deleteTemplateCloud(templateId);
        await refreshTemplateMetasCloud();
      } catch (err) {
        await showError("delete", err);
      }
      return;
    }
    send({ type: "delete_template", templateId });
  }

  return (
    <PageShell>
      <AppHeader
        title="Templates"
        actions={
          <Button
            onClick={createNew}
            disabled={(!cloud && conn !== "open") || busy}
            variant="primary"
            size="sm"
          >
            + New template
          </Button>
        }
      />
      <PageBody maxWidth={720}>
          {templates.length === 0 ? (
            <p style={{ color: colors.textDim, fontSize: 13 }}>(loading…)</p>
          ) : (
            <EntityList>
              {templates.map((t) => (
                <EntityRow
                  key={t.id}
                  href={`/design/edit?id=${encodeURIComponent(t.id)}`}
                  primary={t.name}
                  secondary={`${t.id} · ${t.size.w}×${t.size.h}`}
                  actions={
                    <>
                      <Button onClick={() => duplicate(t.id)} size="sm" style={{ width: 84 }}>
                        Duplicate
                      </Button>
                      <Button onClick={() => exportTemplate(t.id)} size="sm" style={{ width: 64 }}>
                        Export
                      </Button>
                      <IconButton
                        onClick={() => remove(t.id)}
                        title="Delete template"
                        size={44}
                        style={{ color: colors.red, fontSize: 16, borderRadius: 6 }}
                      >
                        ×
                      </IconButton>
                    </>
                  }
                />
              ))}
            </EntityList>
          )}
      </PageBody>
      {dialog}
    </PageShell>
  );
}
