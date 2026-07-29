import { describe, expect, it } from "vitest";
import en from "../../messages/en.json";
import ptBR from "../../messages/pt-BR.json";

// next-intl falls back silently to the message key (or crashes,
// depending on config) when a translation is missing — there's no
// build-time signal. This test is the guard: every locale dictionary
// must carry exactly the same key set, recursively, so a key added to
// one language can never silently ship untranslated in the other.
function collectKeys(obj: unknown, prefix = ""): string[] {
  if (obj === null || typeof obj !== "object") return [prefix];
  return Object.entries(obj as Record<string, unknown>).flatMap(([key, value]) =>
    collectKeys(value, prefix ? `${prefix}.${key}` : key),
  );
}

describe("locale parity", () => {
  it("en.json and pt-BR.json declare exactly the same keys", () => {
    const enKeys = new Set(collectKeys(en));
    const ptKeys = new Set(collectKeys(ptBR));

    const missingInPt = [...enKeys].filter((k) => !ptKeys.has(k));
    const extraInPt = [...ptKeys].filter((k) => !enKeys.has(k));

    expect(missingInPt, "keys present in en.json but missing from pt-BR.json").toEqual([]);
    expect(extraInPt, "keys present in pt-BR.json but missing from en.json").toEqual([]);
  });
});
