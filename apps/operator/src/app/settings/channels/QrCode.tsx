"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";

/** Client-side QR (SVG) of `value`, white background + quiet zone for dark-mode scanning. */
export function QrCode({ value, size = 160 }: { value: string; size?: number }) {
  const [svg, setSvg] = useState<string>("");
  useEffect(() => {
    let cancelled = false;
    QRCode.toString(value, { type: "svg", margin: 2 })
      .then((s) => {
        if (!cancelled) setSvg(s);
      })
      .catch(() => {
        if (!cancelled) setSvg("");
      });
    return () => {
      cancelled = true;
    };
  }, [value]);
  if (!svg) return null;
  return (
    <div
      role="img"
      aria-label={`QR code for ${value}`}
      style={{ width: size, height: size, background: "#fff", borderRadius: 4, lineHeight: 0 }}
      // Our own URL in, qrcode's path-only SVG out.
      dangerouslySetInnerHTML={{ __html: svg.replace("<svg ", `<svg width="${size}" height="${size}" `) }}
    />
  );
}
