import Link from "next/link";
import { ShieldCheck } from "lucide-react";

// Deliberately minimal and visually distinct from the client
// DashboardShell (no sidebar nav, no per-account chrome) — this is
// the platform owner's operator console, not a tenant's workspace.
export function AdminShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-6 py-4">
        <Link href="/admin" className="flex items-center gap-2 text-foreground">
          <ShieldCheck className="size-5 text-primary" />
          <span className="font-semibold">DivaryTalk — Painel da plataforma</span>
        </Link>
        <Link href="/dashboard" className="text-sm text-muted-foreground hover:text-foreground">
          Ir para meu painel
        </Link>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
    </div>
  );
}
