import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { Building2 } from "lucide-react";

import { db } from "@/db/client";
import { accounts } from "@/db/schema";
import { CreateClientDialog } from "./create-client-dialog";

export default async function AdminClientsPage() {
  const clients = await db
    .select({
      id: accounts.id,
      name: accounts.name,
      maxAgentSeats: accounts.maxAgentSeats,
      createdAt: accounts.createdAt,
    })
    .from(accounts)
    .where(eq(accounts.isPlatform, false))
    .orderBy(desc(accounts.createdAt));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Clientes</h1>
          <p className="text-sm text-muted-foreground">
            Crie e gerencie os clientes conectados à sua VPS.
          </p>
        </div>
        <CreateClientDialog />
      </div>

      {clients.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border py-16 text-center text-muted-foreground">
          <Building2 className="size-8" />
          <p>Nenhum cliente criado ainda.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted text-left text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Cliente</th>
                <th className="px-4 py-3 font-medium">Cota de usuários</th>
                <th className="px-4 py-3 font-medium">Criado em</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {clients.map((client) => (
                <tr key={client.id} className="hover:bg-muted/50">
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/${client.id}`}
                      className="font-medium text-foreground hover:text-primary"
                    >
                      {client.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{client.maxAgentSeats}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {client.createdAt.toLocaleDateString("pt-BR")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
