"use client";

/**
 * Trigger a browser download of a JSON-serializable value as a file.
 *
 * Pure client-side — uses Blob + a transient anchor element + revokeObjectURL
 * to release the URL after the click is dispatched.
 */
export function downloadJson(filename: string, value: unknown): void {
  const json = JSON.stringify(value, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
