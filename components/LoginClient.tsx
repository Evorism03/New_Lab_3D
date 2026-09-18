"use client";

import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

import type { Dictionary } from "@/lib/i18n/translations";

function LoginForm({ dict }: { dict: Dictionary }) {
  const t = dict.login;
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") ?? "/admin/orders";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);

    const result = await signIn("credentials", { email, password, redirect: false });
    if (result?.error) {
      setError(t.invalidCredentials);
      setIsSubmitting(false);
      return;
    }
    router.push(callbackUrl);
    router.refresh();
  };

  return (
    <div className="mx-auto max-w-sm px-6 py-24">
      <h1 className="text-2xl font-bold text-text">{t.title}</h1>
      <form onSubmit={handleSubmit} className="mt-8 space-y-4">
        <div>
          <label className="block text-sm font-medium text-text">{t.usernameLabel}</label>
          <input
            required
            type="text"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-text">{t.passwordLabel}</label>
          <input
            required
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full px-3 py-2 text-sm"
          />
        </div>
        {error && <p className="text-sm text-danger">{error}</p>}
        <button type="submit" disabled={isSubmitting} className="btn btn-primary w-full">
          {t.signIn}
        </button>
      </form>
    </div>
  );
}

export function LoginClient({ dict }: { dict: Dictionary }) {
  return (
    <Suspense fallback={null}>
      <LoginForm dict={dict} />
    </Suspense>
  );
}
