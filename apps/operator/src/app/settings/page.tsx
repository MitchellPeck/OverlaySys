"use client";

import { RouteRedirect } from "@/app/components/RouteRedirect";
import { defaultRouteFor } from "@/app/shell/areas";
import { isCloudMode } from "@/lib/mode";

export default function SettingsIndex() {
  return <RouteRedirect to={defaultRouteFor("settings", isCloudMode())} />;
}
