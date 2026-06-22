"use client";

import { signOut } from "next-auth/react";
import { LogOut } from "lucide-react";

export function SignOutButton() {
  return (
    <button className="button secondary" type="button" onClick={() => signOut({ callbackUrl: "/login" })}>
      <LogOut size={18} aria-hidden />
      Wyloguj
    </button>
  );
}
