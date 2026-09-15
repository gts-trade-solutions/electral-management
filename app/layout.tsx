import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { APP_DESCRIPTION, APP_NAME, APP_TAGLINE } from "@/lib/brand";
import "./globals.css";

const sans = Geist({ subsets: ["latin"], variable: "--font-geist-sans" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });

export const metadata: Metadata = {
  title: { default: `${APP_NAME} · ${APP_TAGLINE}`, template: `%s · ${APP_NAME}` },
  applicationName: APP_NAME,
  description: APP_DESCRIPTION,
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0f172a",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-ZA" className={`${sans.variable} ${mono.variable}`}>
      <body className="min-h-dvh bg-slate-100 font-sans text-slate-900 antialiased">{children}</body>
    </html>
  );
}
