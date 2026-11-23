import type { Metadata, Viewport } from "next";
import { Archivo, Manrope, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { getBrand } from "@/lib/brand-server";

const archivo = Archivo({ subsets: ["latin"], variable: "--font-archivo", display: "swap" });
const manrope = Manrope({ subsets: ["latin"], variable: "--font-manrope", display: "swap" });
const jetbrains = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains", display: "swap" });

/** Phones: draw under the notch/home bar (the shell pads with safe-area insets) and
 *  colour the browser bar to match the app. Pinch-zoom stays allowed. */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f8fb" },
    { media: "(prefers-color-scheme: dark)", color: "#111821" },
  ],
};

export async function generateMetadata(): Promise<Metadata> {
  const brand = await getBrand();
  return {
    title: brand.key === "carfectionist" ? "Carfection" : brand.name,
    description: brand.pageDescription,
  };
}

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // data-brand scopes a client's own look (globals.css); Carfectionist and HAZ share the default.
  const brand = await getBrand();
  return (
    <html
      lang="en"
      suppressHydrationWarning
      data-brand={brand.key === "tyrecentre" ? brand.key : undefined}
      className={`${archivo.variable} ${manrope.variable} ${jetbrains.variable} h-full`}
    >
      <body className="min-h-full">{children}</body>
    </html>
  );
}
