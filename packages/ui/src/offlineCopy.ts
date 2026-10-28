export function offlineCopy(noun?: string, variant: "empty" | "stale" = "empty"): { title: string; body: string } {
  if (variant === "stale") return { title: "Not connected to the server", body: "Showing what was last loaded." };
  if (noun) return { title: `Can't load ${noun}`, body: "Not connected to the server." };
  return { title: "Not connected to the server", body: "Retrying automatically." };
}
