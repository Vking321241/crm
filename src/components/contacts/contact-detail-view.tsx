'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import type {
  Contact,
  Tag,
  ContactNote,
  CustomField,
  ContactCustomValue,
} from '@/components/contacts/types';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Phone,
  Mail,
  Building2,
  Copy,
  Check,
  Loader2,
  Plus,
  Trash2,
  Save,
  Users,
  MessageSquare,
} from 'lucide-react';
import { useTranslations } from 'next-intl';

interface ContactDetailViewProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contactId: string | null;
  onUpdated: () => void;
}

export function ContactDetailView({
  open,
  onOpenChange,
  contactId,
  onUpdated,
}: ContactDetailViewProps) {
  const t = useTranslations('Contacts.detailView');
  const router = useRouter();

  const [contact, setContact] = useState<Contact | null>(null);
  const [loading, setLoading] = useState(false);
  const [copiedPhone, setCopiedPhone] = useState(false);
  const [startingConversation, setStartingConversation] = useState(false);

  // Details tab
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editCompany, setEditCompany] = useState('');
  const [savingDetails, setSavingDetails] = useState(false);

  // Tags tab
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [contactTagIds, setContactTagIds] = useState<string[]>([]);
  const [savingTagId, setSavingTagId] = useState<string | null>(null);

  // Notes tab
  const [notes, setNotes] = useState<ContactNote[]>([]);
  const [newNote, setNewNote] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [loadingNotes, setLoadingNotes] = useState(false);

  // Custom fields tab
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [customValues, setCustomValues] = useState<Record<string, string>>({});
  const [savingCustom, setSavingCustom] = useState(false);
  const [loadingCustom, setLoadingCustom] = useState(false);

  const fetchAll = useCallback(async () => {
    if (!contactId) return;
    setLoading(true);
    setLoadingNotes(true);
    setLoadingCustom(true);

    try {
      const res = await fetch(`/api/contacts/${contactId}`);
      if (!res.ok) {
        toast.error(t('toastFailedLoad'));
        return;
      }
      const data = (await res.json()) as {
        contact: Contact;
        tags: Tag[];
        customValues: ContactCustomValue[];
        notes: ContactNote[];
      };

      setContact(data.contact);
      setEditName(data.contact.name ?? '');
      setEditPhone(data.contact.phone);
      setEditEmail(data.contact.email ?? '');
      setEditCompany(data.contact.company ?? '');

      setContactTagIds(data.tags.map((tg) => tg.id));

      const valueMap: Record<string, string> = {};
      for (const v of data.customValues) valueMap[v.customFieldId] = v.value ?? '';
      setCustomValues(valueMap);

      setNotes(data.notes);
    } finally {
      setLoading(false);
      setLoadingNotes(false);
      setLoadingCustom(false);
    }
  }, [contactId, t]);

  const fetchTags = useCallback(async () => {
    const res = await fetch('/api/tags');
    if (res.ok) {
      const data = (await res.json()) as { tags: Tag[] };
      setAllTags(data.tags ?? []);
    }
  }, []);

  const fetchCustomFieldDefs = useCallback(async () => {
    const res = await fetch('/api/custom-fields');
    if (res.ok) {
      const data = (await res.json()) as { customFields: CustomField[] };
      setCustomFields(data.customFields ?? []);
    }
  }, []);

  useEffect(() => {
    if (open && contactId) {
      fetchAll();
      fetchTags();
      fetchCustomFieldDefs();
    }
  }, [open, contactId, fetchAll, fetchTags, fetchCustomFieldDefs]);

  async function copyPhone() {
    if (!contact) return;
    await navigator.clipboard.writeText(contact.phone);
    setCopiedPhone(true);
    setTimeout(() => setCopiedPhone(false), 2000);
  }

  async function startConversation() {
    if (!contactId) return;
    setStartingConversation(true);
    try {
      const res = await fetch('/api/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contact_id: contactId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data?.error || 'Falha ao iniciar conversa');
        return;
      }
      router.push(`/inbox?c=${data.conversation.id}`);
    } finally {
      setStartingConversation(false);
    }
  }

  async function saveDetails() {
    if (!contactId || !editPhone.trim()) {
      toast.error(t('toastPhoneRequired'));
      return;
    }

    setSavingDetails(true);
    const res = await fetch(`/api/contacts/${contactId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: editName.trim(),
        phone: editPhone.trim(),
        email: editEmail.trim(),
        company: editCompany.trim(),
      }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast.error(body?.error || t('toastUpdateFailed'));
    } else {
      toast.success(t('toastUpdated'));
      fetchAll();
      onUpdated();
    }
    setSavingDetails(false);
  }

  async function toggleTag(tagId: string) {
    if (!contactId) return;
    setSavingTagId(tagId);

    const isSelected = contactTagIds.includes(tagId);

    const res = isSelected
      ? await fetch(`/api/contacts/${contactId}/tags/${tagId}`, { method: 'DELETE' })
      : await fetch(`/api/contacts/${contactId}/tags`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tagId }),
        });

    if (res.ok) {
      setContactTagIds((prev) =>
        isSelected ? prev.filter((id) => id !== tagId) : [...prev, tagId],
      );
      onUpdated();
    } else {
      toast.error(t('toastUpdateFailed'));
    }
    setSavingTagId(null);
  }

  async function addNote() {
    if (!contactId || !newNote.trim()) return;
    setSavingNote(true);

    const res = await fetch(`/api/contacts/${contactId}/notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ noteText: newNote.trim() }),
    });

    if (!res.ok) {
      toast.error(t('toastNoteAddFailed'));
    } else {
      setNewNote('');
      // POST /api/contacts/[id]/notes replies snake_case (same shape
      // GET returns, and what the inbox contact sidebar consumes) —
      // this component's own `ContactNote` type is camelCase (matches
      // the OTHER contacts route, GET /api/contacts/[id], which embeds
      // notes straight off Drizzle). Convert here rather than trust an
      // `as ContactNote` cast, which silently produced `createdAt:
      // undefined` and crashed date formatting downstream.
      const data = (await res.json()) as {
        note: { id: string; contact_id: string; user_id: string | null; note_text: string; created_at: string };
      };
      const note: ContactNote = {
        id: data.note.id,
        contactId: data.note.contact_id,
        accountId: contactId ?? '',
        userId: data.note.user_id,
        noteText: data.note.note_text,
        createdAt: data.note.created_at,
      };
      setNotes((prev) => [note, ...prev]);
      toast.success(t('toastNoteAdded'));
    }
    setSavingNote(false);
  }

  async function deleteNote(noteId: string) {
    if (!contactId) return;
    const res = await fetch(`/api/contacts/${contactId}/notes/${noteId}`, {
      method: 'DELETE',
    });

    if (!res.ok) {
      toast.error(t('toastNoteDeleteFailed'));
    } else {
      setNotes((prev) => prev.filter((n) => n.id !== noteId));
      toast.success(t('toastNoteDeleted'));
    }
  }

  async function saveCustomFields() {
    if (!contactId) return;
    setSavingCustom(true);

    try {
      const values = Object.entries(customValues).map(([customFieldId, value]) => ({
        customFieldId,
        value,
      }));

      const res = await fetch(`/api/contacts/${contactId}/custom-values`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ values }),
      });
      if (!res.ok) throw new Error();

      toast.success(t('toastCustomFieldsSaved'));
    } catch {
      toast.error(t('toastCustomFieldsFailed'));
    }
    setSavingCustom(false);
  }

  function getInitials(name?: string | null) {
    if (!name) return '?';
    return name
      .split(' ')
      .map((w) => w[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="bg-popover border-border text-popover-foreground sm:max-w-lg w-full p-0"
      >
        {loading || !contact ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="size-6 animate-spin text-primary" />
          </div>
        ) : (
          <div className="flex flex-col h-full">
            {/* Header */}
            <SheetHeader className="p-4 border-b border-border/50">
              <div className="flex items-center gap-3">
                <Avatar className="size-12 bg-muted border border-border">
                  <AvatarFallback className="bg-primary/10 text-primary text-sm font-medium">
                    {getInitials(contact.name)}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <SheetTitle className="text-popover-foreground truncate">
                    {contact.name || t('unnamed')}
                  </SheetTitle>
                  <SheetDescription className="text-muted-foreground text-xs mt-0.5">
                    {t('contactDetailsDesc')}
                  </SheetDescription>
                  <div className="flex flex-wrap items-center gap-3 mt-1.5 text-xs text-muted-foreground">
                    {contact.isGroup ? (
                      <span className="flex items-center gap-1">
                        <Users className="size-3" />
                        Grupo do WhatsApp
                      </span>
                    ) : (
                      <button
                        onClick={copyPhone}
                        className="flex items-center gap-1 hover:text-primary transition-colors cursor-pointer"
                      >
                        <Phone className="size-3" />
                        {contact.phone}
                        {copiedPhone ? (
                          <Check className="size-3 text-primary" />
                        ) : (
                          <Copy className="size-3" />
                        )}
                      </button>
                    )}
                    {contact.email && (
                      <span className="flex items-center gap-1">
                        <Mail className="size-3" />
                        {contact.email}
                      </span>
                    )}
                    {contact.company && (
                      <span className="flex items-center gap-1">
                        <Building2 className="size-3" />
                        {contact.company}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <Button
                onClick={startConversation}
                disabled={startingConversation}
                className="mt-3 w-full bg-primary hover:bg-primary/90 text-primary-foreground"
                size="sm"
              >
                {startingConversation ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <MessageSquare className="size-3.5" />
                )}
                Iniciar conversa
              </Button>
            </SheetHeader>

            {/* Tabs */}
            <Tabs defaultValue="details" className="flex-1 flex flex-col min-h-0">
              <TabsList className="bg-muted/50 border-b border-border mx-4 mt-3">
                <TabsTrigger
                  value="details"
                  className="data-active:bg-muted data-active:text-primary text-muted-foreground"
                >
                  {t('tabs.details')}
                </TabsTrigger>
                <TabsTrigger
                  value="tags"
                  className="data-active:bg-muted data-active:text-primary text-muted-foreground"
                >
                  {t('tabs.tags')}
                </TabsTrigger>
                <TabsTrigger
                  value="notes"
                  className="data-active:bg-muted data-active:text-primary text-muted-foreground"
                >
                  {t('tabs.notes')}
                </TabsTrigger>
                <TabsTrigger
                  value="custom"
                  className="data-active:bg-muted data-active:text-primary text-muted-foreground"
                >
                  {t('tabs.custom')}
                </TabsTrigger>
              </TabsList>

              {/* Details Tab */}
              <TabsContent value="details" className="flex-1 overflow-y-auto px-4 py-3">
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <Label className="text-muted-foreground text-xs">{t('name')}</Label>
                    <Input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="bg-muted border-border text-foreground h-8 text-sm"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-muted-foreground text-xs">
                      {t('phone')} <span className="text-red-400">*</span>
                    </Label>
                    <Input
                      value={editPhone}
                      onChange={(e) => setEditPhone(e.target.value)}
                      className="bg-muted border-border text-foreground h-8 text-sm"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-muted-foreground text-xs">{t('email')}</Label>
                    <Input
                      value={editEmail}
                      onChange={(e) => setEditEmail(e.target.value)}
                      className="bg-muted border-border text-foreground h-8 text-sm"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-muted-foreground text-xs">{t('company')}</Label>
                    <Input
                      value={editCompany}
                      onChange={(e) => setEditCompany(e.target.value)}
                      className="bg-muted border-border text-foreground h-8 text-sm"
                    />
                  </div>
                  <Button
                    onClick={saveDetails}
                    disabled={savingDetails}
                    className="bg-primary hover:bg-primary/90 text-primary-foreground w-full"
                    size="sm"
                  >
                    {savingDetails ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Save className="size-3.5" />
                    )}
                    {t('saveChangesBtn')}
                  </Button>
                </div>
              </TabsContent>

              {/* Tags Tab */}
              <TabsContent value="tags" className="flex-1 overflow-y-auto px-4 py-3">
                <div className="space-y-3">
                  <p className="text-xs text-muted-foreground">
                    {t('tagsTab.clickTagDesc')}
                  </p>
                  {allTags.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      {t('tagsTab.noTagsAvailable')}
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {allTags.map((tag) => {
                        const selected = contactTagIds.includes(tag.id);
                        return (
                          <button
                            key={tag.id}
                            onClick={() => toggleTag(tag.id)}
                            disabled={savingTagId === tag.id}
                            className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium transition-all cursor-pointer ${
                              selected
                                ? 'ring-2 ring-primary ring-offset-1 ring-offset-border'
                                : 'opacity-50 hover:opacity-80'
                            }`}
                            style={{
                              backgroundColor: tag.color + '20',
                              color: tag.color,
                            }}
                          >
                            {selected && <Check className="size-3 mr-1" />}
                            {tag.name}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </TabsContent>

              {/* Notes Tab */}
              <TabsContent value="notes" className="flex-1 flex flex-col min-h-0 px-4 py-3">
                <div className="space-y-2 mb-3">
                  <Textarea
                    value={newNote}
                    onChange={(e) => setNewNote(e.target.value)}
                    placeholder={t('notesTab.placeholder')}
                    className="bg-muted border-border text-foreground placeholder:text-muted-foreground min-h-[60px] text-sm resize-none"
                  />
                  <Button
                    onClick={addNote}
                    disabled={!newNote.trim() || savingNote}
                    className="bg-primary hover:bg-primary/90 text-primary-foreground"
                    size="sm"
                  >
                    {savingNote ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Plus className="size-3.5" />
                    )}
                    {t('notesTab.save')}
                  </Button>
                </div>

                <ScrollArea className="flex-1">
                  <div className="space-y-2 pr-2">
                    {loadingNotes ? (
                      <div className="flex items-center justify-center py-8">
                        <Loader2 className="size-5 animate-spin text-muted-foreground" />
                      </div>
                    ) : notes.length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-8">
                        {t('notesTab.noNotes')}
                      </p>
                    ) : (
                      notes.map((note) => (
                        <div
                          key={note.id}
                          className="rounded-lg bg-muted/50 border border-border/50 p-3 group"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-sm text-muted-foreground whitespace-pre-wrap flex-1">
                              {note.noteText}
                            </p>
                            <button
                              onClick={() => deleteNote(note.id)}
                              className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-400 transition-all cursor-pointer shrink-0"
                            >
                              <Trash2 className="size-3.5" />
                            </button>
                          </div>
                          <p className="text-xs text-muted-foreground mt-1.5">
                            {new Date(note.createdAt).toLocaleDateString('pt-BR', {
                              month: 'short',
                              day: 'numeric',
                              year: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </p>
                        </div>
                      ))
                    )}
                  </div>
                </ScrollArea>
              </TabsContent>

              {/* Custom Fields Tab */}
              <TabsContent value="custom" className="flex-1 overflow-y-auto px-4 py-3">
                {loadingCustom ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="size-5 animate-spin text-muted-foreground" />
                  </div>
                ) : customFields.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">
                    {t('noCustomFields')}
                  </p>
                ) : (
                  <div className="space-y-3">
                    {customFields.map((field) => (
                      <div key={field.id} className="space-y-1.5">
                        <Label className="text-muted-foreground text-xs capitalize">
                          {field.fieldName}
                        </Label>
                        <Input
                          value={customValues[field.id] ?? ''}
                          onChange={(e) =>
                            setCustomValues((prev) => ({
                              ...prev,
                              [field.id]: e.target.value,
                            }))
                          }
                          placeholder={t('enterCustomField', { name: field.fieldName })}
                          className="bg-muted border-border text-foreground h-8 text-sm placeholder:text-muted-foreground"
                        />
                      </div>
                    ))}
                    <Button
                      onClick={saveCustomFields}
                      disabled={savingCustom}
                      className="bg-primary hover:bg-primary/90 text-primary-foreground w-full"
                      size="sm"
                    >
                      {savingCustom ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <Save className="size-3.5" />
                      )}
                      {t('saveCustomFieldsBtn')}
                    </Button>
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
