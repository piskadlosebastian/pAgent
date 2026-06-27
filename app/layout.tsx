import type { Metadata } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin", "latin-ext"],
  variable: "--font-sans",
  display: "swap"
});

export const metadata: Metadata = {
  title: "pAgent",
  description: "Aplikacja do przygotowywania projektów opinii PPP"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pl" className={jakarta.variable}>
      <body>{children}</body>
    </html>
  );
}
