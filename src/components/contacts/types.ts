// ============================================================
// Client-side shapes returned by /api/contacts, /api/tags and
// /api/custom-fields. These mirror the Drizzle row shape
// (camelCase) — deliberately NOT the same as the legacy
// snake_case `Contact` / `Tag` / ... types in `@/types` (those
// stayed as-is for the still-Supabase-backed areas of the app).
// ============================================================

export interface Tag {
  id: string;
  name: string;
  color: string;
}

export interface Contact {
  id: string;
  accountId: string;
  userId: string | null;
  phone: string;
  phoneNormalized?: string | null;
  name: string | null;
  email: string | null;
  company: string | null;
  avatarUrl: string | null;
  isGroup?: boolean;
  createdAt: string;
  updatedAt: string;
  tags?: Tag[];
}

export interface ContactNote {
  id: string;
  contactId: string;
  accountId: string;
  userId: string | null;
  noteText: string;
  createdAt: string;
}

export interface CustomField {
  id: string;
  accountId: string;
  userId: string | null;
  fieldName: string;
  fieldType: string;
  fieldOptions?: Record<string, unknown> | null;
  createdAt: string;
}

export interface ContactCustomValue {
  customFieldId: string;
  fieldName: string;
  fieldType: string;
  value: string | null;
}

export interface Deal {
  id: string;
  title: string;
  value: number | string;
  currency?: string | null;
  status: string;
  stage_id: string;
}
