"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { Pipeline, PipelineStage, Deal } from "@/types";
import { apiStatusToLegacy } from "@/lib/pipelines/status";
import { PipelineBoard } from "@/components/pipelines/pipeline-board";
import { PipelineSettings } from "@/components/pipelines/pipeline-settings";
import { DealForm } from "@/components/pipelines/deal-form";
import { PipelineAnalytics } from "@/components/pipelines/pipeline-analytics";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { GitBranch, Plus, ChevronDown, Settings } from "lucide-react";
import { toast } from "sonner";
import { useCan } from "@/hooks/use-can";
import { GatedButton } from "@/components/ui/gated-button";
import { useTranslations } from "next-intl";

// Pipeline creation is admin-class (settings-tier write under
// the new role model); deal creation is operational and only
// requires agent+. The two CTAs gate on different `useCan`
// capabilities, not on different copy.

// Spec-defined seed — name and color per the product spec.
const SPEC_DEFAULT_STAGES = [
  { name: "New Lead", color: "#3b82f6", position: 0 }, // blue
  { name: "Qualified", color: "#eab308", position: 1 }, // yellow
  { name: "Proposal Sent", color: "#f97316", position: 2 }, // orange
  { name: "Negotiation", color: "#8b5cf6", position: 3 }, // purple
  { name: "Won", color: "#22c55e", position: 4 }, // green
];

// ------------------------------------------------------------
// Wire (API) <-> legacy UI-shape adapters.
//
// The new /api/pipelines and /api/deals routes are plain Drizzle
// rows — camelCase, and `deals.status` is the DB enum
// ('active' | 'won' | 'lost'). `PipelineBoard`, `DealCard` and
// `PipelineAnalytics` (shared with other not-yet-ported call
// sites) still speak the legacy snake_case `@/types` shape with
// `status: 'open' | 'won' | 'lost'`, so requests/responses are
// translated at this page's fetch boundary instead of touching
// those shared types.
// ------------------------------------------------------------

interface ApiPipelineStage {
  id: string;
  pipelineId: string;
  name: string;
  position: number;
  color: string;
  createdAt: string;
}

interface ApiPipeline {
  id: string;
  accountId: string;
  userId: string | null;
  name: string;
  createdAt: string;
  pipelineStages: ApiPipelineStage[];
}

interface ApiDeal {
  id: string;
  accountId: string;
  userId: string | null;
  pipelineId: string;
  stageId: string;
  contactId: string | null;
  conversationId: string | null;
  title: string;
  value: string;
  currency: string | null;
  notes: string | null;
  expectedCloseDate: string | null;
  status: "active" | "won" | "lost";
  assignedTo: string | null;
  createdAt: string;
  updatedAt: string;
  contact: { id: string; name: string | null; phone: string } | null;
  assignee: { id: string; fullName: string; email: string } | null;
}

function toLegacyPipeline(p: Pick<ApiPipeline, "id" | "userId" | "name" | "createdAt">): Pipeline {
  return { id: p.id, user_id: p.userId ?? "", name: p.name, created_at: p.createdAt };
}

function toLegacyStage(s: ApiPipelineStage): PipelineStage {
  return {
    id: s.id,
    pipeline_id: s.pipelineId,
    name: s.name,
    position: s.position,
    color: s.color,
    created_at: s.createdAt,
  };
}

function toLegacyDeal(d: ApiDeal): Deal {
  return {
    id: d.id,
    user_id: d.userId ?? "",
    pipeline_id: d.pipelineId,
    stage_id: d.stageId,
    contact_id: d.contactId,
    conversation_id: d.conversationId ?? undefined,
    assigned_to: d.assignedTo ?? undefined,
    title: d.title,
    value: Number(d.value),
    currency: d.currency ?? undefined,
    notes: d.notes ?? undefined,
    expected_close_date: d.expectedCloseDate ?? undefined,
    status: apiStatusToLegacy(d.status),
    created_at: d.createdAt,
    updated_at: d.updatedAt,
    contact: d.contact
      ? {
          id: d.contact.id,
          user_id: "",
          account_id: "",
          phone: d.contact.phone,
          name: d.contact.name ?? undefined,
          created_at: "",
          updated_at: "",
        }
      : undefined,
    assignee: d.assignee
      ? {
          id: d.assignee.id,
          user_id: d.assignee.id,
          full_name: d.assignee.fullName,
          email: d.assignee.email,
          role: "",
          created_at: "",
        }
      : undefined,
  };
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error || `Request failed (${res.status})`);
  }
  return res.json();
}

