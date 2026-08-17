// ============================================================
// Granular per-user, per-module permissions.
//
// Layered on top of the coarse `accountRole` hierarchy
// (src/lib/auth/roles.ts): owner and admin always see every module,
// no matter what's in `user_permissions`. For agent/viewer rows,
// access to any given module is OFF by default and must be
// explicitly granted — that's what lets an admin turn a plain agent
// into a "gerente" with full visibility (grant every module) or
// lock another agent down to just the inbox (grant only "inbox").
//
// `PERMISSION_MODULES` is the single source of truth for what a
// module is called and what it gates — add an entry here to expose
// a new checkbox in the permissions matrix, no migration needed
// (the DB column is a free-text key, not a pgEnum).
// ============================================================

export type PermissionModule =
  | "inbox"
  | "spy_mode"
  | "reports"
  | "internal_chat"
  | "tasks"
  | "contacts"
  | "broadcasts"
  | "settings"
  | "tags_manage"
  | "departments_manage";

export interface PermissionModuleMeta {
  key: PermissionModule;
  label: string;
  description: string;
}

export const PERMISSION_MODULES: readonly PermissionModuleMeta[] = [
  { key: "inbox", label: "Central de Atendimento", description: "Ver e responder conversas" },
  { key: "tasks", label: "Central de Tarefas", description: "Tarefas agendadas nas conversas" },
  { key: "internal_chat", label: "Chat Interno", description: "Mensagens entre a equipe" },
  { key: "spy_mode", label: "Modo Espião", description: "Supervisionar atendimentos em tempo real" },
  { key: "reports", label: "Relatórios", description: "Dashboard analytics e relatórios" },
  { key: "contacts", label: "Contatos", description: "Base de contatos" },
  { key: "broadcasts", label: "Disparos em massa", description: "Campanhas de mensagens" },
  { key: "tags_manage", label: "Criar Tags", description: "Criar/editar etiquetas de produtos" },
  { key: "departments_manage", label: "Gerenciar Setores", description: "Criar/editar departamentos" },
  { key: "settings", label: "Configurações", description: "Configurações administrativas" },
] as const;

const MODULE_KEYS = new Set<string>(PERMISSION_MODULES.map((m) => m.key));

export function isPermissionModule(value: unknown): value is PermissionModule {
  return typeof value === "string" && MODULE_KEYS.has(value);
}

/** Modules granted to a brand-new agent by default, before an admin
 *  customizes their access. Kept minimal on purpose — the request
 *  that started this system was "usuário X só pode ter acesso ao
 *  canal de mensagens". */
export const DEFAULT_AGENT_MODULES: readonly PermissionModule[] = [
  "inbox",
  "tasks",
  "internal_chat",
  "contacts",
];

/**
 * True iff `role` bypasses the grants table entirely (sees every
 * module regardless of what's stored per-user).
 */
export function roleHasFullAccess(role: string): boolean {
  return role === "owner" || role === "manager";
}

/**
 * Resolve whether a user can access `module`, given their role and
 * their resolved grant set (module keys with `canAccess = true`).
 */
export function hasModuleAccess(
  role: string,
  grantedModules: ReadonlySet<string>,
  module: PermissionModule,
): boolean {
  if (roleHasFullAccess(role)) return true;
  return grantedModules.has(module);
}

/** All module keys the given role effectively has access to. For
 *  owner/admin this is every module (grants are irrelevant); for
 *  agent/viewer it's exactly the granted set intersected with the
 *  known catalog. */
export function effectiveModules(
  role: string,
  grantedModules: ReadonlySet<string>,
): PermissionModule[] {
  if (roleHasFullAccess(role)) {
    return PERMISSION_MODULES.map((m) => m.key);
  }
  return PERMISSION_MODULES.filter((m) => grantedModules.has(m.key)).map((m) => m.key);
}
