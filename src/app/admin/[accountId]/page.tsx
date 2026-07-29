import Link from "next/link";
import { notFound } from "next/navigation";
import { and, count, eq } from "drizzle-orm";
import { ArrowLeft } from "lucide-react";

import { db } from "@/db/client";
import { accounts, users } from "@/db/schema";
import { ConnectInstanceCard } from "@/components/whatsapp/connect-instance-card";
import { SeatsEditor } from "./seats-editor";

export default async function AdminClientDetailPage({
  params,
}: {
  params: Promise<{ accountId: string }>;
}) {
  const { accountId } = await params;

  const [account] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.isPlatform, false)))
    .limit(1);

  if (!account) notFound();

  const [{ value: memberCount }] = await db
    .select({ value: count() })
    .from(users)
    .where(eq(users.accountId, accountId));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href="/admin"
          className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Clientes
        </Link>
        <h1 className="text-xl font-semibold text-foreground">{account.name}</h1>
        <p className="text-sm text-muted-foreground">
          {memberCount} usuário(s) de {account.maxAgentSeats} vaga(s)
        </p>
      </div>

      <div className="grid gap-6 sm:grid-cols-2">
        <ConnectInstanceCard accountId={account.id} />
        <SeatsEditor accountId={account.id} initialSeats={account.maxAgentSeats} />
      </div>
    </div>
  );
}
