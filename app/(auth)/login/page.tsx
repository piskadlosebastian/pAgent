"use client";

import { Suspense, useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { AppLogo } from "@/components/AppLogo";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    const formData = new FormData(event.currentTarget);
    const result = await signIn("credentials", {
      email: String(formData.get("email") ?? ""),
      password: String(formData.get("password") ?? ""),
      redirect: false
    });
    setPending(false);

    if (result?.error) {
      setError("Nieprawidłowy email lub hasło.");
      return;
    }
    router.push(searchParams.get("callbackUrl") ?? "/dashboard");
    router.refresh();
  }

  return (
    <main className="auth-shell">
      <form className="login-panel form" onSubmit={handleSubmit}>
        <AppLogo />
        <p className="muted">Bezpieczne tworzenie projektów opinii PPP</p>
        {error ? <div className="alert">{error}</div> : null}
        <div className="field">
          <label htmlFor="email">Email</label>
          <input className="input" id="email" name="email" type="email" autoComplete="email" required />
        </div>
        <div className="field">
          <label htmlFor="password">Hasło</label>
          <input className="input" id="password" name="password" type="password" autoComplete="current-password" required />
        </div>
        <button className="button" type="submit" disabled={pending}>
          {pending ? "Logowanie..." : "Zaloguj"}
        </button>
      </form>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<main className="auth-shell"><div className="login-panel">Ładowanie...</div></main>}>
      <LoginForm />
    </Suspense>
  );
}
