import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getSessionUser } from "@/lib/auth/session";
import { AdminShell } from "./admin-shell";

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: { index: false, follow: false, noimageindex: true },
  },
};

// Gate for the whole /admin tree. Sends non-platform users to
// /dashboard rather than a visible 403, so the existence of /admin
// isn't advertised to client users who guess the URL.
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSessionUser();
  if (!session) redirect("/login");
  if (!session.account.isPlatform) redirect("/dashboard");

  return <AdminShell>{children}</AdminShell>;
}
