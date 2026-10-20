"use client";

import { RouteRedirect } from "@/app/components/RouteRedirect";
import { LEGACY_REDIRECTS } from "@/app/shell/areas";

/** Timers now live on the Live console (right rail, "+ New"). */
export default function TimerPage() {
  return <RouteRedirect to={LEGACY_REDIRECTS["/timer"]!} />;
}
