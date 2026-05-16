import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Solar Finance Core · BTC Terminal",
  description: "AI-augmented crypto market terminal — local reasoning layer.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="relative min-h-screen text-solar-bone">
        {/* Content sits above the global overlays (grid, scanlines)
            which use z-index 0/1 in globals.css. */}
        <div className="relative z-10">{children}</div>
      </body>
    </html>
  );
}
