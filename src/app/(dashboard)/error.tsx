"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function DashboardError({
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
    <div className="flex h-full min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
      <div className="flex size-11 items-center justify-center rounded-xl bg-destructive/10">
        <AlertTriangle className="h-5 w-5 text-destructive" />
      </div>
      <div className="flex flex-col gap-1">
        <h1 className="font-heading text-lg font-semibold text-foreground">
          {t("errorTitle")}
        </h1>
        <p className="max-w-sm text-sm text-muted-foreground">{t("errorDescription")}</p>
        {error.digest && (
          <p className="mt-1 text-xs text-muted-foreground/70">
            {t("errorDigest", { digest: error.digest })}
          </p>
        )}
      </div>
      <Button onClick={reset}>{t("errorRetry")}</Button>
    </div>
  );
}
