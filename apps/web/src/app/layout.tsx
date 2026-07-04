import type { Metadata } from "next";
import "./globals.css";

// NOTE: Fonts are a self-contained system stack (see globals.css) so the build
// never depends on a live Google Fonts fetch. Restoring self-hosted Archivo +
// IBM Plex (next/font/local) is a follow-up once the network is stable.

export const metadata: Metadata = {
  title: "Carfectionist",
  description: "Carfectionist — detailing studio management",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
