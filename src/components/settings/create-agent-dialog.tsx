'use client';

// ============================================================
// CreateAgentDialog
//
// The manager's way to add a user: type their name, e-mail, a
// password, and pick one of the two creatable roles — no invite
// link, no self-registration. "Membro" starts with the default
// module baseline (fine-tuned later from Settings → Permissões);
// "Gerente" gets full access to everything, including workspace
// Settings, same as the caller minus owner-only actions.
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAuth } from '@/hooks/use-auth';

type CreatableRole = 'agent' | 'manager';

const ROLE_LABEL: Record<CreatableRole, string> = {
  agent: 'Membro',
  manager: 'Gerente',
};

interface CreateAgentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after a successful create so the parent re-fetches the roster. */
  onCreated: () => void;
}

function slugify(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '');
}

export function CreateAgentDialog({ open, onOpenChange, onCreated }: CreateAgentDialogProps) {
  const { account } = useAuth();
  const domain = account?.email_domain ?? null;

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  // Once the admin types into the e-mail field directly, stop
  // auto-filling it from the name — a manual edit always wins.
  const [emailTouched, setEmailTouched] = useState(false);
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<CreatableRole>('agent');
  const [submitting, setSubmitting] = useState(false);

  function reset() {
    setName('');
    setEmail('');
    setEmailTouched(false);
    setPassword('');
    setRole('agent');
    setSubmitting(false);
  }

  function handleNameChange(value: string) {
    setName(value);
    if (!emailTouched && domain) {
      const slug = slugify(value);
      setEmail(slug ? `${slug}@${domain}` : '');
    }
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
          role,
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
            Informe nome, e-mail e senha de acesso, e escolha o cargo dessa pessoa.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[65vh] space-y-4 overflow-y-auto py-2">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label className="text-muted-foreground">Nome</Label>
              <Input
                placeholder="Ex: João Silva"
                value={name}
                onChange={(e) => handleNameChange(e.target.value)}
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
                onChange={(e) => {
                  setEmailTouched(true);
                  setEmail(e.target.value);
                }}
                className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
              />
              {domain && !emailTouched && (
                <p className="text-xs text-muted-foreground">
                  Preenchido automaticamente com o domínio {domain} — edite se quiser outro.
                </p>
              )}
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
            <Label className="text-muted-foreground">Cargo</Label>
            <Select value={role} onValueChange={(v) => v && setRole(v as CreatableRole)}>
              <SelectTrigger className="w-full bg-muted border-border text-foreground">
                <SelectValue>{() => ROLE_LABEL[role]}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="agent">Membro</SelectItem>
                <SelectItem value="manager">Gerente</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {role === 'manager'
                ? 'Gerente vê e edita tudo, inclusive Configurações do espaço de trabalho — igual a você, exceto ações exclusivas do proprietário.'
                : 'Membro começa com acesso básico (Central de Atendimento, Tarefas, Chat Interno, Contatos). Ajuste depois em Configurações → Permissões.'}
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
