"use client";

import { useEffect } from "react";
import { toast } from "@overlaysys/ui";
import { RouteRedirect } from "@/app/components/RouteRedirect";
import { LEGACY_REDIRECTS } from "@/app/shell/areas";

/** Timers now live on the Live console (right rail, "+ New"). */
export default function TimerPage() {
  useEffect(() => {
    toast({ message: "Timers are now on the Live page" });
  }, []);
  return <RouteRedirect to={LEGACY_REDIRECTS["/timer"]!} />;
}
