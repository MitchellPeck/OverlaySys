import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "OverlaySys Operator",
  description: "Broadcast graphics control surface.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
