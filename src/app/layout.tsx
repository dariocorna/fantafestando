import type { Metadata } from "next";
import { Geist, Geist_Mono, Montserrat, Satisfy } from "next/font/google";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const brandDisplay = Montserrat({
  variable: "--font-brand-display",
  subsets: ["latin"],
  weight: ["700", "800"],
});

const brandScript = Satisfy({
  variable: "--font-brand-script",
  subsets: ["latin"],
  weight: ["400"],
});

export const metadata: Metadata = {
  title: "FantaFestando | Cassa e WebApp Ordini",
  description: "Sistema cloud e offline-first per gestire sagre e feste.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${brandDisplay.variable} ${brandScript.variable} antialiased`}
      >
        <TooltipProvider>
          {children}
        </TooltipProvider>
      </body>
    </html>
  );
}
