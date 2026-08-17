"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useAuth } from "@/hooks/use-auth";
import { usePresence } from "@/hooks/use-presence";
import { PresenceDot } from "@/components/presence/presence-dot";
import { presenceLabel } from "@/lib/presence";
import { cn } from "@/lib/utils";
import type {
  Conversation,
  Message,
  MessageReaction,
  Contact,
  ConversationStatus,
} from "@/types";
import {
  MessageSquare,
  ChevronDown,
  UserPlus,
  Users2,
  Check,
  ArrowLeft,
  RefreshCw,
  PanelRightOpen,
  PanelRightClose,
  CircleX,
} from "lucide-react";
import { format, isToday, isYesterday } from "date-fns";
import { useTranslations } from "next-intl";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MessageBubble } from "./message-bubble";
import { MessageActions } from "./message-actions";
import {
  MessageComposer,
  CHAT_MEDIA_BUCKET,
  type SendMediaPayload,
} from "./message-composer";
import { deleteAccountMedia } from "@/lib/storage/upload-media";
import { buildReplyPreview } from "./reply-quote";
import {
  CloseConversationModal,
  SURVEY_MESSAGE,
  type CloseReason,
} from "./close-conversation-modal";
import { toast } from "sonner";

/** Message row as returned by GET /api/conversations/[id]/messages —
 *  reactions come embedded per-message so the thread doesn't need a
 *  separate poll loop / realtime channel just for reaction pills. */
type MessageWithReactions = Message & { reactions: MessageReaction[] };

interface AccountMemberLite {
  user_id: string;
  full_name: string;
}

interface ReplyDraft {
  id: string;
  authorLabel: string;
  preview: string;
}

interface MessageThreadProps {
  /** Null when no conversation is selected — renders the empty state. */
  conversationId: string | null;
  /**
   * Fired whenever the thread (re)loads the conversation row — lets the
   * page keep the conversation-list highlight, mobile header, and
   * contact sidebar in sync without a second fetch.
   */
  onConversationLoaded?: (conversation: Conversation) => void;
  /**
   * On mobile, the thread is shown full-screen with the conversation list
   * hidden. This callback lets the page deselect the active conversation
   * and reveal the list again. Rendered as a back-arrow in the header on
   * mobile only.
   */
  onBack?: () => void;
  contactPanelOpen?: boolean;
  onToggleContactPanel?: () => void;
}

/** Poll cadence for the open thread — messages + conversation header. */
const POLL_MS = 4000;

function formatDateSeparator(dateStr: string, t: ReturnType<typeof useTranslations>): string {
  const date = new Date(dateStr);
  if (isToday(date)) return t("today");
  if (isYesterday(date)) return t("yesterday");
  return format(date, "MMMM d, yyyy");
}

function groupMessagesByDate(messages: MessageWithReactions[]) {
  const groups: { date: string; messages: MessageWithReactions[] }[] = [];
  let currentDate = "";

  for (const msg of messages) {
    const day = format(new Date(msg.created_at), "yyyy-MM-dd");
    if (day !== currentDate) {
      currentDate = day;
      groups.push({ date: msg.created_at, messages: [msg] });
    } else {
      groups[groups.length - 1].messages.push(msg);
    }
  }

  return groups;
}

// "Closed" is deliberately excluded — closing a conversation always
// goes through CloseConversationModal (the client wants an explicit
// reason recorded), never a silent dropdown flip.
const STATUS_OPTIONS: { label: string; value: ConversationStatus; color: string }[] = [
  { label: "Open", value: "open", color: "text-primary" },
  { label: "Pending", value: "pending", color: "text-amber-400" },
];

const DOODLE_BG_CLASSES =
  "bg-background bg-[url('/inbox-doodle.svg')] bg-repeat";

