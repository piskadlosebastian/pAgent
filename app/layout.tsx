import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "pAgent",
  description: "Aplikacja do przygotowywania projektów opinii PPP"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pl">
      <body>{children}</body>
    </html>
  );
}
