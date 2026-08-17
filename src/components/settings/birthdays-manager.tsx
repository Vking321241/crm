'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Cake, Loader2, Plus, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SettingsPanelHead } from './settings-panel-head';

interface Birthday {
  id: string;
  name: string;
  birth_date: string;
  phone?: string;
  group_contact_id?: string;
  group_name?: string;
}

interface GroupOption {
  id: string;
  name: string;
}

const NONE = '__none__';

/**
 * Settings tab for "aniversários" — the roster /api/cron/birthdays
 * reads to send an individual "feliz aniversário" WhatsApp message on
 * the day, plus a monthly roll-up to the assigned WhatsApp group on
 * the 1st. The group picker shows the group's display name, never
 * its raw chat id (see /api/contacts/groups).
 */
export function BirthdaysManager() {
  const [loading, setLoading] = useState(true);
  const [birthdays, setBirthdays] = useState<Birthday[]>([]);
  const [groups, setGroups] = useState<GroupOption[]>([]);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [phone, setPhone] = useState('');
  const [groupContactId, setGroupContactId] = useState(NONE);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    try {
      setLoading(true);
      const [bRes, gRes] = await Promise.all([
        fetch('/api/birthdays', { cache: 'no-store' }),
        fetch('/api/contacts/groups', { cache: 'no-store' }),
      ]);
      const bData = await bRes.json().catch(() => ({}));
      if (!bRes.ok) throw new Error(bData?.error || 'failed');
      setBirthdays(bData.birthdays ?? []);
      if (gRes.ok) {
        const gData = await gRes.json().catch(() => ({}));
        setGroups(gData.groups ?? []);
      }
    } catch (err) {
      console.error('Failed to fetch birthdays:', err);
      toast.error('Não foi possível carregar os aniversários.');
    } finally {
      setLoading(false);
    }
  }

  function resetForm() {
    setName('');
    setBirthDate('');
    setPhone('');
    setGroupContactId(NONE);
  }

  async function handleCreate() {
    if (!name.trim()) {
      toast.error('Informe o nome.');
      return;
    }
    if (!birthDate) {
      toast.error('Informe a data de aniversário.');
      return;
    }
    try {
      setSaving(true);
      const res = await fetch('/api/birthdays', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          birthDate,
          phone: phone.trim() || undefined,
          groupContactId: groupContactId === NONE ? undefined : groupContactId,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'failed');

      toast.success('Aniversário cadastrado.');
      resetForm();
      await load();
    } catch (err) {
      console.error('Create error:', err);
      toast.error('Falha ao cadastrar.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    try {
      setDeletingId(id);
      const res = await fetch(`/api/birthdays/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('failed');
      setBirthdays((prev) => prev.filter((b) => b.id !== id));
    } catch (err) {
      console.error('Delete error:', err);
      toast.error('Falha ao remover.');
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div>
      <SettingsPanelHead
        title="Aniversários"
        description="Cadastre colaboradores com data de aniversário. Todo dia 1º sai um resumo dos aniversariantes do mês pro grupo do WhatsApp escolhido, e no dia certo cada um recebe uma mensagem individual (se tiver telefone cadastrado)."
      />
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-foreground">
            <Cake className="size-4 text-primary" />
            Colaboradores
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            O grupo recebe o aviso mensal; o telefone individual (opcional) recebe a mensagem no dia.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="size-6 animate-spin text-primary" />
            </div>
          ) : (
            <>
              {birthdays.length > 0 ? (
                <ul className="divide-y divide-border rounded-md border border-border">
                  {birthdays.map((b) => (
                    <li key={b.id} className="flex items-center gap-3 px-3 py-2.5">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-foreground">{b.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {new Date(`${b.birth_date}T00:00:00`).toLocaleDateString('pt-BR', {
                            day: '2-digit',
                            month: 'long',
                          })}
                          {b.phone && ` · ${b.phone}`}
                          {b.group_name && ` · Grupo: ${b.group_name}`}
                        </p>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleDelete(b.id)}
                        disabled={deletingId === b.id}
                        className="border-red-500/40 bg-red-500/10 text-red-300 hover:bg-red-500/20 hover:border-red-500/60 hover:text-red-200"
                      >
                        {deletingId === b.id ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <Trash2 className="size-4" />
                        )}
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">Nenhum colaborador cadastrado ainda.</p>
              )}

              <div className="grid grid-cols-1 gap-2.5 rounded-md border border-border bg-muted/40 p-3 sm:grid-cols-2">
                <Input
                  placeholder="Nome"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={80}
                />
                <Input
                  type="date"
                  value={birthDate}
                  onChange={(e) => setBirthDate(e.target.value)}
                />
                <Input
                  placeholder="Telefone (opcional, para msg individual)"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
                <Select value={groupContactId} onValueChange={(v) => v && setGroupContactId(v)}>
                  <SelectTrigger className="w-full bg-muted border-border text-foreground">
                    <SelectValue>
                      {() =>
                        groupContactId === NONE
                          ? 'Sem grupo'
                          : (groups.find((g) => g.id === groupContactId)?.name ?? 'Sem grupo')
                      }
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Sem grupo</SelectItem>
                    {groups.map((g) => (
                      <SelectItem key={g.id} value={g.id}>
                        {g.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleCreate}
                  disabled={saving || !name.trim() || !birthDate}
                  className="sm:col-span-2"
                >
                  {saving ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
                  Adicionar colaborador
                </Button>
              </div>

              {groups.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  Nenhum grupo do WhatsApp identificado ainda — assim que uma mensagem chegar de um
                  grupo, ele aparece aqui para escolher.
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <div className="mt-6">
        <BirthdayMessagesCard />
      </div>
    </div>
  );
}

interface BirthdayMessages {
  individual_message: string;
  monthly_message: string;
}

/**
 * Editable text of the two messages /api/cron/birthdays sends.
 * `{nome}` (individual) and `{mes}` / `{lista}` (monthly) are
 * substituted at send time — see that route's getTemplates().
 */
function BirthdayMessagesCard() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [individualMessage, setIndividualMessage] = useState('');
  const [monthlyMessage, setMonthlyMessage] = useState('');

  useEffect(() => {
    fetch('/api/settings/birthday-messages', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: BirthdayMessages | null) => {
        if (data) {
          setIndividualMessage(data.individual_message);
          setMonthlyMessage(data.monthly_message);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function handleSave() {
    if (!individualMessage.includes('{nome}')) {
      toast.error('A mensagem individual precisa conter {nome}');
      return;
    }
    if (!monthlyMessage.includes('{lista}')) {
      toast.error('A mensagem mensal precisa conter {lista}');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/settings/birthday-messages', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          individual_message: individualMessage,
          monthly_message: monthlyMessage,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'failed');
      toast.success('Mensagens salvas.');
    } catch (err) {
      toast.error(err instanceof Error && err.message !== 'failed' ? err.message : 'Falha ao salvar.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-foreground">Personalizar mensagens</CardTitle>
        <CardDescription className="text-muted-foreground">
          A individual usa <code className="text-foreground">{'{nome}'}</code>; a mensal usa{' '}
          <code className="text-foreground">{'{mes}'}</code> e{' '}
          <code className="text-foreground">{'{lista}'}</code> (a lista de aniversariantes já formatada).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="size-6 animate-spin text-primary" />
          </div>
        ) : (
          <>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                Mensagem individual (no dia do aniversário)
              </label>
              <textarea
                value={individualMessage}
                onChange={(e) => setIndividualMessage(e.target.value)}
                rows={3}
                className="w-full resize-none rounded-md border border-border bg-muted px-2.5 py-2 text-sm text-foreground placeholder-muted-foreground outline-none focus:border-primary/50"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                Mensagem mensal (pro grupo, todo dia 1º)
              </label>
              <textarea
                value={monthlyMessage}
                onChange={(e) => setMonthlyMessage(e.target.value)}
                rows={4}
                className="w-full resize-none rounded-md border border-border bg-muted px-2.5 py-2 text-sm text-foreground placeholder-muted-foreground outline-none focus:border-primary/50"
              />
            </div>
            <Button variant="outline" size="sm" onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 className="size-4 animate-spin" /> : null}
              Salvar mensagens
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
