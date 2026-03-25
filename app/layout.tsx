import type { Metadata } from "next";
import "./globals.css";
import ThemeSync from "./theme-sync";

export const metadata: Metadata = {
  title: "Neurova",
  description: "Neurova - AI Business Manager",
  icons: {
    icon: "/neurova-logo.png",
    shortcut: "/neurova-logo.png",
    apple: "/neurova-logo.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        <ThemeSync />
        {children}
      </body>
    </html>
  );
}
