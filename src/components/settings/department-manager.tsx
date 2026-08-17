'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Plus, Users2, X } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { SettingsPanelHead } from './settings-panel-head';
import { cn } from '@/lib/utils';

interface Department {
  id: string;
  name: string;
  color: string;
}

const PRESET_COLORS = [
  '#ef4444',
  '#f97316',
  '#f59e0b',
  '#10b981',
  '#06b6d4',
  '#3b82f6',
  '#8b5cf6',
  '#ec4899',
];

/**
 * Settings tab for "setores" (departments) — the shared queues a
 * conversation can be transferred into from the inbox thread header.
 * Deleting one just detaches it from any conversation pointing at it
 * (ON DELETE SET NULL, see src/db/schema.ts) rather than failing.
 */
export function DepartmentManager() {
  const { user, loading: authLoading } = useAuth();

  const [loading, setLoading] = useState(true);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [toDelete, setToDelete] = useState<Department | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [newName, setNewName] = useState('');
  const [selectedColor, setSelectedColor] = useState(PRESET_COLORS[5]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setLoading(false);
      return;
    }
    fetchDepartments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, user?.id]);

  async function fetchDepartments() {
    try {
      setLoading(true);
      const res = await fetch('/api/departments', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'failed');
      setDepartments(data.departments ?? []);
    } catch (err) {
      console.error('Failed to fetch departments:', err);
      toast.error('Não foi possível carregar os setores.');
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate() {
    if (!newName.trim()) {
      toast.error('Informe um nome para o setor.');
      return;
    }
    try {
      setSaving(true);
      const res = await fetch('/api/departments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim(), color: selectedColor }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'failed');

      toast.success('Setor criado.');
      setNewName('');
      setSelectedColor(PRESET_COLORS[5]);
      await fetchDepartments();
    } catch (err) {
      console.error('Create error:', err);
      toast.error('Falha ao criar o setor.');
    } finally {
      setSaving(false);
    }
  }

  function confirmDelete(dep: Department) {
    setToDelete(dep);
    setDeleteDialogOpen(true);
  }

  async function handleDelete() {
    if (!toDelete) return;
    try {
      setDeleting(true);
      const res = await fetch(`/api/departments/${toDelete.id}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'failed');

      toast.success('Setor apagado.');
      setDepartments((prev) => prev.filter((d) => d.id !== toDelete.id));
      setDeleteDialogOpen(false);
      setToDelete(null);
    } catch (err) {
      console.error('Delete error:', err);
      toast.error('Falha ao apagar o setor.');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div>
      <SettingsPanelHead
        title="Setores"
        description="Grupos de atendimento (ex: Vendas, Suporte) para transferir conversas entre equipes. Defina o setor de cada pessoa em Membros — as mensagens dela passam a sair com uma assinatura em negrito (ex: *Vendas - Cleiton*)."
      />
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-foreground">
            <Users2 className="size-4 text-primary" />
            Setores
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            Ao transferir uma conversa para um setor, ela fica sem atendente até alguém assumir.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="size-6 animate-spin text-primary" />
            </div>
          ) : (
            <>
              {departments.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {departments.map((dep) => (
                    <span
                      key={dep.id}
                      className="group inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors"
                      style={{
                        backgroundColor: `${dep.color}20`,
                        color: dep.color,
                        border: `1px solid ${dep.color}40`,
                      }}
                    >
                      <span className="size-2 rounded-full" style={{ backgroundColor: dep.color }} />
                      {dep.name}
                      <button
                        type="button"
                        onClick={() => confirmDelete(dep)}
                        aria-label={`Apagar ${dep.name}`}
                        className="ml-0.5 rounded-full p-0.5 opacity-60 transition-opacity hover:bg-black/10 hover:opacity-100 dark:hover:bg-white/10"
                      >
                        <X className="size-3" />
                      </button>
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Nenhum setor criado ainda.</p>
              )}

              <div className="flex flex-wrap items-center gap-2.5">
                <Input
                  placeholder="Nome do setor"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleCreate();
                  }}
                  disabled={saving}
                  maxLength={40}
                  className="min-w-[180px] flex-1"
                />
                <div className="flex gap-1.5">
                  {PRESET_COLORS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      onClick={() => setSelectedColor(color)}
                      aria-label={`Usar cor ${color}`}
                      aria-pressed={selectedColor === color}
                      className={cn(
                        'size-6 rounded-md transition-transform hover:scale-110',
                        selectedColor === color &&
                          'outline outline-2 outline-offset-2 outline-primary',
                      )}
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
                <Button variant="outline" size="sm" onClick={handleCreate} disabled={saving || !newName.trim()}>
                  {saving ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
                  Adicionar setor
                </Button>
              </div>
            </>
          )}
        </CardContent>

        <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>Apagar setor</DialogTitle>
              <DialogDescription>
                {toDelete ? `Tem certeza que quer apagar "${toDelete.name}"? Conversas nele ficam sem setor.` : null}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setDeleteDialogOpen(false)} disabled={deleting}>
                Cancelar
              </Button>
              <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
                {deleting ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Apagando…
                  </>
                ) : (
                  'Apagar setor'
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </Card>
    </div>
  );
}
