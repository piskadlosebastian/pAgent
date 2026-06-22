"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FileStack, FileText, Home, Settings, Sparkles, Users } from "lucide-react";
import clsx from "clsx";

const items = [
  { href: "/dashboard", label: "Dashboard", icon: Home },
  { href: "/children", label: "Dzieci", icon: Users },
  { href: "/documents", label: "Dokumenty", icon: FileText },
  { href: "/templates", label: "Wzory", icon: FileStack },
  { href: "/new-opinion", label: "Nowa opinia", icon: Sparkles },
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
