import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { MessageSquare } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";

export default async function NotFound() {
  const t = await getTranslations("ErrorPages");

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
        <div className="flex size-11 items-center justify-center rounded-xl bg-primary/10">
          <MessageSquare className="h-5 w-5 text-primary" />
        </div>
        <div className="flex flex-col gap-1">
          <p className="font-heading text-3xl font-semibold text-foreground">404</p>
          <h1 className="font-heading text-lg font-semibold text-foreground">
            {t("notFoundTitle")}
          </h1>
          <p className="text-sm text-muted-foreground">{t("notFoundDescription")}</p>
        </div>
        {/* Direct anchor styled via buttonVariants, not <Button asChild> —
            the wacrm Button is the Base UI ButtonPrimitive and has no
            Radix-style asChild slot. */}
        <Link href="/dashboard" className={buttonVariants({ className: "mt-2 w-full" })}>
          {t("notFoundAction")}
        </Link>
      </div>
    </div>
  );
}
