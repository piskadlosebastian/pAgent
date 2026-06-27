"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FileStack, FileText, Home, Settings, Sparkles, Users } from "lucide-react";
import clsx from "clsx";

const items = [
  { href: "/dashboard", label: "Start", icon: Home },
  { href: "/children", label: "Dzieci", icon: Users },
  { href: "/new-opinion", label: "Utwórz", icon: Sparkles },
  { href: "/templates", label: "Wzory", icon: FileStack },
  { href: "/documents", label: "Historia", icon: FileText },
  { href: "/settings", label: "Ustawienia", icon: Settings }
];

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="bottom-nav" aria-label="Główne menu">
      {items.map((item) => {
        const Icon = item.icon;
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link key={item.href} href={item.href} className={clsx("nav-item", active && "active")}>
            <Icon size={20} aria-hidden />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
