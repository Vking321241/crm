import { describe, it, expect, beforeEach, vi } from "vitest";

// Shared mock state for the Drizzle client. Lives in a hoisted block
// so the vi.mock factory below can close over it.
const h = vi.hoisted(() => ({
  state: {
    owned: null as { id: string } | null,
    ownedCustomField: null as { id: string } | null,
    automations: [] as Record<string, unknown>[],
    steps: [] as Record<string, unknown>[],
    fromCalls: [] as string[],
    updateCalls: [] as { table: string; values: unknown }[],
    upsertCalls: [] as { table: string; values: unknown }[],
  },
}));

// Mocks `@/db/client`'s `db` export with a minimal fluent stand-in for
// Drizzle's query builder. Table identity is resolved by comparing the
// object passed to `.from()`/`.insert()`/`.update()`/`.delete()`
// against the real (unmocked) schema exports, so this stays agnostic
// to the actual `.where()` conditions engine.ts builds — same as the
// old Supabase-shaped mock, which also resolved data purely from
// (table, operation) rather than re-parsing filters.
vi.mock("@/db/client", async () => {
  const schema = await import("@/db/schema");
  const { state } = h;

  const TABLE_NAMES = new Map<unknown, string>([
    [schema.automations, "automations"],
    [schema.automationSteps, "automation_steps"],
    [schema.automationLogs, "automation_logs"],
    [schema.automationPendingExecutions, "automation_pending_executions"],
    [schema.contacts, "contacts"],
    [schema.contactTags, "contact_tags"],
    [schema.customFields, "custom_fields"],
    [schema.contactCustomValues, "contact_custom_values"],
    [schema.conversations, "conversations"],
    [schema.deals, "deals"],
    [schema.accounts, "accounts"],
    [schema.users, "users"],
  ]);
  const nameOf = (t: unknown) => TABLE_NAMES.get(t) ?? "unknown";

  function selectResult(table: string): unknown[] {
    if (table === "contacts") return state.owned ? [state.owned] : [];
    if (table === "custom_fields") return state.ownedCustomField ? [state.ownedCustomField] : [];
    if (table === "automations") return state.automations;
    if (table === "automation_steps") return state.steps;
    if (table === "automation_logs") return [{ stepsExecuted: [], status: "success" }];
    return [];
  }

  function selectBuilder() {
    let table = "unknown";
    const b: Record<string, unknown> = {
      from: (t: unknown) => {
        table = nameOf(t);
        state.fromCalls.push(table);
        return b;
      },
      where: () => b,
      limit: () => b,
      orderBy: () => b,
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
        Promise.resolve(selectResult(table)).then(res, rej),
    };
    return b;
  }

  function insertBuilder(table: unknown) {
    const name = nameOf(table);
    let values: unknown;
    const b: Record<string, unknown> = {
      values: (v: unknown) => {
        values = v;
        return b;
      },
      onConflictDoNothing: () => b,
      onConflictDoUpdate: () => {
        if (name === "contact_custom_values") state.upsertCalls.push({ table: name, values });
        return b;
      },
      returning: () => b,
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => {
        const result = name === "automation_logs" ? [{ id: "log1" }] : [];
        return Promise.resolve(result).then(res, rej);
      },
    };
    return b;
  }

  function updateBuilder(table: unknown) {
    const name = nameOf(table);
    const b: Record<string, unknown> = {
      set: (v: unknown) => {
        if (name === "contacts") state.updateCalls.push({ table: name, values: v });
        return b;
      },
      where: () => b,
      returning: () => b,
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => {
        const result = name === "automation_pending_executions" ? [{ id: "claim1" }] : undefined;
        return Promise.resolve(result).then(res, rej);
      },
    };
    return b;
  }

  function deleteBuilder(table: unknown) {
    const b: Record<string, unknown> = {
      where: () => b,
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
        Promise.resolve(undefined).then(res, rej),
    };
    void table;
    return b;
  }

  return {
    db: {
      select: () => selectBuilder(),
      insert: (table: unknown) => insertBuilder(table),
      update: (table: unknown) => updateBuilder(table),
      delete: (table: unknown) => deleteBuilder(table),
    },
  };
});

vi.mock("./uazapi-send", () => ({
  engineSendText: vi.fn(async () => ({ whatsapp_message_id: "m1" })),
  engineSendTemplate: vi.fn(async () => ({ whatsapp_message_id: "m1" })),
  engineSendInteractive: vi.fn(async () => ({ whatsapp_message_id: "m1" })),
}));

import { runAutomationsForTrigger, triggerMatches } from "./engine";
import type { Automation } from "@/types";

const ACCOUNT = "acct-1";

beforeEach(() => {
  h.state.owned = null;
  h.state.ownedCustomField = null;
  h.state.automations = [];
  h.state.steps = [];
  h.state.fromCalls = [];
  h.state.updateCalls = [];
  h.state.upsertCalls = [];
});

