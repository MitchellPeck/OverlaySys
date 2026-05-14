import type { ReactNode } from "react";
import "./globals.css";
import { CloudBoot } from "./components/CloudBoot";

export const metadata = {
  title: "OverlaySys Operator",
  description: "Broadcast graphics control surface.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <CloudBoot>{children}</CloudBoot>
      </body>
    </html>
  );
}
