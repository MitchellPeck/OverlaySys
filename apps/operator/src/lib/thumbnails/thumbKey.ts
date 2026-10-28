/** FNV-1a 32-bit hex over template id, updatedAt and the sorted data entries. */
export function thumbKey(
  templateId: string,
  data: Record<string, string>,
  updatedAt?: string,
): string {
  const parts = [templateId, updatedAt ?? ""];
  for (const k of Object.keys(data).sort()) parts.push(k, data[k] ?? "");
  const s = parts.join("\u0000");
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}
