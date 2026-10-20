"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Client-side redirect for moved routes (the desktop build is a static export, so no server redirects). */
export function RouteRedirect({ to }: { to: string }) {
  const router = useRouter();
  useEffect(() => {
    router.replace(to);
  }, [router, to]);
  return null;
}