export default function PipelinesPage() {
  const t = useTranslations("Pipelines.page");
  const canEditSettings = useCan("edit-settings");
  const canCreateDeals = useCan("send-messages");

  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [selectedPipelineId, setSelectedPipelineId] = useState<string>("");
  const [stages, setStages] = useState<PipelineStage[]>([]);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [loading, setLoading] = useState(true);

  // Dialog / sheet state
  const [newPipelineOpen, setNewPipelineOpen] = useState(false);
  const [newPipelineName, setNewPipelineName] = useState("");
  const [creating, setCreating] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Deal form state is lifted here so both the top-bar "Add Deal" and
  // the per-column "+" trigger the same Sheet.
  const [dealFormOpen, setDealFormOpen] = useState(false);
  const [editingDeal, setEditingDeal] = useState<Deal | null>(null);
  const [defaultStageId, setDefaultStageId] = useState<string>("");

  // Guard against double-seeding (React StrictMode double-effect in dev).
  const seedAttempted = useRef(false);

  const loadPipelinesFromApi = useCallback(async (): Promise<ApiPipeline[]> => {
    try {
      const { pipelines: rows } = await fetchJson<{ pipelines: ApiPipeline[] }>(
        "/api/pipelines",
      );
      return rows;
    } catch (err) {
      console.error("Failed to load pipelines:", err);
      return [];
    }
  }, []);

  const loadDealsForPipeline = useCallback(async (pipelineId: string): Promise<Deal[]> => {
    try {
      const { deals: rows } = await fetchJson<{ deals: ApiDeal[] }>(
        `/api/deals?pipelineId=${encodeURIComponent(pipelineId)}`,
      );
      return rows.map(toLegacyDeal);
    } catch (err) {
      console.error("Failed to load deals:", err);
      return [];
    }
  }, []);

  const seedDefaultPipeline = useCallback(async (): Promise<ApiPipeline | null> => {
    try {
      const { pipeline } = await fetchJson<{ pipeline: ApiPipeline }>("/api/pipelines", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Sales Pipeline", stages: SPEC_DEFAULT_STAGES }),
      });
      return pipeline;
    } catch (err) {
      console.error("Failed to seed pipeline:", err);
      return null;
    }
  }, []);

  // Raw (with-stages) API pipeline list, kept around between renders
  // so the stage-sync effect below doesn't need its own fetch.
  const apiPipelinesRef = useRef<ApiPipeline[]>([]);

  // Initial load + seed-if-empty
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      let list = await loadPipelinesFromApi();

      if (list.length === 0 && !seedAttempted.current) {
        seedAttempted.current = true;
        const seeded = await seedDefaultPipeline();
        if (seeded) list = await loadPipelinesFromApi();
      }

      if (cancelled) return;
      const legacyList = list.map(toLegacyPipeline);
      setPipelines(legacyList);
      if (list.length > 0) {
        setSelectedPipelineId((prev) =>
          legacyList.some((p) => p.id === prev) ? prev : legacyList[0].id,
        );
      } else {
        setSelectedPipelineId("");
      }
      // Stash the raw API pipelines (with stages) on the last-loaded
      // ref via the stage-sync effect below, keyed by selection.
      apiPipelinesRef.current = list;
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadPipelinesFromApi, seedDefaultPipeline]);

  // Load stages + deals whenever selected pipeline changes.
  // Clearing on no-selection is a legitimate sync with URL/prop
  // state; the load completion uses async setters inside promise
  // callbacks (not synchronous in the effect body).
  useEffect(() => {
    if (!selectedPipelineId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStages([]);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDeals([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const apiPipeline = apiPipelinesRef.current.find((p) => p.id === selectedPipelineId);
      const s = apiPipeline
        ? [...apiPipeline.pipelineStages].sort((a, b) => a.position - b.position).map(toLegacyStage)
        : [];
      const d = await loadDealsForPipeline(selectedPipelineId);
      if (cancelled) return;
      setStages(s);
      setDeals(d);
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedPipelineId, loadDealsForPipeline]);

  const refreshPipelines = useCallback(async () => {
    const list = await loadPipelinesFromApi();
    apiPipelinesRef.current = list;
    const legacyList = list.map(toLegacyPipeline);
    setPipelines(legacyList);
    if (legacyList.length === 0) setSelectedPipelineId("");
    else if (!legacyList.some((p) => p.id === selectedPipelineId)) {
      setSelectedPipelineId(legacyList[0].id);
    } else {
      // Same pipeline still selected — refresh its stages from the
      // freshly-fetched list too (pipeline settings may have
      // renamed/reordered/added/removed stages).
      const apiPipeline = list.find((p) => p.id === selectedPipelineId);
      if (apiPipeline) {
        setStages(
          [...apiPipeline.pipelineStages].sort((a, b) => a.position - b.position).map(toLegacyStage),
        );
      }
    }
  }, [loadPipelinesFromApi, selectedPipelineId]);

  const refreshStages = useCallback(async () => {
    if (!selectedPipelineId) return;
    const list = await loadPipelinesFromApi();
    apiPipelinesRef.current = list;
    const apiPipeline = list.find((p) => p.id === selectedPipelineId);
    setStages(
      apiPipeline
        ? [...apiPipeline.pipelineStages].sort((a, b) => a.position - b.position).map(toLegacyStage)
        : [],
    );
  }, [loadPipelinesFromApi, selectedPipelineId]);

  const refreshDeals = useCallback(async () => {
    if (!selectedPipelineId) return;
    setDeals(await loadDealsForPipeline(selectedPipelineId));
  }, [loadDealsForPipeline, selectedPipelineId]);

  const handleDealMoved = useCallback(
    async (dealId: string, newStageId: string) => {
      // Optimistic update — board already animated; just persist.
      setDeals((prev) =>
        prev.map((d) => (d.id === dealId ? { ...d, stage_id: newStageId } : d)),
      );
      try {
        await fetchJson(`/api/deals/${dealId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ stageId: newStageId }),
        });
      } catch {
        toast.error(t("toastFailedMoveDeal"));
        refreshDeals();
      }
    },
    [refreshDeals, t],
  );

  const handleAddDeal = useCallback(
    (stageId?: string) => {
      setEditingDeal(null);
      setDefaultStageId(stageId ?? stages[0]?.id ?? "");
      setDealFormOpen(true);
    },
    [stages],
  );

  const handleEditDeal = useCallback((deal: Deal) => {
    setEditingDeal(deal);
    setDefaultStageId(deal.stage_id);
    setDealFormOpen(true);
  }, []);

  async function handleCreatePipeline() {
    const name = newPipelineName.trim();
    if (!name) return;
    setCreating(true);

    try {
      const { pipeline } = await fetchJson<{ pipeline: ApiPipeline }>("/api/pipelines", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, stages: SPEC_DEFAULT_STAGES }),
      });

      setNewPipelineName("");
      setNewPipelineOpen(false);
      setSelectedPipelineId(pipeline.id);
      await refreshPipelines();
      toast.success(t("toastPipelineCreated"));
    } catch {
      toast.error(t("toastFailedCreatePipeline"));
    } finally {
      setCreating(false);
    }
  }

  const selectedPipeline = pipelines.find((p) => p.id === selectedPipelineId);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="h-8 w-48 animate-pulse rounded bg-muted" />
          <div className="h-9 w-28 animate-pulse rounded-lg bg-muted" />
        </div>
        <div className="flex gap-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-96 w-72 animate-pulse rounded-xl bg-muted/50" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {/* Pipeline selector dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger
              className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground hover:bg-muted transition-colors data-[popup-open]:bg-muted"
            >
              <GitBranch className="h-4 w-4 text-primary" />
              <span className="font-semibold">
                {selectedPipeline?.name ?? t("selectPipeline")}
              </span>
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="w-64 border-border bg-popover text-popover-foreground"
            >
              {pipelines.length === 0 && (
                <DropdownMenuItem disabled className="text-muted-foreground">
                  {t("noPipelinesYet")}
                </DropdownMenuItem>
              )}
              {pipelines.map((p) => (
                <DropdownMenuItem
                  key={p.id}
                  onClick={() => setSelectedPipelineId(p.id)}
                  className={
                    p.id === selectedPipelineId
                      ? "text-primary"
                      : "text-popover-foreground"
                  }
                >
                  <GitBranch className="mr-2 h-3.5 w-3.5" />
                  {p.name}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator className="bg-border" />
              {selectedPipeline && (
                <DropdownMenuItem
                  onClick={() => setSettingsOpen(true)}
                  className="text-popover-foreground"
                >
                  <Settings className="mr-2 h-3.5 w-3.5" />
                  {t("managePipelines")}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="flex items-center gap-2">
          <GatedButton
            variant="outline"
            canAct={canEditSettings}
            gateReason="create pipelines"
            onClick={() => setNewPipelineOpen(true)}
            className="border-border bg-card text-foreground hover:bg-muted"
          >
            <Plus className="mr-1 h-4 w-4" />
            {t("addPipeline")}
          </GatedButton>
          <GatedButton
            canAct={canCreateDeals}
            gateReason="create deals"
            disabled={!selectedPipelineId || stages.length === 0}
            onClick={() => handleAddDeal()}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="mr-1 h-4 w-4" />
            {t("addDeal")}
          </GatedButton>
        </div>
      </div>

      {/* Board */}
      {pipelines.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-20">
          <GitBranch className="h-12 w-12 text-muted-foreground" />
          <h3 className="mt-4 text-lg font-medium text-foreground">
            {t("noPipelinesYet")}
          </h3>
          <p className="mt-2 text-sm text-muted-foreground">
            {t("createToStartTracking")}
          </p>
          <GatedButton
            canAct={canEditSettings}
            gateReason="create pipelines"
            onClick={() => setNewPipelineOpen(true)}
            className="mt-4 bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="mr-1 h-4 w-4" />
            {t("createPipeline")}
          </GatedButton>
        </div>
      ) : (
        <>
          <PipelineAnalytics stages={stages} deals={deals} />
          <PipelineBoard
            stages={stages}
            deals={deals}
            onDealMoved={handleDealMoved}
            onAddDeal={handleAddDeal}
            onEditDeal={handleEditDeal}
          />
        </>
      )}

      {/* New Pipeline Dialog */}
      <Dialog open={newPipelineOpen} onOpenChange={setNewPipelineOpen}>
        <DialogContent className="sm:max-w-sm bg-popover border-border">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">{t("newPipeline")}</DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <Label className="text-muted-foreground">{t("pipelineName")}</Label>
            <Input
              value={newPipelineName}
              onChange={(e) => setNewPipelineName(e.target.value)}
              placeholder={t("pipelineNamePlaceholder")}
              className="mt-2 bg-muted border-border text-foreground"
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreatePipeline();
              }}
            />
            <p className="mt-2 text-xs text-muted-foreground">
              {t("defaultStagesDesc")}
            </p>
          </div>
          <DialogFooter className="bg-popover/50 border-border">
            <Button
              variant="outline"
              onClick={() => setNewPipelineOpen(false)}
              className="border-border text-muted-foreground hover:bg-muted"
            >
              {t("cancel")}
            </Button>
            <Button
              onClick={handleCreatePipeline}
              disabled={creating || !newPipelineName.trim()}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {creating ? t("creating") : t("createPipelineBtn")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Pipeline Settings */}
      {selectedPipeline && (
        <PipelineSettings
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          pipeline={selectedPipeline}
          stages={stages}
          onPipelinesChanged={refreshPipelines}
          onStagesChanged={refreshStages}
          onCreateNewPipeline={() => {
            setSettingsOpen(false);
            setNewPipelineOpen(true);
          }}
        />
      )}

      {/* Deal Form (Sheet) */}
      <DealForm
        open={dealFormOpen}
        onOpenChange={setDealFormOpen}
        deal={editingDeal}
        pipelineId={selectedPipelineId}
        stages={stages}
        defaultStageId={defaultStageId}
        onSaved={refreshDeals}
      />
    </div>
  );
}