describe("runAutomationsForTrigger — tenant isolation", () => {
  it("refuses to dispatch when the contact is not in the account (GHSA-63cv-2c49-m5v3)", async () => {
    // Ownership lookup returns nothing — the contact belongs to another tenant.
    h.state.owned = null;
    // If the guard failed, this automation would run an update_contact_field step.
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [updateStep()];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "new_message_received",
      contactId: "victim-contact-uuid",
      context: { message_text: "manual trigger" },
    });

    // Bailed at the guard: never fetched automations, never wrote a contact.
    expect(h.state.fromCalls).toContain("contacts");
    expect(h.state.fromCalls).not.toContain("automations");
    expect(h.state.updateCalls).toHaveLength(0);
  });

  it("proceeds past the guard when the contact belongs to the account", async () => {
    h.state.owned = { id: "c1" };
    h.state.automations = []; // no matching automations; just prove we got past the guard

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "new_message_received",
      contactId: "c1",
      context: { message_text: "manual trigger" },
    });

    expect(h.state.fromCalls).toContain("automations");
  });

  it("scopes the update_contact_field write to the automation's account", async () => {
    h.state.owned = { id: "c1" };
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [updateStep()];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "new_message_received",
      contactId: "c1",
      context: {},
    });

    expect(h.state.updateCalls).toHaveLength(1);
    expect(h.state.updateCalls[0].table).toBe("contacts");
    expect(h.state.updateCalls[0].values).toMatchObject({ company: "pwned-by-automation" });
  });
});

describe("update_contact_field — custom fields", () => {
  it("upserts contact_custom_values when the field is account-owned", async () => {
    h.state.owned = { id: "c1" };
    h.state.ownedCustomField = { id: "cf1" };
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [customStep("custom:cf1", "Premium")];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "new_message_received",
      contactId: "c1",
      context: {},
    });

    // No direct contacts column write for a custom field.
    expect(h.state.updateCalls).toHaveLength(0);
    expect(h.state.upsertCalls).toHaveLength(1);
    expect(h.state.upsertCalls[0].values).toMatchObject({
      contactId: "c1",
      customFieldId: "cf1",
      value: "Premium",
    });
  });

  it("interpolates {{ vars.* }} into the custom value", async () => {
    h.state.owned = { id: "c1" };
    h.state.ownedCustomField = { id: "cf1" };
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [customStep("custom:cf1", "{{ vars.source }}")];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "new_message_received",
      contactId: "c1",
      context: { vars: { source: "WhatsApp Ad" } },
    });

    expect(h.state.upsertCalls).toHaveLength(1);
    expect((h.state.upsertCalls[0].values as { value: string }).value).toBe("WhatsApp Ad");
  });

  it("refuses to write a custom field from another account", async () => {
    h.state.owned = { id: "c1" };
    h.state.ownedCustomField = null; // account-scoped lookup finds nothing
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [customStep("custom:foreign-cf", "x")];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "new_message_received",
      contactId: "c1",
      context: {},
    });

    expect(h.state.upsertCalls).toHaveLength(0);
    expect(h.state.updateCalls).toHaveLength(0);
  });
});

describe("send_webhook — SSRF guard (GHSA-8jqh-598v-rfxc)", () => {
  it("refuses a private / link-local destination and never calls fetch", async () => {
    const fetchSpy = vi.fn(async () => ({ ok: true, status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);

    h.state.owned = { id: "c1" };
    h.state.automations = [automationWithUpdateStep()];
    // Aimed at the cloud metadata endpoint — the classic SSRF target.
    h.state.steps = [webhookStep("http://169.254.169.254/latest/meta-data/")];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "new_message_received",
      contactId: "c1",
      context: {},
    });

    // The automation matched and its steps were loaded (so we genuinely
    // reached the send_webhook case)...
    expect(h.state.fromCalls).toContain("automation_steps");
    // ...yet the guard blocked it before any outbound request left the box.
    expect(fetchSpy).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });
});

function webhookStep(url: string) {
  return {
    id: "s1",
    automation_id: "a1",
    step_type: "send_webhook",
    position: 0,
    parent_step_id: null,
    step_config: { url, headers: { "Metadata-Flavor": "Google" }, body_template: "{}" },
  };
}

function automationWithUpdateStep() {
  return {
    id: "a1",
    account_id: ACCOUNT,
    user_id: "u1",
    trigger_type: "new_message_received",
    trigger_config: {},
    is_active: true,
  };
}

function updateStep() {
  return {
    id: "s1",
    automation_id: "a1",
    step_type: "update_contact_field",
    position: 0,
    parent_step_id: null,
    step_config: { field: "company", value: "pwned-by-automation" },
  };
}

function customStep(field: string, value: string) {
  return {
    id: "s1",
    automation_id: "a1",
    step_type: "update_contact_field",
    position: 0,
    parent_step_id: null,
    step_config: { field, value },
  };
}

describe("triggerMatches — interactive_reply", () => {
  function automation(reply_ids: string[]): Automation {
    return {
      id: "a1",
      account_id: ACCOUNT,
      user_id: "u1",
      name: "menu step",
      trigger_type: "interactive_reply",
      trigger_config: { reply_ids },
      is_active: true,
      execution_count: 0,
      created_at: "",
      updated_at: "",
    };
  }

  it("matches when the tapped id is in reply_ids (exact)", () => {
    expect(
      triggerMatches(automation(["yes", "no"]), { interactive_reply_id: "yes" }),
    ).toBe(true);
  });

  it("does not match a different id", () => {
    expect(
      triggerMatches(automation(["yes"]), { interactive_reply_id: "maybe" }),
    ).toBe(false);
  });

  it("does not match on a substring (exact only)", () => {
    expect(
      triggerMatches(automation(["yes"]), { interactive_reply_id: "yes_please" }),
    ).toBe(false);
  });

  it("does not match when no reply id is present or config is empty", () => {
    expect(triggerMatches(automation(["yes"]), {})).toBe(false);
    expect(triggerMatches(automation([]), { interactive_reply_id: "yes" })).toBe(false);
  });
});
