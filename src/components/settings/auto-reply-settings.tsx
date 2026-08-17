'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, MessageSquareText, Clock, PlaneTakeoff } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { canEditSettings } from '@/lib/auth/roles';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { SettingsPanelHead } from './settings-panel-head';
import type { BusinessHours } from '@/lib/auto-reply/auto-reply-rules';

const DAYS: { key: keyof BusinessHours; label: string }[] = [
  { key: 'mon', label: 'Segunda' },
  { key: 'tue', label: 'Terça' },
  { key: 'wed', label: 'Quarta' },
  { key: 'thu', label: 'Quinta' },
  { key: 'fri', label: 'Sexta' },
  { key: 'sat', label: 'Sábado' },
  { key: 'sun', label: 'Domingo' },
];

const DEFAULT_HOURS: BusinessHours = {
  mon: { enabled: true, start: '09:00', end: '18:00' },
  tue: { enabled: true, start: '09:00', end: '18:00' },
  wed: { enabled: true, start: '09:00', end: '18:00' },
  thu: { enabled: true, start: '09:00', end: '18:00' },
  fri: { enabled: true, start: '09:00', end: '18:00' },
  sat: { enabled: false, start: '09:00', end: '13:00' },
  sun: { enabled: false, start: '09:00', end: '13:00' },
};

interface ApiShape {
  welcome_enabled: boolean;
  welcome_message: string;
  after_hours_enabled: boolean;
  after_hours_message: string;
  business_hours: BusinessHours;
  away_enabled: boolean;
  away_message: string;
  auto_pause_outside_business_hours: boolean;
}

