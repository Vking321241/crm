"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, Loader2, QrCode, RefreshCw, Unplug } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type InstanceStatus = "not_created" | "qrcode" | "connecting" | "connected" | "disconnected";

interface StatusResponse {
  status: InstanceStatus;
  phoneNumber?: string | null;
  error?: string;
}

interface ConnectResponse {
  qrCodeBase64: string | null;
  pairingCode: string | null;
  status: InstanceStatus;
  error?: string;
}

const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 120000;

/**
 * Renders the "connect your WhatsApp" flow: a QR code the client
 * scans from their phone, polling until UAZAPI reports `connected`.
 *
 * Reused in two places:
 *   - src/app/(dashboard)/settings — no `accountId`, operates on
 *     the logged-in admin's own account (server resolves this via
 *     `resolveInstanceAccountId`).
 *   - src/app/admin/[accountId] — platform owner passes the
 *     selected client's `accountId` explicitly.
 */
export function ConnectInstanceCard({ accountId }: { accountId?: string }) {
  const [status, setStatus] = useState<InstanceStatus>("not_created");
  const [phoneNumber, setPhoneNumber] = useState<string | null>(null);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollDeadline = useRef<number>(0);

  const stopPolling = useCallback(() => {
    if (pollTimer.current) {
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
  }, []);

  const fetchStatus = useCallback(async () => {
    const qs = accountId ? `?accountId=${encodeURIComponent(accountId)}` : "";
    const res = await fetch(`/api/whatsapp/instance/status${qs}`, { cache: "no-store" });
    const data = (await res.json()) as StatusResponse;
    if (!res.ok) {
      toast.error(data.error || "Falha ao consultar status da instância");
      return;
    }
    setStatus(data.status);
    setPhoneNumber(data.phoneNumber ?? null);
    if (data.status === "connected") {
      setQrCode(null);
      stopPolling();
      toast.success("WhatsApp conectado com sucesso");
    } else if (Date.now() > pollDeadline.current) {
      stopPolling();
    }
  }, [accountId, stopPolling]);

  useEffect(() => {
    void fetchStatus();
    return () => stopPolling();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId]);

  const handleConnect = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/whatsapp/instance/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(accountId ? { accountId } : {}),
      });
      const data = (await res.json()) as ConnectResponse;
      if (!res.ok) {
        toast.error(data.error || "Falha ao gerar o QR code");
        return;
      }
      setQrCode(data.qrCodeBase64);
      setStatus("qrcode");
      pollDeadline.current = Date.now() + POLL_TIMEOUT_MS;
      stopPolling();
      pollTimer.current = setInterval(() => void fetchStatus(), POLL_INTERVAL_MS);
    } finally {
      setLoading(false);
    }
  }, [accountId, fetchStatus, stopPolling]);

  const isConnected = status === "connected";

  return (
    <Card className="border-border bg-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-foreground">
          <QrCode className="size-5 text-primary" />
          Conexão do WhatsApp
        </CardTitle>
        <CardDescription className="text-muted-foreground">
          {isConnected
            ? `Conectado${phoneNumber ? ` — ${phoneNumber}` : ""}`
            : "Escaneie o QR code com o WhatsApp do cliente (Aparelhos conectados) para ativar o atendimento."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col items-center gap-4">
        {isConnected ? (
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <CheckCircle2 className="size-10 text-primary" />
            <p className="text-sm text-muted-foreground">
              O WhatsApp deste cliente está conectado e recebendo mensagens.
            </p>
          </div>
        ) : qrCode ? (
          <div className="flex flex-col items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`data:image/png;base64,${qrCode}`}
              alt="QR code para conectar o WhatsApp"
              className="size-56 rounded-lg border border-border bg-white p-2"
            />
            <p className="text-xs text-muted-foreground">
              Aguardando leitura… atualiza automaticamente.
            </p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 py-6 text-center text-sm text-muted-foreground">
            <Unplug className="size-8" />
            <p>Nenhum QR code ativo no momento.</p>
          </div>
        )}

        <Button
          onClick={handleConnect}
          disabled={loading || isConnected}
          className="w-full bg-primary text-primary-foreground hover:bg-primary/90"
        >
          {loading ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              Gerando QR code…
            </>
          ) : (
            <>
              <RefreshCw className="size-4" />
              {qrCode ? "Gerar novo QR code" : "Conectar WhatsApp"}
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
