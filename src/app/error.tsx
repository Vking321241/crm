"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { AlertTriangle } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";

export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("ErrorPages");

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4 py-10">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(60% 50% at 15% 10%, color-mix(in oklch, var(--primary) 22%, transparent), transparent), radial-gradient(50% 45% at 85% 90%, color-mix(in oklch, var(--chart-2) 20%, transparent), transparent)",
        }}
      />

      <div className="relative flex w-full max-w-sm flex-col items-center gap-4 rounded-3xl border border-border bg-card p-10 text-center shadow-2xl">
        <div className="flex size-11 items-center justify-center rounded-xl bg-destructive/10">
          <AlertTriangle className="h-5 w-5 text-destructive" />
        </div>
        <div className="flex flex-col gap-1">
          <h1 className="font-heading text-lg font-semibold text-foreground">
            {t("errorTitle")}
          </h1>
          <p className="text-sm text-muted-foreground">{t("errorDescription")}</p>
          {error.digest && (
            <p className="mt-1 text-xs text-muted-foreground/70">
              {t("errorDigest", { digest: error.digest })}
            </p>
          )}
        </div>
        <div className="flex w-full flex-col gap-2">
          <Button onClick={reset} className="w-full">
            {t("errorRetry")}
          </Button>
          <Link href="/dashboard" className={buttonVariants({ variant: "outline", className: "w-full" })}>
            {t("errorHome")}
          </Link>
        </div>
      </div>
    </div>
  );
}
