"use client";

import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { Contact, ContactNote, Tag } from "@/types";
import {
  Phone,
  Mail,
  Copy,
  Check,
  Tag as TagIcon,
  StickyNote,
  Plus,
  Users,
  Loader2,
  Pencil,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useTranslations } from "next-intl";
import { ConversationTasks } from "./conversation-tasks";

interface ContactSidebarProps {
  contact: Contact | null;
  conversationId?: string | null;
  /** Bubbles a successful name edit up so the parent can sync it into
   *  the message-thread header, which keeps its own copy of the
   *  contact rather than reading this component's state. */
  onContactUpdated?: (contact: Contact) => void;
}

/**
 * Shape of GET /api/contacts/<id> — that route belongs to the Contacts
 * fatia (being built in parallel) and isn't implemented here, only
 * consumed. `notes` / `tags` are read defensively (optional) in case
 * that route doesn't embed them yet.
 */
interface ContactDetailResponse {
  contact?: Contact;
  notes?: ContactNote[];
  tags?: Tag[];
}

export function ContactSidebar({ contact, conversationId, onContactUpdated }: ContactSidebarProps) {
  const tSidebar = useTranslations("Inbox.sidebar");
  const tThread = useTranslations("Inbox.messageThread");

  const [copied, setCopied] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [notes, setNotes] = useState<ContactNote[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [newNote, setNewNote] = useState("");
  const [addingNote, setAddingNote] = useState(false);
  const [groupMembers, setGroupMembers] = useState<
    { phone: string; name: string | null; isAdmin: boolean }[] | null
  >(null);
  const [loadingMembers, setLoadingMembers] = useState(false);

  const fetchContactData = useCallback(async () => {
    if (!contact) {
      setNotes([]);
      setTags([]);
      return;
    }

    // Notes come from the dedicated /notes endpoint, not the field
    // embedded in GET /api/contacts/[id] — that one returns Drizzle's
    // raw camelCase row shape (createdAt, noteText), while this
    // component (and the add-note POST below) reads snake_case
    // (created_at, note_text). Fetching from the wrong endpoint here
    // meant ANY contact with at least one existing note crashed this
    // panel the moment it rendered (`new Date(undefined)` in the date
    // formatter below).
    const [contactRes, notesRes] = await Promise.all([
      fetch(`/api/contacts/${encodeURIComponent(contact.id)}`, { cache: "no-store" }).catch(() => null),
      fetch(`/api/contacts/${encodeURIComponent(contact.id)}/notes`, { cache: "no-store" }).catch(() => null),
    ]);

    if (contactRes?.ok) {
      const data = (await contactRes.json().catch(() => ({}))) as ContactDetailResponse;
      setTags(data.tags ?? []);
    }
    if (notesRes?.ok) {
      const notesData = (await notesRes.json().catch(() => ({}))) as { notes?: ContactNote[] };
      setNotes(notesData.notes ?? []);
    }
  }, [contact]);

  useEffect(() => {
    void fetchContactData();
  }, [fetchContactData]);

  // Switching to a different conversation/contact should never leave
  // a stale edit box open.
  useEffect(() => {
    setEditingName(false);
  }, [contact?.id]);

  const handleStartEditName = useCallback(() => {
    if (!contact) return;
    setNameDraft(contact.name ?? "");
    setEditingName(true);
  }, [contact]);

  const handleSaveName = useCallback(async () => {
    if (!contact) return;
    const trimmed = nameDraft.trim();
    if (trimmed === (contact.name ?? "")) {
      setEditingName(false);
      return;
    }
    setSavingName(true);
    try {
      const res = await fetch(`/api/contacts/${encodeURIComponent(contact.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data?.error || "Falha ao atualizar o nome");
        return;
      }
      setEditingName(false);
      // The PATCH route returns the raw DB row (camelCase), not the
      // snake_case shape the frontend `Contact` type expects — build
      // the updated contact from what we already have instead of
      // trusting that response's shape.
      onContactUpdated?.({ ...contact, name: trimmed || undefined });
    } catch {
      toast.error("Não foi possível conectar ao servidor.");
    } finally {
      setSavingName(false);
    }
  }, [contact, nameDraft, onContactUpdated]);

  useEffect(() => {
    if (!contact?.is_group) {
      setGroupMembers(null);
      return;
    }
    setLoadingMembers(true);
    fetch(`/api/contacts/${encodeURIComponent(contact.id)}/group-members`, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : { participants: [] }))
      .then((data) => setGroupMembers(data.participants ?? []))
      .catch(() => setGroupMembers([]))
      .finally(() => setLoadingMembers(false));
  }, [contact?.id, contact?.is_group]);

  const handleCopyPhone = useCallback(async () => {
    if (!contact?.phone) return;
    await navigator.clipboard.writeText(contact.phone);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [contact]);

  const handleAddNote = useCallback(async () => {
    if (!contact || !newNote.trim()) return;
    setAddingNote(true);
    try {
      const res = await fetch(`/api/contacts/${encodeURIComponent(contact.id)}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ noteText: newNote.trim() }),
      });
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        if (data.note) setNotes((prev) => [data.note as ContactNote, ...prev]);
        setNewNote("");
      }
    } finally {
      setAddingNote(false);
    }
  }, [contact, newNote]);

  if (!contact) {
    return (
      <div className="flex h-full w-70 items-center justify-center border-l border-border bg-card">
        <p className="text-sm text-muted-foreground">{tThread("selectConversation")}</p>
      </div>
    );
  }

  const displayName = contact.name || contact.phone;
  const initials = displayName.charAt(0).toUpperCase();

  return (
    <div className="flex h-full w-70 flex-col border-l border-border bg-card">
      <ScrollArea className="flex-1">
        <div className="p-4">
          {/* Contact Info */}
          <div className="flex flex-col items-center text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted text-lg font-semibold text-foreground">
              {contact.avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={contact.avatar_url}
                  alt={displayName}
                  className="h-16 w-16 rounded-full object-cover"
                />
              ) : (
                initials
              )}
            </div>
            {editingName ? (
              <div className="mt-3 flex w-full items-center gap-1.5 px-2">
                <Input
                  autoFocus
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void handleSaveName();
                    if (e.key === "Escape") setEditingName(false);
                  }}
                  disabled={savingName}
                  className="h-7 text-center text-sm"
                  maxLength={120}
                />
                <Button
                  size="sm"
                  className="h-7 shrink-0 px-2"
                  onClick={handleSaveName}
                  disabled={savingName}
                >
                  {savingName ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                </Button>
              </div>
            ) : (
              <button
                type="button"
                onClick={contact.is_group ? undefined : handleStartEditName}
                disabled={contact.is_group}
                title={contact.is_group ? undefined : "Editar nome do contato"}
                className={cn(
                  "group mt-3 flex items-center gap-1.5 text-sm font-semibold text-foreground",
                  !contact.is_group && "cursor-pointer hover:text-primary",
                )}
              >
                {displayName}
                {!contact.is_group && (
                  <Pencil className="h-3 w-3 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                )}
              </button>
            )}
            {contact.company && (
              <p className="text-xs text-muted-foreground">{contact.company}</p>
            )}
          </div>

          {/* Phone / group indicator */}
          <div className="mt-4 space-y-2">
            {contact.is_group ? (
              <div className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground">
                <Users className="h-4 w-4 text-muted-foreground" />
                <span className="flex-1 text-left">Grupo do WhatsApp</span>
              </div>
            ) : (
              <button
                onClick={handleCopyPhone}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted"
              >
                <Phone className="h-4 w-4 text-muted-foreground" />
                <span className="flex-1 text-left">{contact.phone}</span>
                {copied ? (
                  <Check className="h-3 w-3 text-primary" />
                ) : (
                  <Copy className="h-3 w-3 text-muted-foreground" />
                )}
              </button>
            )}

            {contact.email && (
              <div className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground">
                <Mail className="h-4 w-4 text-muted-foreground" />
                <span className="truncate">{contact.email}</span>
              </div>
            )}
          </div>

          {/* Divider */}
          <div className="my-4 border-t border-border" />

          {/* Group members — best-effort, hides itself if UAZAPI has
              nothing to offer rather than showing an empty-looking
              error state. */}
          {contact.is_group && (loadingMembers || (groupMembers && groupMembers.length > 0)) && (
            <>
              <div>
                <div className="flex items-center gap-2 px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  <Users className="h-3 w-3" />
                  Membros do grupo
                  {groupMembers && groupMembers.length > 0 && ` (${groupMembers.length})`}
                </div>
                {loadingMembers ? (
                  <div className="flex justify-center py-3">
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  </div>
                ) : (
                  <ul className="mt-2 space-y-0.5">
                    {groupMembers!.map((member) => (
                      <li
                        key={member.phone}
                        className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-xs text-foreground"
                      >
                        <span className="truncate">{member.name || member.phone}</span>
                        {member.isAdmin && (
                          <span className="shrink-0 rounded-full bg-primary/10 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-primary">
                            Admin
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="my-4 border-t border-border" />
            </>
          )}

          {/* Tags */}
          <div>
            <div className="flex items-center gap-2 px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <TagIcon className="h-3 w-3" />
              {tSidebar("tags")}
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              {tags.length === 0 ? (
                <p className="px-1 text-xs text-muted-foreground">{tSidebar("noTags")}</p>
              ) : (
                tags.map((tag) => (
                  <span
                    key={tag.id}
                    className="rounded-full px-2 py-0.5 text-[10px] font-medium"
                    style={{
                      backgroundColor: `${tag.color}20`,
                      color: tag.color,
                    }}
                  >
                    {tag.name}
                  </span>
                ))
              )}
            </div>
          </div>

          {/* Divider */}
          <div className="my-4 border-t border-border" />

          {/* Scheduled tasks */}
          {conversationId && <ConversationTasks conversationId={conversationId} />}

          {/* Divider */}
          <div className="my-4 border-t border-border" />

          {/* Notes */}
          <div>
            <div className="flex items-center gap-2 px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <StickyNote className="h-3 w-3" />
              {tSidebar("notes")}
            </div>
            <div className="mt-2">
              <div className="flex gap-2">
                <textarea
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                  placeholder={tSidebar("addNotePlaceholder")}
                  rows={2}
                  className="flex-1 resize-none rounded-lg border border-border bg-muted px-3 py-2 text-xs text-foreground placeholder-muted-foreground outline-none focus:border-primary/50"
                />
                <Button
                  size="sm"
                  className="h-auto bg-primary px-2 hover:bg-primary/90"
                  onClick={handleAddNote}
                  disabled={!newNote.trim() || addingNote}
                >
                  <Plus className="h-3 w-3" />
                </Button>
              </div>

              <div className="mt-2 space-y-2">
                {notes.map((note) => (
                  <div
                    key={note.id}
                    className="rounded-lg bg-muted px-3 py-2"
                  >
                    <p className="whitespace-pre-wrap text-xs text-muted-foreground">
                      {note.note_text}
                    </p>
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      {note.author_name ?? tSidebar('unknownAuthor')} ·{' '}
                      {format(new Date(note.created_at), "d MMM yyyy HH:mm", { locale: ptBR })}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}
