"use client";

import { memo, useEffect, useRef, useState } from "react";
import { mountTemplate, type MountedTemplate } from "@overlaysys/template-engine";
import { colors } from "@overlaysys/ui";
import { thumbKey } from "./thumbKey";
import { useTemplateBody } from "./useTemplateBody";

export interface TemplateThumbnailProps {
  templateId: string;
  data: Record<string, string>;
  width: number;
  label?: string;
}

function TemplateThumbnailImpl({ templateId, data, width, label }: TemplateThumbnailProps) {
  const { template, status } = useTemplateBody(templateId);
  const boxRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef<{ m: MountedTemplate; updatedAt?: string; id: string; host: HTMLElement } | null>(null);
  const [visible, setVisible] = useState(false);

  const size = template?.size ?? { w: 16, h: 9 };
  const height = Math.round((width * size.h) / size.w);
  const scale = width / size.w;

  // Lazy mount: first intersection only, then stays mounted.
  useEffect(() => {
    const el = boxRef.current;
    if (!el || visible) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [visible, status]);

  useEffect(() => {
    if (!visible || !template || !stageRef.current) return;
    const cur = mountedRef.current;
    if (
      cur &&
      cur.host === stageRef.current &&
      cur.id === template.id &&
      cur.updatedAt === template.updatedAt
    ) {
      cur.m.update(data);
      cur.m.scrub("out", 0);
      return;
    }
    if (cur) {
      cur.m.destroy();
      mountedRef.current = null;
    }
    // static: no perpetual rAF ticker; the thumbnail stays parked on its pose.
    const m = mountTemplate(stageRef.current, template, data, { mode: "live", static: true });
    m.scrub("out", 0);
    mountedRef.current = {
      m,
      updatedAt: template.updatedAt,
      id: template.id,
      host: stageRef.current,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, template, thumbKey(templateId, data, template?.updatedAt)]);

  useEffect(
    () => () => {
      mountedRef.current?.m.destroy();
      mountedRef.current = null;
    },
    [],
  );

  if (status === "missing") {
    return (
      <div
        ref={boxRef}
        style={{
          width,
          height,
          background: colors.surface2,
          color: colors.textMuted,
          fontSize: 11,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        Missing template
      </div>
    );
  }
  if (!template) {
    return <div ref={boxRef} style={{ width, height, background: colors.surface3 }} />;
  }

  return (
    <div
      ref={boxRef}
      role="img"
      aria-label={label ?? `${template.name} preview`}
      style={{ width, height, background: "#000", position: "relative", overflow: "hidden" }}
    >
      <div
        ref={stageRef}
        aria-hidden
        style={{
          width: size.w,
          height: size.h,
          transform: `scale(${scale})`,
          transformOrigin: "0 0",
          pointerEvents: "none",
          position: "absolute",
          top: 0,
          left: 0,
        }}
      />
    </div>
  );
}

export const TemplateThumbnail = memo(
  TemplateThumbnailImpl,
  (a, b) => a.width === b.width && a.templateId === b.templateId && a.label === b.label &&
    thumbKey(a.templateId, a.data) === thumbKey(b.templateId, b.data),
);
