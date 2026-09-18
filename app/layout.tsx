import type { Metadata } from "next";
import { Inter } from "next/font/google";

import { Header } from "@/components/Header";
import { Providers } from "@/components/Providers";
import { BRAND_NAME } from "@/lib/brand";

import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: `${BRAND_NAME} — Instant 3D Print Quotes`,
  description: "Upload a 3D model, get an instant quote, and order professional 3D printed parts.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col font-sans">
        <Providers>
          <Header />
          <main className="flex-1">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
