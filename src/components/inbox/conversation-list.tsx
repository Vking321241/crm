"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { cn } from "@/lib/utils";
import type { Conversation, ConversationStatus } from "@/types";
import { Search, ChevronDown, X, UserCheck, AlertTriangle, Archive } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";

interface DepartmentLite {
  id: string;
  name: string;
  color: string;
}

interface ConversationListProps {
  activeConversationId: string | null;
  onSelect: (conversation: Conversation) => void;
}

const STATUS_COLORS: Record<ConversationStatus, string> = {
  open: "bg-primary",
  pending: "bg-amber-500",
  closed: "bg-muted-foreground",
};

/** Poll cadence for the conversation list — no more Supabase Realtime. */
const POLL_MS = 5000;

/** A "Pendente" conversation waiting longer than this gets the
 *  amber wait-time alert on its list row. */
const PENDING_ALERT_MINUTES = 15;

// "Fechados" is deliberately NOT one of the main tabs — it renders
// as a compact icon button instead (see the corner button below),
// keeping the primary row focused on the two states an agent acts
// on day-to-day.
const STATUS_TABS: { value: ConversationStatus; label: string }[] = [
  { value: "open", label: "Ativos" },
  { value: "pending", label: "Pendentes" },
];

export function ConversationList({
  activeConversationId,
  onSelect,
}: ConversationListProps) {
  const t = useTranslations("Inbox.conversationList");

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<ConversationStatus>("open");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [counts, setCounts] = useState<Record<ConversationStatus, number>>({
    open: 0,
    pending: 0,
    closed: 0,
  });
  const [loading, setLoading] = useState(true);
  // Company filter — derived from whatever conversations are already
  // loaded (there's no separate companies table). Tag filtering was
  // dropped: it depended on a `/api/tags` endpoint that isn't part of
  // this fatia's scope.
  const [selectedCompany, setSelectedCompany] = useState<string | null>(null);
  // "Minhas conversas" — only what's assigned to the acting agent, so
  // an agent's own queue doesn't get lost in the account's full list.
  const [mineOnly, setMineOnly] = useState(false);
  const [departments, setDepartments] = useState<DepartmentLite[]>([]);
  const [selectedDepartment, setSelectedDepartment] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/departments", { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => setDepartments(data.departments ?? []))
      .catch(() => {});
  }, []);

  const fetchConversations = useCallback(async () => {
    const params = new URLSearchParams();
    params.set("status", filter);
    if (search.trim()) params.set("search", search.trim());
    if (mineOnly) params.set("assignedToMe", "1");
    if (selectedDepartment) params.set("departmentId", selectedDepartment);
    const qs = params.toString();
    const res = await fetch(`/api/conversations${qs ? `?${qs}` : ""}`, { cache: "no-store" });
    if (!res.ok) {
      console.error("Failed to fetch conversations:", res.status);
      return null;
    }
    const data = await res.json();
    return (data.conversations ?? []) as Conversation[];
  }, [filter, search, mineOnly, selectedDepartment]);

  const fetchCounts = useCallback(async () => {
    const res = await fetch("/api/conversations/counts", { cache: "no-store" });
    if (!res.ok) return;
    const data = await res.json().catch(() => null);
    if (data?.counts) setCounts(data.counts);
  }, []);

  useEffect(() => {
    const kick = setTimeout(() => void fetchCounts(), 0);
    const timer = setInterval(() => void fetchCounts(), POLL_MS);
    return () => {
      clearTimeout(kick);
      clearInterval(timer);
    };
  }, [fetchCounts]);

  // Ticks every 30s so the pending wait-time alert (Date.now()-based)
  // updates live without depending on the next conversations poll.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  // Debounced fetch on filter/search change + poll loop. Search/filter
  // changes reset the poll timer so a fast typist doesn't stack requests.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const run = async (showSpinner: boolean) => {
      if (showSpinner) setLoading(true);
      const loaded = await fetchConversations();
      if (!cancelled && loaded) setConversations(loaded);
      if (!cancelled && showSpinner) setLoading(false);
    };

    const debounce = setTimeout(() => {
      void run(true).then(() => {
        if (cancelled) return;
        timer = setInterval(() => void run(false), POLL_MS);
      });
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(debounce);
      if (timer) clearInterval(timer);
    };
  }, [fetchConversations]);

  const companies = useMemo(() => {
    const set = new Set<string>();
    for (const c of conversations) {
      const co = c.contact?.company?.trim();
      if (co) set.add(co);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [conversations]);

  const filtered = useMemo(() => {
    let result = conversations;

    if (unreadOnly) {
      result = result.filter((c) => c.unread_count > 0);
    }
    // status filter is applied server-side already (see fetchConversations)

    if (selectedCompany !== null) {
      result = result.filter((c) => c.contact?.company?.trim() === selectedCompany);
    }

    return result;
  }, [conversations, unreadOnly, selectedCompany]);

  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setSearch(e.target.value);
    },
    []
  );

  const handleSelect = useCallback(
    (conv: Conversation) => {
      onSelect(conv);
    },
    [onSelect]
  );

  return (
    <div className="flex h-full w-full flex-col border-r border-border bg-card lg:w-80">
      {/* Status tabs — Ativos / Pendentes, + Fechados as a corner icon */}
      <div className="flex items-center border-b border-border">
        {STATUS_TABS.map((tab) => {
          const isActive = filter === tab.value;
          const pendingWaiting =
            tab.value === "pending" &&
            conversations.some(
              (c) =>
                c.status === "pending" &&
                c.last_message_at &&
                nowMs - new Date(c.last_message_at).getTime() > PENDING_ALERT_MINUTES * 60_000,
            );
          return (
            <button
              key={tab.value}
              type="button"
              onClick={() => setFilter(tab.value)}
              className={cn(
                "flex flex-1 items-center justify-center gap-1.5 border-b-2 px-2 py-2.5 text-xs font-medium transition-colors",
                isActive
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {tab.value === "pending" && pendingWaiting && (
                <AlertTriangle className="size-3 text-amber-500" />
              )}
              {tab.label}
              <span
                className={cn(
                  "inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold",
                  isActive ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
                )}
              >
                {counts[tab.value]}
              </span>
            </button>
          );
        })}

        <button
          type="button"
          onClick={() => setFilter("closed")}
          title="Fechados"
          aria-pressed={filter === "closed"}
          className={cn(
            "relative flex shrink-0 items-center justify-center border-b-2 px-3 py-2.5 transition-colors",
            filter === "closed"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          <Archive className="size-4" />
          {counts.closed > 0 && (
            <span className="absolute right-1 top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-muted px-0.5 text-[9px] font-bold text-muted-foreground">
              {counts.closed}
            </span>
          )}
        </button>
      </div>

      {/* Search + Filter */}
      <div className="space-y-2 border-b border-border p-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={handleSearchChange}
            placeholder={t("searchPlaceholder")}
            className="border-border bg-muted pl-9 text-sm text-foreground placeholder-muted-foreground focus:border-primary/50"
          />
        </div>

        <div className="flex flex-wrap items-center gap-1">
          <button
            type="button"
            onClick={() => setUnreadOnly((v) => !v)}
            aria-pressed={unreadOnly}
            className={cn(
              "inline-flex items-center justify-center h-7 gap-1 px-2 text-xs rounded-md hover:bg-muted",
              unreadOnly ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t("filterUnread")}
          </button>

          <button
            type="button"
            onClick={() => setMineOnly((v) => !v)}
            aria-pressed={mineOnly}
            className={cn(
              "inline-flex items-center justify-center h-7 gap-1 px-2 text-xs rounded-md hover:bg-muted",
              mineOnly ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <UserCheck className="h-3 w-3" />
            Minhas
          </button>

          {departments.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger
                className={cn(
                  "inline-flex max-w-32 items-center justify-center h-7 gap-1 px-2 text-xs rounded-md hover:bg-muted",
                  selectedDepartment ? "text-primary" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <span className="truncate">
                  {departments.find((d) => d.id === selectedDepartment)?.name ?? "Setor"}
                </span>
                <ChevronDown className="h-3 w-3 shrink-0" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="max-h-64 w-56 border-border bg-popover">
                <DropdownMenuItem
                  onClick={() => setSelectedDepartment(null)}
                  className={cn("text-sm", selectedDepartment === null ? "text-primary" : "text-popover-foreground")}
                >
                  Todos os setores
                </DropdownMenuItem>
                {departments.map((d) => (
                  <DropdownMenuItem
                    key={d.id}
                    onClick={() => setSelectedDepartment(d.id)}
                    className={cn("text-sm", selectedDepartment === d.id ? "text-primary" : "text-popover-foreground")}
                  >
                    <span className="mr-2 inline-block size-2 rounded-full" style={{ backgroundColor: d.color }} />
                    <span className="truncate">{d.name}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {companies.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger
                className={cn(
                  "inline-flex max-w-40 items-center justify-center h-7 gap-1 px-2 text-xs rounded-md hover:bg-muted",
                  selectedCompany
                    ? "text-primary"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <span className="truncate">{selectedCompany ?? t("company")}</span>
                <ChevronDown className="h-3 w-3 shrink-0" />
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                className="max-h-64 w-56 border-border bg-popover"
              >
                <DropdownMenuItem
                  onClick={() => setSelectedCompany(null)}
                  className={cn(
                    "text-sm",
                    selectedCompany === null
                      ? "text-primary"
                      : "text-popover-foreground"
                  )}
                >
                  {t("allCompanies")}
                </DropdownMenuItem>
                {companies.map((co) => (
                  <DropdownMenuItem
                    key={co}
                    onClick={() => setSelectedCompany(co)}
                    className={cn(
                      "text-sm",
                      selectedCompany === co
                        ? "text-primary"
                        : "text-popover-foreground"
                    )}
                  >
                    <span className="truncate">{co}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        {selectedCompany && (
          <div className="flex flex-wrap items-center gap-1">
            <button
              onClick={() => setSelectedCompany(null)}
              className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] text-foreground hover:bg-muted/70"
            >
              <span className="max-w-24 truncate">{selectedCompany}</span>
              <X className="h-3 w-3" />
            </button>
          </div>
        )}
      </div>

      {/* Conversation Items */}
      <ScrollArea className="min-h-0 flex-1">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <p className="text-sm text-muted-foreground">{t("noConversations")}</p>
          </div>
        ) : (
          <div className="flex flex-col">
            {filtered.map((conv) => (
              <ConversationItem
                key={conv.id}
                conversation={conv}
                isActive={conv.id === activeConversationId}
                onSelect={handleSelect}
                t={t}
                nowMs={nowMs}
              />
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}

interface ConversationItemProps {
  conversation: Conversation;
  isActive: boolean;
  onSelect: (conversation: Conversation) => void;
  t: ReturnType<typeof useTranslations>;
  nowMs: number;
}

function ConversationItem({
  conversation,
  isActive,
  onSelect,
  t,
  nowMs,
}: ConversationItemProps) {
  const contact = conversation.contact;
  const displayName = contact?.name || contact?.phone || t("unknown");
  const initials = displayName.charAt(0).toUpperCase();

  const handleClick = useCallback(() => {
    onSelect(conversation);
  }, [onSelect, conversation]);

  const timeAgo = conversation.last_message_at
    ? formatDistanceToNow(new Date(conversation.last_message_at), {
        addSuffix: false,
      })
    : "";

  const isWaitingTooLong =
    conversation.status === "pending" &&
    conversation.last_message_at &&
    nowMs - new Date(conversation.last_message_at).getTime() > PENDING_ALERT_MINUTES * 60_000;

  return (
    <button
      onClick={handleClick}
      className={cn(
        "flex w-full items-start gap-3 px-3 py-3 text-left transition-colors hover:bg-muted/50",
        isActive && "border-l-2 border-primary bg-muted/70"
      )}
    >
      {/* Avatar */}
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-medium text-foreground">
        {contact?.avatar_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={contact.avatar_url}
            alt={displayName}
            className="h-10 w-10 rounded-full object-cover"
          />
        ) : (
          initials
        )}
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-sm font-medium text-foreground">
            {displayName}
          </span>
          <span className="flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground">
            {isWaitingTooLong && <AlertTriangle className="size-3 text-amber-500" />}
            {timeAgo}
          </span>
        </div>
        <div className="mt-0.5 flex items-center justify-between gap-2">
          <p className="truncate text-xs text-muted-foreground">
            {conversation.last_message_text || t("noMessagesYet")}
          </p>
          <div className="flex shrink-0 items-center gap-1.5">
            {conversation.unread_count > 0 && (
              <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
                {conversation.unread_count}
              </span>
            )}
            <span
              className={cn(
                "h-2 w-2 rounded-full",
                STATUS_COLORS[conversation.status]
              )}
              title={conversation.status}
            />
          </div>
        </div>
        {conversation.tags && conversation.tags.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {conversation.tags.map((tag) => (
              <span
                key={tag.id}
                className="rounded-full px-1.5 py-0.5 text-[9px] font-medium"
                style={{ backgroundColor: `${tag.color}20`, color: tag.color }}
              >
                {tag.name}
              </span>
            ))}
          </div>
        )}
      </div>
    </button>
  );
}
