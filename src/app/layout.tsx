import type { Metadata } from "next";
import { Geist, JetBrains_Mono } from "next/font/google";
import "./globals.css";

// Geist Sans stands in for HydraDB's Aeonik, which they ship under a trial
// licence we can't use. Same geometric grotesque skeleton, and it's the
// sibling of the Geist Pixel face carrying our headlines.
const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Pep Talk, the assistant coach that remembers",
  description:
    "A tactical memory graph for lower-division football. Ask what a team was, not just what it is. Built on HydraDB.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-canvas text-chalk">
        {children}
      </body>
    </html>
  );
}
