"use client";

import { useEffect } from "react";
import "./globals.css";

// Replaces the ENTIRE root layout (including <html>/<body>) when the
// root layout itself throws, so it can't rely on providers the layout
// normally sets up — no NextIntlClientProvider, no ThemeProvider. Text
// is hardcoded pt-BR (DivaryTalk's default/ships-first locale, see
// src/i18n/request.ts) rather than pulled from next-intl.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="pt-BR" data-theme="divarytalk" data-mode="dark" className="h-full antialiased">
      <body className="flex min-h-full items-center justify-center bg-background px-4 py-10 text-foreground">
        <div className="flex w-full max-w-sm flex-col items-center gap-4 rounded-3xl border border-border bg-card p-10 text-center shadow-2xl">
          <div className="flex flex-col gap-1">
            <h1 className="text-lg font-semibold text-foreground">Algo deu errado</h1>
            <p className="text-sm text-muted-foreground">
              A aplicação encontrou um erro inesperado. Tente recarregar a página.
            </p>
            {error.digest && (
              <p className="mt-1 text-xs text-muted-foreground/70">
                Referência do erro: {error.digest}
              </p>
            )}
          </div>
          <button
            onClick={reset}
            className="inline-flex h-8 w-full items-center justify-center rounded-lg bg-primary px-2.5 text-sm font-medium text-primary-foreground transition-all hover:bg-primary/80"
          >
            Recarregar
          </button>
        </div>
      </body>
    </html>
  );
}
