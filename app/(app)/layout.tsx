import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { AppLogo } from "@/components/AppLogo";
import { BottomNav } from "@/components/BottomNav";
import { SignOutButton } from "@/components/SignOutButton";
import { authOptions } from "@/lib/auth";
import { FileText, Home, Settings, Sparkles, Users } from "lucide-react";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <AppLogo />
        </div>
        <nav className="sidebar-nav">
          <Link href="/dashboard" className="sidebar-item">
            <Home size={20} aria-hidden />
            <span>Dashboard</span>
          </Link>
          <Link href="/children" className="sidebar-item">
            <Users size={20} aria-hidden />
            <span>Dzieci</span>
          </Link>
          <Link href="/documents" className="sidebar-item">
            <FileText size={20} aria-hidden />
            <span>Dokumenty</span>
          </Link>
          <Link href="/new-opinion" className="sidebar-item">
            <Sparkles size={20} aria-hidden />
            <span>Nowa opinia</span>
          </Link>
        </nav>
        <div className="sidebar-footer">
          <Link href="/settings" className="sidebar-item">
            <Settings size={20} aria-hidden />
            <span>Ustawienia</span>
          </Link>
        </div>
      </aside>

      <header className="topbar">
        <div className="topbar-title">
          <div>
            <p>Bezpieczne przygotowywanie projektów opinii PPP</p>
          </div>
        </div>
        <SignOutButton />
      </header>
      <section className="content">{children}</section>
      <BottomNav />
    </main>
  );
}
