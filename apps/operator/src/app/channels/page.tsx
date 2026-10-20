"use client";

import { RouteRedirect } from "@/app/components/RouteRedirect";
import { LEGACY_REDIRECTS } from "@/app/shell/areas";

export default function ChannelsRedirect() {
  return <RouteRedirect to={LEGACY_REDIRECTS["/channels"]!} />;
}
