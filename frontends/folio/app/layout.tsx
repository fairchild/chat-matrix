import type { Metadata } from "next";
import { IBM_Plex_Mono, Newsreader } from "next/font/google";
import { themeInitScript } from "@fairchild/folio/theme";

import "@fairchild/folio/styles.css";
import "./globals.css";
import { HostBar } from "@/components/host-bar";
import { ThemeHotkey } from "@/components/theme-hotkey";

// Hosts load fonts; Folio only names the two tokens it resolves through. These
// are the demo's pair, so the cell and the package's own surface set the same
// type — see --folio-font-serif / --folio-font-mono in globals.css.
const serif = Newsreader({ subsets: ["latin"], variable: "--font-newsreader" });

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-plex-mono",
});

export const metadata: Metadata = {
  title: "folio × chat-stack",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // Folio owns the theme: this script resolves hash > stored > OS and writes
    // data-theme before first paint, which is the attribute the package's light
    // and dark palettes key off. It runs ahead of hydration, so React has to be
    // told the attribute it finds is not a mismatch.
    <html
      lang="en"
      suppressHydrationWarning
      className={`${serif.variable} ${mono.variable}`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>
        <ThemeHotkey />
        <HostBar />
        {children}
      </body>
    </html>
  );
}
