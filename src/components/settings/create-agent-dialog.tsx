'use client';

// ============================================================
// CreateAgentDialog
//
// The admin's way to add a user: type their name, e-mail and a
// password, and pick exactly which modules they can access —
// no invite link, no self-registration, no predefined role to
// choose from. Checking every module effectively makes them a
// "gerente" without promoting their role; leaving one checked locks
// them to that single screen.
// ============================================================

import { useState } from 'react';
import { toast } from 'sonner';
import { Loader2, UserPlus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { DEFAULT_AGENT_MODULES, PERMISSION_MODULES, type PermissionModule } from '@/lib/auth/permissions';

interface CreateAgentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after a successful create so the parent re-fetches the roster. */
  onCreated: () => void;
}

function defaultModuleSet(): Set<PermissionModule> {
  return new Set(DEFAULT_AGENT_MODULES);
}

export function CreateAgentDialog({ open, onOpenChange, onCreated }: CreateAgentDialogProps) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [modules, setModules] = useState<Set<PermissionModule>>(defaultModuleSet);
  const [submitting, setSubmitting] = useState(false);

  function reset() {
    setName('');
    setEmail('');
    setPassword('');
    setModules(defaultModuleSet());
    setSubmitting(false);
  }

  function toggleModule(mod: PermissionModule, checked: boolean) {
    setModules((prev) => {
      const next = new Set(prev);
      if (checked) next.add(mod);
      else next.delete(mod);
      return next;
    });
  }

  async function handleCreate() {
    if (!name.trim()) {
      toast.error('Informe o nome do usuário.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      toast.error('Informe um e-mail válido.');
      return;
    }
    if (password.length < 8) {
      toast.error('A senha deve ter pelo menos 8 caracteres.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/account/members', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          password,
          modules: Array.from(modules),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || 'Falha ao criar o usuário');
        return;
      }
      toast.success(`Usuário criado: ${data.member.email}`);
      onCreated();
      onOpenChange(false);
    } catch (err) {
      console.error('[CreateAgentDialog] create error:', err);
      toast.error('Não foi possível conectar ao servidor.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="bg-popover border-border sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-popover-foreground">Novo usuário</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Informe nome, e-mail e senha de acesso, e escolha o que essa pessoa pode ver no
            sistema.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[65vh] space-y-4 overflow-y-auto py-2">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label className="text-muted-foreground">Nome</Label>
              <Input
                placeholder="Ex: João Silva"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={80}
                className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label className="text-muted-foreground">E-mail de acesso</Label>
              <Input
                type="email"
                placeholder="joao@empresa.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-muted-foreground">Senha</Label>
            <Input
              type="password"
              placeholder="Mínimo 8 caracteres"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
            />
            <p className="text-xs text-muted-foreground">
              Compartilhe essa senha com o usuário por um canal seguro — ela não fica salva em
              nenhum lugar visível depois de criada.
            </p>
          </div>

          <div className="space-y-2">
            <Label className="text-muted-foreground">O que essa pessoa pode acessar</Label>
            <div className="grid grid-cols-1 gap-x-4 gap-y-2 rounded-md border border-border bg-muted/40 p-3 sm:grid-cols-2">
              {PERMISSION_MODULES.map((mod) => (
                <label key={mod.key} className="flex items-start gap-2 text-sm">
                  <Checkbox
                    checked={modules.has(mod.key)}
                    onCheckedChange={(v) => toggleModule(mod.key, v === true)}
                    className="mt-0.5"
                  />
                  <span>
                    <span className="block text-foreground">{mod.label}</span>
                    <span className="block text-xs text-muted-foreground">{mod.description}</span>
                  </span>
                </label>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Marque tudo para dar acesso total (equivalente a um gerente) sem torná-lo
              administrador. Dá para ajustar depois em Configurações → Permissões.
            </p>
          </div>
        </div>

        <DialogFooter className="bg-popover border-border">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="border-border text-muted-foreground hover:bg-muted"
          >
            Cancelar
          </Button>
          <Button
            onClick={handleCreate}
            disabled={submitting}
            className="bg-primary hover:bg-primary/90 text-primary-foreground"
          >
            {submitting ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Criando…
              </>
            ) : (
              <>
                <UserPlus className="size-4" />
                Criar usuário
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
