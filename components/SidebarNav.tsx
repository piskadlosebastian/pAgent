"use client";

import clsx from "clsx";
import { FileStack, FileText, Home, Settings, Sparkles, Users } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/dashboard", label: "Strona główna", icon: Home },
  { href: "/children", label: "Dzieci", icon: Users },
  { href: "/new-opinion", label: "Utwórz opinię", icon: Sparkles, featured: true },
  { href: "/templates", label: "Wzory dokumentów", icon: FileStack },
  { href: "/documents", label: "Historia dokumentów", icon: FileText },
  { href: "/settings", label: "Ustawienia", icon: Settings }
];

export function SidebarNav() {
  const pathname = usePathname();

  return (
    <nav className="sidebar-nav" aria-label="Główne menu">
      {items.map((item) => {
        const Icon = item.icon;
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={clsx("sidebar-item", active && "active", item.featured && "featured")}
            aria-label={item.label}
          >
            <Icon size={22} aria-hidden />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
