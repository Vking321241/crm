"use client";

import { useState, type ReactNode } from "react";
import { CornerUpLeft, Copy, SmilePlus, Forward, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from "@/components/ui/context-menu";
import type { Message } from "@/types";
import { useTranslations } from "next-intl";

// WhatsApp's own quick-reaction bar starts with these six. Picking the same
// set keeps the affordance familiar without pulling in a 300KB emoji library.
const QUICK_EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

interface MessageActionsProps {
  message: Message;
  onReply: () => void;
  onReact: (emoji: string) => void;
  onForward: () => void;
  /** Own text message, still inside the edit window. */
  canEdit: boolean;
  onEdit: () => void;
  /** Own message, not already deleted. */
  canDelete: boolean;
  onDelete: () => void;
  children: ReactNode;
}

/**
 * Hover toolbar (quick reply/react/copy, mouse-only) + right-click/
 * long-press context menu (full action list, including edit/delete/
 * forward) wrapper around a `<MessageBubble>`. The bubble itself
 * stays a pure presenter — this component owns the action surface so
 * the bubble's render path is unaffected when neither is visible.
 */
export function MessageActions({
  message,
  onReply,
  onReact,
  onForward,
  canEdit,
  onEdit,
  canDelete,
  onDelete,
  children,
}: MessageActionsProps) {
  const t = useTranslations("Inbox.actions");
  const [pickerOpen, setPickerOpen] = useState(false);

  const isAgent =
    message.sender_type === "agent" || message.sender_type === "bot";

  const handleCopy = async () => {
    const text = message.content_text ?? "";
    if (!text) {
      toast.error(t("nothingToCopy"));
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t("copied"));
    } catch {
      toast.error(t("copyFailed"));
    }
  };

  const handlePickEmoji = (emoji: string) => {
    onReact(emoji);
    setPickerOpen(false);
  };

  // Row alignment lives here (not in MessageBubble) so the `group/actions`
  // hover region matches the bubble's content width — hovering empty space
  // in the row no longer reveals the toolbar.
  return (
    <ContextMenu>
      <ContextMenuTrigger
        className={cn(
          "flex w-full",
          isAgent ? "justify-end" : "justify-start",
        )}
      >
        {/* `min-w-0` lets this flex child actually respect the 75% cap.
         *  Default `min-width: auto` lets content (a long quote preview,
         *  an unbroken URL) push past the cap and shove the row past
         *  100%, which used to bleed across into the contact-sidebar
         *  area. See issue #165. */}
        <div className="group/actions relative min-w-0 max-w-[75%]">
          {children}
          <div
            data-touch-open={pickerOpen ? "true" : undefined}
            className={cn(
              "absolute -top-3 z-10 flex h-7 items-center gap-0.5 rounded-full border border-border bg-popover/95 px-1 shadow-md backdrop-blur-sm transition-opacity",
              "opacity-0 group-hover/actions:opacity-100 group-focus-within/actions:opacity-100",
              "data-[touch-open=true]:opacity-100",
              isAgent ? "right-3" : "left-3",
            )}
          >
            <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
              <PopoverTrigger
                className="flex h-5 w-5 items-center justify-center rounded-full text-popover-foreground hover:bg-muted hover:text-foreground"
                aria-label={t("react")}
              >
                <SmilePlus className="h-3.5 w-3.5" />
              </PopoverTrigger>
              <PopoverContent
                className="flex w-auto flex-row gap-1 p-1.5"
                sideOffset={6}
              >
                {QUICK_EMOJIS.map((e) => (
                  <button
                    key={e}
                    type="button"
                    onClick={() => handlePickEmoji(e)}
                    className="flex h-8 w-8 items-center justify-center rounded-full text-lg leading-none transition-transform hover:scale-125 hover:bg-muted"
                    aria-label={t("reactWith", { emoji: e })}
                  >
                    {e}
                  </button>
                ))}
              </PopoverContent>
            </Popover>
            <button
              type="button"
              onClick={onReply}
              className="flex h-5 w-5 items-center justify-center rounded-full text-popover-foreground hover:bg-muted hover:text-foreground"
              aria-label={t("reply")}
            >
              <CornerUpLeft className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={handleCopy}
              className="flex h-5 w-5 items-center justify-center rounded-full text-popover-foreground hover:bg-muted hover:text-foreground"
              aria-label={t("copyText")}
            >
              <Copy className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </ContextMenuTrigger>

      <ContextMenuContent>
        <ContextMenuItem onClick={onReply}>
          <CornerUpLeft className="h-3.5 w-3.5" />
          {t("reply")}
        </ContextMenuItem>
        <ContextMenuItem onClick={handleCopy}>
          <Copy className="h-3.5 w-3.5" />
          {t("copyText")}
        </ContextMenuItem>
        <ContextMenuItem onClick={onForward}>
          <Forward className="h-3.5 w-3.5" />
          Encaminhar
        </ContextMenuItem>
        {canEdit && (
          <ContextMenuItem onClick={onEdit}>
            <Pencil className="h-3.5 w-3.5" />
            Editar
          </ContextMenuItem>
        )}
        {canDelete && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem variant="destructive" onClick={onDelete}>
              <Trash2 className="h-3.5 w-3.5" />
              Apagar
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}
