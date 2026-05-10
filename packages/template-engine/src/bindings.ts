export function resolveBinding(
  value: string | { fieldKey: string },
  data: Record<string, string>,
  fallback = "",
): string {
  if (typeof value === "string") return value;
  return data[value.fieldKey] ?? fallback;
}
