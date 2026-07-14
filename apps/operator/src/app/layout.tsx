import type { ReactNode } from "react";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";
import { CloudBoot } from "./components/CloudBoot";
import { AppShell } from "./shell/AppShell";

export const metadata = {
  title: "OverlaySys Operator",
  description: "Broadcast graphics control surface.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body>
        <CloudBoot>
          <AppShell>{children}</AppShell>
        </CloudBoot>
      </body>
    </html>
  );
}
