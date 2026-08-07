// ============================================================
// Rule-based auto-reply engine (no AI). Decides, given an account's
// `auto_reply_settings` row and the state of the inbound message,
// which single automated message (if any) should be sent back.
// Deliberately dumb and deterministic — this is a business-hours /
// away-message feature, not the AI auto-reply in src/lib/ai/.
// ============================================================

export interface BusinessHoursDay {
  enabled: boolean;
  start: string; // "HH:mm"
  end: string; // "HH:mm"
}

export type BusinessHours = Record<
  "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun",
  BusinessHoursDay
>;

export interface AutoReplySettingsInput {
  welcomeEnabled: boolean;
  welcomeMessage: string;
  afterHoursEnabled: boolean;
  afterHoursMessage: string;
  businessHours: BusinessHours;
  awayEnabled: boolean;
  awayMessage: string;
}

const DAY_KEYS: (keyof BusinessHours)[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

/** True when `now` falls inside the configured business hours for its weekday. */
export function isWithinBusinessHours(hours: BusinessHours, now: Date): boolean {
  const day = hours[DAY_KEYS[now.getDay()]];
  if (!day || !day.enabled) return false;

  const [startH, startM] = day.start.split(":").map(Number);
  const [endH, endM] = day.end.split(":").map(Number);
  const minutesNow = now.getHours() * 60 + now.getMinutes();
  const minutesStart = startH * 60 + startM;
  const minutesEnd = endH * 60 + endM;

  return minutesNow >= minutesStart && minutesNow < minutesEnd;
}

export type AutoReplyType = "away" | "welcome" | "after_hours";

/**
 * Priority: manual "away" override beats everything (it's an explicit
 * closure), then a first-ever message from a brand-new contact gets
 * the welcome message, then a normal message outside business hours
 * gets the after-hours message. Only one message is ever sent per
 * inbound event.
 */
export function resolveAutoReply(
  settings: AutoReplySettingsInput,
  opts: { isNewContact: boolean; now: Date },
): { type: AutoReplyType; text: string } | null {
  if (settings.awayEnabled && settings.awayMessage.trim()) {
    return { type: "away", text: settings.awayMessage.trim() };
  }

  if (opts.isNewContact && settings.welcomeEnabled && settings.welcomeMessage.trim()) {
    return { type: "welcome", text: settings.welcomeMessage.trim() };
  }

  if (
    settings.afterHoursEnabled &&
    settings.afterHoursMessage.trim() &&
    !isWithinBusinessHours(settings.businessHours, opts.now)
  ) {
    return { type: "after_hours", text: settings.afterHoursMessage.trim() };
  }

  return null;
}

/** Minimum gap between two automated replies in the same conversation. */
export const AUTO_REPLY_THROTTLE_MS = 3 * 60 * 60 * 1000; // 3h

export function isThrottled(lastAutoReplyAt: Date | null, now: Date): boolean {
  if (!lastAutoReplyAt) return false;
  return now.getTime() - lastAutoReplyAt.getTime() < AUTO_REPLY_THROTTLE_MS;
}
