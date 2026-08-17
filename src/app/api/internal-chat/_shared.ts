import { internalChannels, internalMessages } from "@/db/schema";

type ChannelRow = typeof internalChannels.$inferSelect;
type MessageRow = typeof internalMessages.$inferSelect;

export function toApiChannel(row: ChannelRow) {
  return {
    id: row.id,
    account_id: row.accountId,
    name: row.name ?? undefined,
    is_direct: row.isDirect,
    created_by: row.createdBy ?? undefined,
    created_at: row.createdAt,
  };
}

export function toApiInternalMessage(row: MessageRow) {
  return {
    id: row.id,
    channel_id: row.channelId,
    sender_id: row.senderId ?? undefined,
    content_text: row.contentText ?? undefined,
    media_url: row.mediaUrl ?? undefined,
    created_at: row.createdAt,
  };
}
