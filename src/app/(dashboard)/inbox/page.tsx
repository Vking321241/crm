"use client";

import { useState, useCallback, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import type { Contact, Conversation } from "@/types";
import { ConversationList } from "@/components/inbox/conversation-list";
import { MessageThread } from "@/components/inbox/message-thread";
import { ContactSidebar } from "@/components/inbox/contact-sidebar";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";

// Remembers the agent's show/hide choice for the desktop contact panel
// across reloads and sessions (device-scoped, like the theme prefs).
const CONTACT_PANEL_STORAGE_KEY = "wacrm:inbox:contact-panel-open";

export default function InboxPage() {
  useTranslations("Inbox.page");
  const router = useRouter();
  const searchParams = useSearchParams();
  const { hasPermission, profileLoading } = useAuth();
  // `?c=<id>` deep-link support (e.g. from the dashboard's recent-
  // conversations list) — read once via the lazy initializer so it's
  // captured on first render, not re-read as a ref during render.
  const [activeConversationId, setActiveConversationId] = useState<string | null>(
    () => searchParams.get("c"),
  );
  const [activeConversation, setActiveConversation] = useState<Conversation | null>(null);

  /**
   * Whether the desktop contact sidebar (tags / deals / notes) is shown.
   * Defaults to `true` (the historical behaviour) and is restored from
   * localStorage after mount to avoid a hydration mismatch.
   */
  const [contactPanelOpen, setContactPanelOpen] = useState(true);
  useEffect(() => {
    try {
      const stored = localStorage.getItem(CONTACT_PANEL_STORAGE_KEY);
      if (stored !== null) setContactPanelOpen(stored === "true");
    } catch {
      // localStorage can throw in private-browsing / sandboxed contexts.
    }
  }, []);

  const handleToggleContactPanel = useCallback(() => {
    setContactPanelOpen((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(CONTACT_PANEL_STORAGE_KEY, String(next));
      } catch {
        // Persistence is best-effort; ignore storage failures.
      }
      return next;
    });
  }, []);

  const handleSelectConversation = useCallback(
    (conv: Conversation) => {
      if (activeConversationId === conv.id) return;
      setActiveConversationId(conv.id);
      setActiveConversation(conv);
      // Every freshly opened conversation starts with the contact
      // panel minimized — the agent expands it on demand instead of
      // it eating screen space by default on every open.
      setContactPanelOpen(false);
      router.replace(`/inbox?c=${conv.id}`, { scroll: false });
    },
    [activeConversationId, router],
  );

  const handleContactUpdated = useCallback((updated: Contact) => {
    setActiveConversation((prev) =>
      prev && prev.contact?.id === updated.id ? { ...prev, contact: updated } : prev,
    );
  }, []);

  // Mobile "back" — deselect the conversation so the list pane comes
  // back. Also clears the ?c= param so a refresh lands on the list
  // instead of re-opening the thread the user just backed out of.
  const handleCloseConversation = useCallback(() => {
    setActiveConversationId(null);
    setActiveConversation(null);
    router.replace("/inbox", { scroll: false });
  }, [router]);

  const handleConversationLoaded = useCallback((conv: Conversation) => {
    setActiveConversation(conv);
  }, []);

  // On mobile (<lg) we show a SINGLE pane — either the list or the
  // thread — rather than cramming both side-by-side.
  const hasActiveConv = !!activeConversationId;
  const activeContact = activeConversation?.contact ?? null;

  if (!profileLoading && !hasPermission('inbox')) {
    return (
      <div className="flex h-64 items-center justify-center">
        <p className="text-sm text-muted-foreground">
          Você não tem acesso à Central de Atendimento. Peça a um gerente para liberar em
          Configurações → Permissões.
        </p>
      </div>
    );
  }

  return (
    <div className="-m-4 flex h-[calc(100vh-3.5rem)] flex-col overflow-hidden sm:-m-6">
      <div className="flex flex-1 overflow-hidden">
        {/* Left panel: Conversation list. */}
        <div
          className={cn(
            "flex h-full flex-1 lg:flex-none",
            hasActiveConv ? "hidden lg:flex" : "flex",
          )}
        >
          <ConversationList
            activeConversationId={activeConversationId}
            onSelect={handleSelectConversation}
          />
        </div>

        {/* Center panel: Message thread. */}
        <div
          className={cn(
            "flex h-full min-w-0 flex-1 lg:flex",
            hasActiveConv ? "flex" : "hidden lg:flex",
          )}
        >
          <MessageThread
            conversationId={activeConversationId}
            onConversationLoaded={handleConversationLoaded}
            onBack={handleCloseConversation}
            contactPanelOpen={contactPanelOpen}
            onToggleContactPanel={handleToggleContactPanel}
            contactOverride={activeContact}
          />
        </div>

        {/* Right panel: Contact sidebar — desktop only. */}
        {contactPanelOpen && (
          <div className="hidden lg:block">
            <ContactSidebar
              contact={activeContact}
              conversationId={activeConversationId}
              onContactUpdated={handleContactUpdated}
            />
          </div>
        )}
      </div>
    </div>
  );
}
