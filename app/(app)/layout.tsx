import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { AppLogo } from "@/components/AppLogo";
import { BottomNav } from "@/components/BottomNav";
import { SidebarNav } from "@/components/SidebarNav";
import { SignOutButton } from "@/components/SignOutButton";
import { authOptions } from "@/lib/auth";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <Link href="/dashboard" aria-label="pAgent - strona główna">
            <AppLogo compact />
          </Link>
        </div>
        <SidebarNav />
      </aside>

      <header className="topbar">
        <div className="topbar-title" aria-hidden="true" />
        <SignOutButton />
      </header>
      <section className="content">{children}</section>
      <BottomNav />
    </main>
  );
}
