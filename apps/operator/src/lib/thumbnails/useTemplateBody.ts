"use client";

import { useEffect } from "react";
import type { Template } from "@overlaysys/core";
import { useStore } from "@/lib/store";
import { useWs } from "@/lib/useWs";
import { isCloudMode } from "@/lib/mode";
import { getTemplateCloud } from "@/lib/cloudData";
import { bodyStatus, clearInFlightOnDisconnect, inFlight } from "./templateBodyState";

export function useTemplateBody(templateId: string): {
  template: Template | null;
  status: "loading" | "ready" | "missing";
} {
  const template = useStore((s) => s.templateCache[templateId] ?? null);
  const inList = useStore((s) => s.templates.some((t) => t.id === templateId));
  const listLoaded = useStore((s) => s.templatesLoaded);
  const conn = useStore((s) => s.conn);
  const setTemplate = useStore((s) => s.setTemplate);
  const { send } = useWs();
  const cloud = isCloudMode();

  const status = bodyStatus({ hasBody: !!template, listLoaded, inList });

  useEffect(() => {
    if (!cloud) clearInFlightOnDisconnect(conn);
  }, [conn, cloud]);

  useEffect(() => {
    if (template || status === "missing" || inFlight.has(templateId)) return;
    if (cloud) {
      inFlight.add(templateId);
      getTemplateCloud(templateId)
        .then((t) => {
          if (t) setTemplate(t);
        })
        .catch(() => {})
        .finally(() => inFlight.delete(templateId));
    } else if (conn === "open") {
      inFlight.add(templateId);
      send({ type: "get_template", templateId });
    }
  }, [templateId, template, status, cloud, conn, send, setTemplate]);

  // Local mode: the reply lands in templateCache, which clears the flag.
  useEffect(() => {
    if (template) inFlight.delete(templateId);
  }, [template, templateId]);

  return { template, status };
}