export function MessageThread({
  conversationId,
  onConversationLoaded,
  onBack,
  contactPanelOpen,
  onToggleContactPanel,
}: MessageThreadProps) {
  const t = useTranslations("Inbox.messageThread");
  const tQuote = useTranslations("Inbox.replyQuote");

  const { user } = useAuth();
  const { getPresence, getRow, now } = usePresence();

  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [contact, setContact] = useState<Contact | null>(null);
  const [messages, setMessages] = useState<MessageWithReactions[]>([]);
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [members, setMembers] = useState<AccountMemberLite[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [replyTo, setReplyTo] = useState<ReplyDraft | null>(null);
  const [closeModalOpen, setCloseModalOpen] = useState(false);

  useEffect(() => {
    return () => {
      if (refreshTimerRef.current !== null) clearTimeout(refreshTimerRef.current);
    };
  }, []);

  // Teammates for the assign dropdown — rarely changes, fetch once.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/account/members", { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        const rows = (data.members ?? []) as { user_id: string; full_name: string }[];
        setMembers(rows.map((m) => ({ user_id: m.user_id, full_name: m.full_name })));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Departments for the transfer dropdown — same fetch-once-and-cache
  // shape as teammates above.
  const [departments, setDepartments] = useState<{ id: string; name: string; color: string }[]>([]);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/departments", { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        setDepartments(data.departments ?? []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const onConversationLoadedRef = useRef(onConversationLoaded);
  useEffect(() => {
    onConversationLoadedRef.current = onConversationLoaded;
  });

  // Fetch the conversation + its full message thread. Polled on an
  // interval instead of Supabase Realtime (there's no realtime layer
  // anymore — see AGENTS.md). Opening the thread (this fetch) also
  // resets the server-side unread_count, handled by the messages route.
  const fetchThread = useCallback(
    async (id: string, opts: { showSpinner: boolean }) => {
      if (opts.showSpinner) setLoading(true);
      try {
        const [convRes, msgRes] = await Promise.all([
          fetch(`/api/conversations/${id}`, { cache: "no-store" }),
          fetch(`/api/conversations/${id}/messages`, { cache: "no-store" }),
        ]);
        if (!convRes.ok || !msgRes.ok) return;
        const convData = await convRes.json();
        const msgData = await msgRes.json();
        const conv = convData.conversation as Conversation;
        setConversation(conv);
        setContact(conv.contact ?? null);
        setMessages((msgData.messages ?? []) as MessageWithReactions[]);
        onConversationLoadedRef.current?.(conv);
      } catch (err) {
        console.error("Failed to fetch thread:", err);
      } finally {
        if (opts.showSpinner) setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (!conversationId) {
      setConversation(null);
      setContact(null);
      setMessages([]);
      return;
    }
    void fetchThread(conversationId, { showSpinner: true });
    const timer = setInterval(() => {
      void fetchThread(conversationId, { showSpinner: false });
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [conversationId, fetchThread]);

  const handleRefreshClick = useCallback(() => {
    if (isRefreshing || !conversationId) return;
    setIsRefreshing(true);
    void fetchThread(conversationId, { showSpinner: false });
    refreshTimerRef.current = setTimeout(() => {
      setIsRefreshing(false);
      refreshTimerRef.current = null;
    }, 700);
  }, [isRefreshing, conversationId, fetchThread]);

  // Clear any in-progress reply draft when the active conversation changes.
  useEffect(() => {
    setReplyTo(null);
  }, [conversationId]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      const el = scrollRef.current;
      el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  const handleSend = useCallback(
    async (text: string, replyToId?: string) => {
      if (!conversation) return;

      const tempId = `temp-${Date.now()}`;
      const optimisticMsg: MessageWithReactions = {
        id: tempId,
        conversation_id: conversation.id,
        sender_type: "agent",
        content_type: "text",
        content_text: text,
        status: "sending",
        created_at: new Date().toISOString(),
        reply_to_message_id: replyToId,
        reactions: [],
      };
      setMessages((prev) => [...prev, optimisticMsg]);
      setReplyTo(null);

      try {
        const res = await fetch(`/api/conversations/${conversation.id}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message_type: "text",
            content_text: text,
            reply_to_message_id: replyToId,
          }),
        });
        const payload = await res.json().catch(() => ({}));

        if (!res.ok) {
          const reason = payload?.error || `HTTP ${res.status}`;
          toast.error(`Failed to send: ${reason}`);
          setMessages((prev) => prev.filter((m) => m.id !== tempId));
          return;
        }

        const sent = payload.message as MessageWithReactions | undefined;
        setMessages((prev) => {
          const withoutTemp = prev.filter((m) => m.id !== tempId);
          return sent ? [...withoutTemp, sent] : withoutTemp;
        });
        if (payload.error) {
          toast.error(`Message saved but WhatsApp send failed: ${payload.error}`);
        }
      } catch (err) {
        const reason = err instanceof Error ? err.message : "network error";
        toast.error(`Failed to send: ${reason}`);
        setMessages((prev) => prev.filter((m) => m.id !== tempId));
      }
    },
    [conversation],
  );

  const handleSendMedia = useCallback(
    async (payload: SendMediaPayload) => {
      if (!conversation) return;

      const contentText =
        payload.kind === "document"
          ? payload.caption || payload.filename || "Document"
          : payload.caption;

      const tempId = `temp-${Date.now()}`;
      const optimisticMsg: MessageWithReactions = {
        id: tempId,
        conversation_id: conversation.id,
        sender_type: "agent",
        content_type: payload.kind,
        content_text: contentText,
        media_url: payload.mediaUrl,
        status: "sending",
        created_at: new Date().toISOString(),
        reply_to_message_id: payload.replyToId,
        reactions: [],
      };
      setMessages((prev) => [...prev, optimisticMsg]);
      setReplyTo(null);

      try {
        const res = await fetch(`/api/conversations/${conversation.id}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message_type: payload.kind,
            media_url: payload.mediaUrl,
            content_text: contentText,
            filename: payload.filename,
            reply_to_message_id: payload.replyToId,
          }),
        });
        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
          const reason = data?.error || `HTTP ${res.status}`;
          toast.error(`Failed to send: ${reason}`);
          setMessages((prev) => prev.filter((m) => m.id !== tempId));
          void deleteAccountMedia(CHAT_MEDIA_BUCKET, payload.path).catch(() => {});
          return;
        }

        const sent = data.message as MessageWithReactions | undefined;
        setMessages((prev) => {
          const withoutTemp = prev.filter((m) => m.id !== tempId);
          return sent ? [...withoutTemp, sent] : withoutTemp;
        });
        if (data.error) {
          toast.error(`Message saved but WhatsApp send failed: ${data.error}`);
        }
      } catch (err) {
        const reason = err instanceof Error ? err.message : "network error";
        toast.error(`Failed to send: ${reason}`);
        setMessages((prev) => prev.filter((m) => m.id !== tempId));
        void deleteAccountMedia(CHAT_MEDIA_BUCKET, payload.path).catch(() => {});
      }
    },
    [conversation],
  );

  const handleStatusChange = useCallback(
    async (status: ConversationStatus) => {
      if (!conversation) return;
      setConversation((prev) => (prev ? { ...prev, status } : prev));
      const res = await fetch(`/api/conversations/${conversation.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        toast.error("Failed to update status");
      }
    },
    [conversation],
  );

  const handleConfirmClose = useCallback(
    async (reason: CloseReason) => {
      if (reason === "survey") {
        await handleSend(SURVEY_MESSAGE);
      }
      await handleStatusChange("closed");
    },
    [handleSend, handleStatusChange],
  );

  // Build a quick id → Message map so reply quotes can be rendered without
  // an extra fetch — the thread already holds the full conversation.
  const messagesById = useMemo(() => {
    const map = new Map<string, MessageWithReactions>();
    for (const m of messages) map.set(m.id, m);
    return map;
  }, [messages]);

  const contactDisplayName = contact?.name || contact?.phone || "Customer";

  const authorLabelFor = useCallback(
    (m: Message): string => {
      const isAgentMsg = m.sender_type === "agent" || m.sender_type === "bot";
      return isAgentMsg ? "You" : contactDisplayName;
    },
    [contactDisplayName],
  );

  const handleStartReply = useCallback(
    (msg: Message) => {
      setReplyTo({
        id: msg.id,
        authorLabel: authorLabelFor(msg),
        preview: buildReplyPreview(msg, tQuote),
      });
    },
    [authorLabelFor, tQuote],
  );

  // Single reaction-set primitive. emoji === "" removes; otherwise adds/swaps.
  const postReaction = useCallback(
    async (messageId: string, emoji: string) => {
      if (!user?.id || !conversation) return;
      if (messageId.startsWith("temp-")) {
        toast.error("Wait for the message to finish sending");
        return;
      }

      const convId = conversation.id;
      const userId = user.id;
      let snapshot: MessageWithReactions[] = [];

      setMessages((prev) => {
        snapshot = prev;
        return prev.map((m) => {
          if (m.id !== messageId) return m;
          const own = m.reactions.find(
            (r) => r.actor_type === "agent" && r.actor_id === userId,
          );
          if (emoji === "") {
            return { ...m, reactions: m.reactions.filter((r) => r !== own) };
          }
          if (own) {
            return {
              ...m,
              reactions: m.reactions.map((r) => (r === own ? { ...own, emoji } : r)),
            };
          }
          return {
            ...m,
            reactions: [
              ...m.reactions,
              {
                id: `temp-${Date.now()}`,
                message_id: messageId,
                conversation_id: convId,
                actor_type: "agent" as const,
                actor_id: userId,
                emoji,
                created_at: new Date().toISOString(),
              },
            ],
          };
        });
      });

      try {
        const res =
          emoji === ""
            ? await fetch(`/api/conversations/${convId}/reactions/${messageId}`, {
                method: "DELETE",
              })
            : await fetch(`/api/conversations/${convId}/reactions`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ message_id: messageId, emoji }),
              });
        if (!res.ok) {
          const payload = await res.json().catch(() => ({}));
          throw new Error(payload?.error || `HTTP ${res.status}`);
        }
      } catch (err) {
        const reason = err instanceof Error ? err.message : "network error";
        toast.error(`Reaction failed: ${reason}`);
        setMessages(snapshot);
      }
    },
    [conversation, user?.id],
  );

  const handleAssignChange = useCallback(
    async (agentId: string | null) => {
      if (!conversation) return;
      setConversation((prev) => (prev ? { ...prev, assigned_agent_id: agentId ?? undefined } : prev));
      const res = await fetch(`/api/conversations/${conversation.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assigned_agent_id: agentId }),
      });
      if (!res.ok) {
        toast.error("Failed to update assignment");
      }
    },
    [conversation],
  );

  // Transferring to a department releases the current assignment
  // server-side (see PATCH /api/conversations/[id]) — mirror that
  // locally so the header doesn't show a stale assignee.
  const handleDepartmentChange = useCallback(
    async (departmentId: string | null) => {
      if (!conversation) return;
      setConversation((prev) =>
        prev ? { ...prev, department_id: departmentId, assigned_agent_id: undefined } : prev,
      );
      const res = await fetch(`/api/conversations/${conversation.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ department_id: departmentId }),
      });
      if (!res.ok) {
        toast.error("Falha ao transferir a conversa");
      } else {
        toast.success(departmentId ? "Conversa transferida" : "Conversa removida do setor");
      }
    },
    [conversation],
  );

  // Empty state — same doodle background as the active thread below, so
  // swapping between empty/selected doesn't change the pattern under the
  // user's eye.
  if (!conversationId || !conversation || !contact) {
    return (
      <div className={cn("flex flex-1 flex-col items-center justify-center", DOODLE_BG_CLASSES)}>
        {loading ? (
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        ) : (
          <>
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
              <MessageSquare className="h-8 w-8 text-muted-foreground" />
            </div>
            <h3 className="mt-4 text-sm font-medium text-muted-foreground">
              {t("selectConversation")}
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
              {t("selectConversationHint")}
            </p>
          </>
        )}
      </div>
    );
  }

  const displayName = contact.name || contact.phone;
  const messageGroups = groupMessagesByDate(messages);
  const currentStatus =
    conversation.status === "closed"
      ? { label: "Closed", value: "closed" as const, color: "text-muted-foreground" }
      : STATUS_OPTIONS.find((s) => s.value === conversation.status);
  const assignedAgentId = conversation.assigned_agent_id ?? null;
  const currentAssignee = members.find((p) => p.user_id === assignedAgentId);
  const assignLabel = assignedAgentId
    ? (currentAssignee?.full_name ?? t("assigned"))
    : t("assign");

  return (
    <div className={cn("flex min-w-0 flex-1 flex-col", DOODLE_BG_CLASSES)}>
      {/* Header */}
      <div className="flex items-center justify-between gap-2 border-b border-border bg-card px-3 py-3 sm:px-4">
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              aria-label={t("backToConversations")}
              className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground lg:hidden"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
          )}
          <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-muted text-sm font-medium text-foreground">
            {displayName.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-foreground">{displayName}</h2>
            <p className="truncate text-xs text-muted-foreground">{contact.phone}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {onToggleContactPanel && (
            <button
              type="button"
              onClick={onToggleContactPanel}
              aria-label={
                contactPanelOpen ? t("hideContactPanel") : t("showContactPanel")
              }
              title={contactPanelOpen ? t("hideContact") : t("showContact")}
              aria-pressed={contactPanelOpen}
              className={cn(
                "hidden h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-muted hover:text-foreground lg:inline-flex",
                contactPanelOpen ? "text-primary" : "text-muted-foreground",
              )}
            >
              {contactPanelOpen ? (
                <PanelRightClose className="h-4 w-4" />
              ) : (
                <PanelRightOpen className="h-4 w-4" />
              )}
            </button>
          )}

          <button
            type="button"
            onClick={handleRefreshClick}
            disabled={isRefreshing}
            aria-label={t("refreshConversation")}
            title={t("refresh")}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-60"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", isRefreshing && "animate-spin")} />
          </button>

          {/* Status dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger className={cn(
                  "inline-flex items-center justify-center h-7 gap-1 px-2 text-xs rounded-md hover:bg-muted",
                  currentStatus?.color ?? "text-muted-foreground"
                )}>
                {currentStatus ? t(`status${currentStatus.label}`) : t("status")}
                <ChevronDown className="h-3 w-3" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="border-border bg-popover">
              {STATUS_OPTIONS.map((opt) => (
                <DropdownMenuItem
                  key={opt.value}
                  onClick={() => handleStatusChange(opt.value)}
                  className={cn("text-sm", opt.color)}
                >
                  {t(`status${opt.label}`)}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Assign dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger
              className={cn(
                "inline-flex items-center justify-center h-7 gap-1 px-2 text-xs rounded-md hover:bg-muted",
                assignedAgentId ? "text-primary" : "text-muted-foreground"
              )}
            >
              <UserPlus className="h-3 w-3" />
              <span className="hidden sm:inline">{assignLabel}</span>
              <ChevronDown className="h-3 w-3" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="border-border bg-popover">
              {members.length === 0 ? (
                <DropdownMenuItem disabled className="text-sm text-muted-foreground">
                  {t("noTeammates")}
                </DropdownMenuItem>
              ) : (
                members.map((p) => {
                  const isSelected = p.user_id === assignedAgentId;
                  const presence = getPresence(p.user_id);
                  return (
                    <DropdownMenuItem
                      key={p.user_id}
                      onClick={() => handleAssignChange(p.user_id)}
                      className={cn(
                        "text-sm",
                        isSelected ? "text-primary" : "text-popover-foreground"
                      )}
                    >
                      <PresenceDot
                        status={presence}
                        label={presenceLabel(
                          presence,
                          getRow(p.user_id)?.last_seen_at ?? null,
                          now
                        )}
                        className="mr-2"
                      />
                      <span className="flex-1">
                        {p.full_name}
                        {p.user_id === user?.id ? t("me") : ""}
                      </span>
                      {isSelected && <Check className="ml-2 h-3 w-3" />}
                    </DropdownMenuItem>
                  );
                })
              )}
              {assignedAgentId && (
                <>
                  <DropdownMenuSeparator className="bg-border" />
                  <DropdownMenuItem
                    onClick={() => handleAssignChange(null)}
                    className="text-sm text-muted-foreground"
                  >
                    {t("unassign")}
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Transfer-to-department dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger
              className={cn(
                "inline-flex items-center justify-center h-7 gap-1 px-2 text-xs rounded-md hover:bg-muted",
                conversation.department_id ? "text-primary" : "text-muted-foreground",
              )}
            >
              <Users2 className="h-3 w-3" />
              <span className="hidden sm:inline">
                {departments.find((d) => d.id === conversation.department_id)?.name ?? "Setor"}
              </span>
              <ChevronDown className="h-3 w-3" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="border-border bg-popover">
              {departments.length === 0 ? (
                <DropdownMenuItem disabled className="text-sm text-muted-foreground">
                  Nenhum setor criado
                </DropdownMenuItem>
              ) : (
                departments.map((d) => {
                  const isSelected = d.id === conversation.department_id;
                  return (
                    <DropdownMenuItem
                      key={d.id}
                      onClick={() => handleDepartmentChange(d.id)}
                      className={cn("text-sm", isSelected ? "text-primary" : "text-popover-foreground")}
                    >
                      <span
                        className="mr-2 inline-block size-2 rounded-full"
                        style={{ backgroundColor: d.color }}
                      />
                      <span className="flex-1">{d.name}</span>
                      {isSelected && <Check className="ml-2 h-3 w-3" />}
                    </DropdownMenuItem>
                  );
                })
              )}
              {conversation.department_id && (
                <>
                  <DropdownMenuSeparator className="bg-border" />
                  <DropdownMenuItem
                    onClick={() => handleDepartmentChange(null)}
                    className="text-sm text-muted-foreground"
                  >
                    Remover do setor
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          {conversation.status !== "closed" && (
            <button
              type="button"
              onClick={() => setCloseModalOpen(true)}
              className="inline-flex h-7 items-center justify-center gap-1.5 rounded-md bg-red-500/10 px-2.5 text-xs font-medium text-red-400 transition-colors hover:bg-red-500/20"
            >
              <CircleX className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Encerrar Atendimento</span>
            </button>
          )}
        </div>
      </div>

      {/* Messages Area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12">
            <p className="text-sm text-muted-foreground">{t("noMessagesYet")}</p>
          </div>
        ) : (
          <div className="space-y-4">
            {messageGroups.map((group) => (
              <div key={group.date}>
                <div className="mb-4 flex items-center justify-center">
                  <span className="rounded-full bg-muted px-3 py-1 text-[10px] font-medium text-muted-foreground">
                    {formatDateSeparator(group.date, t)}
                  </span>
                </div>
                <div className="space-y-2">
                  {group.messages.map((msg) => {
                    const parent = msg.reply_to_message_id
                      ? messagesById.get(msg.reply_to_message_id)
                      : null;
                    const reply = parent
                      ? {
                          authorLabel:
                            parent.sender_type === "agent" || parent.sender_type === "bot"
                              ? t("me")
                              : contact?.name || contact?.phone || "Unknown",
                          preview: buildReplyPreview(parent, tQuote),
                        }
                      : null;
                    const msgReactions = msg.reactions;
                    const handlePillToggle = (emoji: string) => {
                      const own = msgReactions.find(
                        (r) => r.actor_type === "agent" && r.actor_id === user?.id,
                      );
                      const next = own?.emoji === emoji ? "" : emoji;
                      void postReaction(msg.id, next);
                    };
                    return (
                      <MessageActions
                        key={msg.id}
                        message={msg}
                        onReply={() => handleStartReply(msg)}
                        onReact={(emoji) => {
                          if (emoji) void postReaction(msg.id, emoji);
                        }}
                      >
                        <MessageBubble
                          message={msg}
                          reply={reply}
                          reactions={msgReactions}
                          currentUserId={user?.id}
                          onToggleReaction={handlePillToggle}
                        />
                      </MessageActions>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Composer */}
      <MessageComposer
        conversationId={conversation.id}
        onSend={handleSend}
        onSendMedia={handleSendMedia}
        replyTo={replyTo}
        onClearReply={() => setReplyTo(null)}
        contactName={contact.name ?? undefined}
      />

      <CloseConversationModal
        open={closeModalOpen}
        onOpenChange={setCloseModalOpen}
        onConfirm={handleConfirmClose}
      />
    </div>
  );
}
