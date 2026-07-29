"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MessageSquare, UsersRound } from "lucide-react";

// `useSearchParams` opts the component out of static prerendering
// unless it sits under a Suspense boundary. We split the form into
// a child component so the outer page can prerender the chrome
// (background, card frame) while the form hydrates with the query
// string on the client.
export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginPageInner />
    </Suspense>
  );
}

function LoginPageInner() {
  const searchParams = useSearchParams();
  // Forwarded from `/join/<token>` when the visitor already has an
  // account. After a successful sign-in we send them to the join
  // page to accept rather than to /dashboard.
  const inviteToken = searchParams.get("invite");
  const t = useTranslations("LoginPage");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setError(data.error || "Não foi possível entrar");
      setLoading(false);
      return;
    }

    if (inviteToken) {
      router.push(`/accept/${encodeURIComponent(inviteToken)}`);
    } else {
      router.push("/dashboard");
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4 py-10">
      {/* "Electric Flow" gradient wash — a static backdrop, not the
       * entrance animation itself, so it never fights
       * prefers-reduced-motion. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(60% 50% at 15% 10%, color-mix(in oklch, var(--primary) 22%, transparent), transparent), radial-gradient(50% 45% at 85% 90%, color-mix(in oklch, var(--chart-2) 20%, transparent), transparent)",
        }}
      />

      <div className="relative flex w-full max-w-4xl overflow-hidden rounded-3xl border border-border bg-card shadow-2xl motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-95 motion-safe:duration-500">
        {/* Brand panel — hidden on small screens, where the form alone
         * carries the identity via the logo mark above it instead. */}
        <div className="relative hidden w-1/2 flex-col justify-between overflow-hidden bg-[linear-gradient(160deg,var(--primary),var(--chart-2))] p-10 text-primary-foreground md:flex motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-left-6 motion-safe:duration-700">
          <div
            aria-hidden
            className="absolute -right-16 -top-16 h-56 w-56 rounded-full bg-white/10 blur-2xl"
          />
          <div
            aria-hidden
            className="absolute -bottom-20 -left-10 h-64 w-64 rounded-full bg-white/10 blur-2xl"
          />
          <div className="relative flex items-center gap-2 font-heading text-lg">
            <span className="flex size-9 items-center justify-center rounded-xl bg-white/15">
              <MessageSquare className="size-5" />
            </span>
            <span>
              <span className="font-extrabold">DIVARY</span>Talk
            </span>
          </div>
          <div className="relative">
            <h2 className="font-heading text-2xl font-semibold leading-tight">
              {t("brandHeadline")}
            </h2>
            <p className="mt-3 max-w-xs text-sm text-primary-foreground/80">
              {t("brandSubheadline")}
            </p>
          </div>
        </div>

        {/* Form panel */}
        <div className="flex w-full flex-col justify-center gap-6 p-8 sm:p-10 md:w-1/2 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-right-6 motion-safe:duration-700">
          <div className="flex flex-col items-center gap-2 text-center md:items-start md:text-left">
            <div className="mb-1 flex size-11 items-center justify-center rounded-xl bg-primary/10 md:hidden">
              {inviteToken ? (
                <UsersRound className="h-5 w-5 text-primary" />
              ) : (
                <MessageSquare className="h-5 w-5 text-primary" />
              )}
            </div>
            <h1 className="font-heading text-xl font-semibold text-foreground">
              {inviteToken ? t("titleAccept") : t("titleWelcome")}
            </h1>
            <p className="text-sm text-muted-foreground">
              {inviteToken ? t("descAccept") : t("descWelcome")}
            </p>
          </div>

          <form onSubmit={handleLogin} className="flex flex-col gap-4">
            {error && (
              <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
                {error}
              </div>
            )}

            <div className="flex flex-col gap-2">
              <Label htmlFor="email" className="text-muted-foreground">
                {t("emailLabel")}
              </Label>
              <Input
                id="email"
                type="email"
                placeholder={t("emailPlaceholder")}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="border-border bg-muted text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-primary/20"
              />
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="password" className="text-muted-foreground">
                  {t("passwordLabel")}
                </Label>
                <Link
                  href="/forgot-password"
                  className="text-sm text-primary hover:text-primary/80"
                >
                  {t("forgotPassword")}
                </Link>
              </div>
              <Input
                id="password"
                type="password"
                placeholder={t("passwordPlaceholder")}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="border-border bg-muted text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-primary/20"
              />
            </div>

            <Button
              type="submit"
              disabled={loading}
              className="mt-2 h-10 w-full bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {loading ? t("signingIn") : t("signIn")}
            </Button>
          </form>

          {/* DivaryTalk provisions every account from the platform
           * side (see AGENTS.md / the closed-provisioning model) —
           * only an invitee with a token gets a "create account"
           * escape hatch here; everyone else is told to ask, not
           * shown a dead-end public signup link. */}
          <p className="text-center text-sm text-muted-foreground md:text-left">
            {inviteToken ? (
              <>
                {t("noAccount")}{" "}
                <Link
                  href={`/accept/${encodeURIComponent(inviteToken)}`}
                  className="text-primary hover:text-primary/80"
                >
                  {t("createAccount")}
                </Link>
              </>
            ) : (
              t("requestAccess")
            )}
          </p>
        </div>
      </div>
    </div>
  );
}
