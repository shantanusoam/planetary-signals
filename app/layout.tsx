import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Planetary Signals — Open-data observatory",
  description:
    "A living interface for earthquakes, natural events, biodiversity, oceans, humanitarian signals, space weather and planetary knowledge.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
