"use client";

// ============================================================
// MentionTextarea — plain textarea + "@" autocomplete for internal
// notes. Typing "@" followed by letters opens a dropdown of account
// members and departments; picking one inserts "@Nome " into the
// text and records the mention (id + type) so the caller can notify
// the right people once the note is actually saved (see
// POST /api/conversations/[id]/internal-notes).
//
// Deliberately NOT a rich-text editor — mentions are just plain
// "@Name" substrings in the saved text, matched back up against the
// `mentions` list by name for the (rare, purely cosmetic) bold
// highlighting when a note renders. Editing/removing a "@Name"
// after inserting it just makes it plain text again; no live sync
// back to the mentions array — acceptable for a single free-typed
// note field.
// ============================================================

import { useEffect, useRef, useState } from "react";
import { AtSign, Users2 } from "lucide-react";

export interface NoteMention {
  id: string;
  type: "user" | "department";
  name: string;
}

interface MemberOption {
  id: string;
  name: string;
}

interface MentionTextareaProps {
  value: string;
  onChange: (text: string, mentions: NoteMention[]) => void;
  mentions: NoteMention[];
  placeholder?: string;
  rows?: number;
  className?: string;
}

export function MentionTextarea({
  value,
  onChange,
  mentions,
  placeholder,
  rows = 3,
  className,
}: MentionTextareaProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [members, setMembers] = useState<MemberOption[]>([]);
  const [departments, setDepartments] = useState<MemberOption[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [query, setQuery] = useState<string | null>(null);
  const [mentionStart, setMentionStart] = useState<number | null>(null);

  function ensureLoaded() {
    if (loaded) return;
    setLoaded(true);
    Promise.all([
      fetch("/api/account/members", { cache: "no-store" }).then((r) => (r.ok ? r.json() : { members: [] })),
      fetch("/api/departments", { cache: "no-store" }).then((r) => (r.ok ? r.json() : { departments: [] })),
    ])
      .then(([membersData, deptData]) => {
        setMembers(
          (membersData.members ?? []).map((m: { user_id: string; full_name: string }) => ({
            id: m.user_id,
            name: m.full_name,
          })),
        );
        setDepartments(
          (deptData.departments ?? []).map((d: { id: string; name: string }) => ({
            id: d.id,
            name: d.name,
          })),
        );
      })
      .catch(() => {});
  }

  function handleChange(next: string) {
    onChange(next, mentions);

    const el = textareaRef.current;
    const cursor = el?.selectionStart ?? next.length;
    const uptoCursor = next.slice(0, cursor);
    const match = uptoCursor.match(/(?:^|\s)@(\w*)$/);

    if (match) {
      ensureLoaded();
      setQuery(match[1]);
      setMentionStart(cursor - match[1].length - 1);
    } else {
      setQuery(null);
      setMentionStart(null);
    }
  }

  function pick(option: MemberOption, type: NoteMention["type"]) {
    if (mentionStart === null) return;
    const el = textareaRef.current;
    const cursor = el?.selectionStart ?? value.length;
    const before = value.slice(0, mentionStart);
    const after = value.slice(cursor);
    const inserted = `@${option.name} `;
    const next = `${before}${inserted}${after}`;

    const nextMentions = mentions.some((m) => m.id === option.id && m.type === type)
      ? mentions
      : [...mentions, { id: option.id, type, name: option.name }];

    onChange(next, nextMentions);
    setQuery(null);
    setMentionStart(null);

    requestAnimationFrame(() => {
      const pos = before.length + inserted.length;
      el?.focus();
      el?.setSelectionRange(pos, pos);
    });
  }

  const filteredMembers =
    query === null ? [] : members.filter((m) => m.name.toLowerCase().includes(query.toLowerCase()));
  const filteredDepartments =
    query === null ? [] : departments.filter((d) => d.name.toLowerCase().includes(query.toLowerCase()));
  const showDropdown = query !== null && (filteredMembers.length > 0 || filteredDepartments.length > 0);

  // Close the dropdown on outside click/blur without swallowing the
  // click that picked an option (mousedown fires before blur).
  useEffect(() => {
    if (!showDropdown) return;
    const onMouseDown = (e: MouseEvent) => {
      if (!(e.target instanceof Node)) return;
      if (!textareaRef.current?.parentElement?.contains(e.target)) {
        setQuery(null);
        setMentionStart(null);
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [showDropdown]);

  return (
    <div className="relative">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        placeholder={placeholder}
        rows={rows}
        className={className}
      />
      {showDropdown && (
        <div className="absolute bottom-full left-0 z-20 mb-1 max-h-48 w-full min-w-56 overflow-y-auto rounded-md border border-border bg-popover p-1 shadow-md">
          {filteredMembers.length === 0 && filteredDepartments.length === 0 ? (
            <p className="px-2 py-1.5 text-xs text-muted-foreground">Ninguém encontrado</p>
          ) : (
            <>
              {filteredMembers.map((m) => (
                <button
                  key={`user-${m.id}`}
                  type="button"
                  onClick={() => pick(m, "user")}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-popover-foreground hover:bg-muted"
                >
                  <AtSign className="size-3.5 shrink-0 text-muted-foreground" />
                  {m.name}
                </button>
              ))}
              {filteredDepartments.map((d) => (
                <button
                  key={`dept-${d.id}`}
                  type="button"
                  onClick={() => pick(d, "department")}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-popover-foreground hover:bg-muted"
                >
                  <Users2 className="size-3.5 shrink-0 text-muted-foreground" />
                  {d.name}
                  <span className="ml-auto text-[10px] text-muted-foreground">setor</span>
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
