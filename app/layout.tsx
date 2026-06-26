import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "MINICHI Helper System",
  description: "Independent MINICHI helper operations system",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-Hant">
      <body>{children}</body>
    </html>
  );
}