export function AutoReplySettings() {
  const { accountId, accountRole, profileLoading } = useAuth();
  const canEdit = accountRole ? canEditSettings(accountRole) : false;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [welcomeEnabled, setWelcomeEnabled] = useState(true);
  const [welcomeMessage, setWelcomeMessage] = useState('');
  const [afterHoursEnabled, setAfterHoursEnabled] = useState(true);
  const [afterHoursMessage, setAfterHoursMessage] = useState('');
  const [businessHours, setBusinessHours] = useState<BusinessHours>(DEFAULT_HOURS);
  const [awayEnabled, setAwayEnabled] = useState(false);
  const [awayMessage, setAwayMessage] = useState('');
  const [autoPause, setAutoPause] = useState(false);

  const loadedAccountIdRef = useRef<string | null>(null);

  const fetchConfig = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/settings/auto-reply');
      const data = (await res.json()) as ApiShape & { error?: string };
      if (!res.ok) {
        toast.error(data.error ?? 'Não foi possível carregar as configurações.');
        return;
      }
      setWelcomeEnabled(data.welcome_enabled);
      setWelcomeMessage(data.welcome_message);
      setAfterHoursEnabled(data.after_hours_enabled);
      setAfterHoursMessage(data.after_hours_message);
      setBusinessHours(data.business_hours ?? DEFAULT_HOURS);
      setAwayEnabled(data.away_enabled);
      setAwayMessage(data.away_message);
      setAutoPause(data.auto_pause_outside_business_hours ?? false);
    } catch {
      toast.error('Não foi possível carregar as configurações.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!accountId || loadedAccountIdRef.current === accountId) return;
    loadedAccountIdRef.current = accountId;
    void fetchConfig();
  }, [accountId, fetchConfig]);

  const setDay = (key: keyof BusinessHours, patch: Partial<BusinessHours[keyof BusinessHours]>) => {
    setBusinessHours((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  };

  const handleSave = async () => {
    if (!welcomeMessage.trim() || !afterHoursMessage.trim() || !awayMessage.trim()) {
      toast.error('Preencha o texto de todas as mensagens.');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/settings/auto-reply', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          welcome_enabled: welcomeEnabled,
          welcome_message: welcomeMessage.trim(),
          after_hours_enabled: afterHoursEnabled,
          after_hours_message: afterHoursMessage.trim(),
          business_hours: businessHours,
          away_enabled: awayEnabled,
          away_message: awayMessage.trim(),
          auto_pause_outside_business_hours: autoPause,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success('Configurações salvas.');
      } else {
        toast.error(data.error ?? 'Falha ao salvar.');
      }
    } catch {
      toast.error('Falha ao salvar.');
    } finally {
      setSaving(false);
    }
  };

  if (loading || profileLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Carregando...
      </div>
    );
  }

  const disabled = !canEdit || saving;

  return (
    <div>
      <SettingsPanelHead
        title="Mensagens automáticas"
        description="Mensagens enviadas automaticamente pelo WhatsApp, sem IA — baseadas em regras simples."
      />

      {!canEdit && (
        <p className="mb-4 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          Apenas administradores podem editar estas configurações.
        </p>
      )}

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <PlaneTakeoff className="h-4 w-4 text-primary" /> Ausência / fechado temporariamente
            </CardTitle>
            <CardDescription>
              Prioridade máxima: enquanto ativo, esta mensagem é enviada para toda conversa nova, ignorando horário e boas-vindas. Use para férias, recesso ou feriado.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
              <div>
                <p className="text-sm font-medium text-foreground">Ativar mensagem de ausência</p>
                <p className="text-xs text-muted-foreground">Lembre de desativar quando voltar a atender.</p>
              </div>
              <Switch checked={awayEnabled} onCheckedChange={setAwayEnabled} disabled={disabled} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="away-message">Mensagem</Label>
              <Textarea
                id="away-message"
                value={awayMessage}
                onChange={(e) => setAwayMessage(e.target.value)}
                rows={3}
                disabled={disabled}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <MessageSquareText className="h-4 w-4 text-primary" /> Mensagem de boas-vindas
            </CardTitle>
            <CardDescription>Enviada automaticamente na primeira mensagem de um contato novo.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
              <div>
                <p className="text-sm font-medium text-foreground">Ativar boas-vindas</p>
              </div>
              <Switch checked={welcomeEnabled} onCheckedChange={setWelcomeEnabled} disabled={disabled} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="welcome-message">Mensagem</Label>
              <Textarea
                id="welcome-message"
                value={welcomeMessage}
                onChange={(e) => setWelcomeMessage(e.target.value)}
                rows={3}
                disabled={disabled}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Clock className="h-4 w-4 text-primary" /> Fora do horário de atendimento
            </CardTitle>
            <CardDescription>Enviada quando um cliente escreve fora do horário configurado abaixo.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
              <div>
                <p className="text-sm font-medium text-foreground">Ativar mensagem fora do horário</p>
              </div>
              <Switch checked={afterHoursEnabled} onCheckedChange={setAfterHoursEnabled} disabled={disabled} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="after-hours-message">Mensagem</Label>
              <Textarea
                id="after-hours-message"
                value={afterHoursMessage}
                onChange={(e) => setAfterHoursMessage(e.target.value)}
                rows={3}
                disabled={disabled}
              />
            </div>

            <div className="space-y-2">
              <Label>Horário de atendimento</Label>
              <div className="space-y-2">
                {DAYS.map(({ key, label }) => {
                  const day = businessHours[key];
                  const hasBreak = day.breakStart !== undefined && day.breakEnd !== undefined;
                  return (
                    <div key={key} className="rounded-md border border-border p-2">
                      <div className="flex flex-wrap items-center gap-3">
                        <Switch
                          checked={day.enabled}
                          onCheckedChange={(v) => setDay(key, { enabled: v })}
                          disabled={disabled}
                        />
                        <span className="w-20 text-sm text-foreground">{label}</span>
                        <Input
                          type="time"
                          value={day.start}
                          onChange={(e) => setDay(key, { start: e.target.value })}
                          disabled={disabled || !day.enabled}
                          className="w-28"
                        />
                        <span className="text-xs text-muted-foreground">até</span>
                        <Input
                          type="time"
                          value={day.end}
                          onChange={(e) => setDay(key, { end: e.target.value })}
                          disabled={disabled || !day.enabled}
                          className="w-28"
                        />
                      </div>
                      {day.enabled && (
                        <div className="mt-2 flex flex-wrap items-center gap-3 pl-[3.75rem]">
                          <label className="flex items-center gap-2 text-xs text-muted-foreground">
                            <Switch
                              checked={hasBreak}
                              onCheckedChange={(v) =>
                                setDay(
                                  key,
                                  v
                                    ? { breakStart: '12:00', breakEnd: '13:00' }
                                    : { breakStart: undefined, breakEnd: undefined },
                                )
                              }
                              disabled={disabled}
                            />
                            Intervalo de almoço
                          </label>
                          {hasBreak && (
                            <>
                              <Input
                                type="time"
                                value={day.breakStart}
                                onChange={(e) => setDay(key, { breakStart: e.target.value })}
                                disabled={disabled}
                                className="w-28"
                              />
                              <span className="text-xs text-muted-foreground">até</span>
                              <Input
                                type="time"
                                value={day.breakEnd}
                                onChange={(e) => setDay(key, { breakEnd: e.target.value })}
                                disabled={disabled}
                                className="w-28"
                              />
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="flex items-center justify-between gap-4 rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
              <div>
                <p className="text-sm font-medium text-foreground">
                  Pausar atendimentos automaticamente fora do horário
                </p>
                <p className="text-xs text-muted-foreground">
                  Conversas abertas são pausadas fora do horário acima (após o expediente, no
                  almoço) e retomam sozinhas quando o horário voltar — pedindo confirmação do
                  atendente.
                </p>
              </div>
              <Switch checked={autoPause} onCheckedChange={setAutoPause} disabled={disabled} />
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={disabled}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Salvar
          </Button>
        </div>
      </div>
    </div>
  );
}
