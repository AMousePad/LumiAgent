import { z } from "zod";
import { defineTool, type ValidationResult } from "./_framework";
import { StageEditPersistenceError, type StagedEdit, type ToolCtx } from "./_context";
import { spillOrReturn } from "./_io";
import { normaliseCharacterTags } from "./_surfaces";
import { listAllCharacters } from "../../state/character-catalog";
import { sha256 } from "../../state/patch-stack";
import { characterScope, type EditRecord } from "../../types";
import description from "../prompts/claude/tools/bulk-update-character-tags/description.txt";

const MAX_UPDATES = 500;
const MAX_TAGS_PER_OPERATION = 200;
const tagsSchema = z.array(z.string()).max(MAX_TAGS_PER_OPERATION);

const updateSchema = z.object({
  character_id: z.string().min(1),
  add: tagsSchema.optional(),
  remove: tagsSchema.optional(),
  set: tagsSchema.optional(),
}).strict().superRefine((value, issue) => {
  const hasIncremental = value.add !== undefined || value.remove !== undefined;
  if (value.set === undefined && !hasIncremental) {
    issue.addIssue({
      code: "custom",
      message: "provide add, remove, or set",
    });
  }
  if (value.set !== undefined && hasIncremental) {
    issue.addIssue({
      code: "custom",
      message: "set cannot be combined with add or remove",
    });
  }
});

const inputSchema = z.object({
  updates: z.array(updateSchema).min(1).max(MAX_UPDATES),
  dry_run: z.boolean().optional().default(true),
  preview_hash: z.string().min(1).optional(),
}).strict().superRefine((value, issue) => {
  const seen = new Set<string>();
  for (let i = 0; i < value.updates.length; i++) {
    const id = value.updates[i]!.character_id;
    if (seen.has(id)) {
      issue.addIssue({
        code: "custom",
        path: ["updates", i, "character_id"],
        message: `duplicate character_id '${id}'`,
      });
    }
    seen.add(id);
  }
});

type BulkTagInput = z.infer<typeof inputSchema>;

interface TagPlan {
  readonly characterId: string;
  readonly characterName: string;
  readonly before: string[];
  readonly after: string[];
  readonly added: string[];
  readonly removed: string[];
  readonly changed: boolean;
}

type PlanBuild =
  | { readonly ok: true; readonly plans: TagPlan[]; readonly previewHash: string }
  | { readonly ok: false; readonly code: string; readonly message: string };

function exactTagDiff(before: readonly string[], after: readonly string[]): {
  added: string[];
  removed: string[];
} {
  const beforeSet = new Set(before);
  const afterSet = new Set(after);
  return {
    added: after.filter((tag) => !beforeSet.has(tag)),
    removed: before.filter((tag) => !afterSet.has(tag)),
  };
}

function sameTags(left: readonly string[], right: readonly string[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function normalised(tags: readonly string[] | undefined): string[] {
  return normaliseCharacterTags(tags ?? []) ?? [];
}

async function buildPlans(input: BulkTagInput, ctx: ToolCtx): Promise<PlanBuild> {
  const library = await listAllCharacters(ctx.spindle, ctx.userId);
  const byId = new Map(library.map((character) => [character.id, character]));
  const missing = input.updates
    .map((update) => update.character_id)
    .filter((id) => !byId.has(id));
  if (missing.length > 0) {
    return {
      ok: false,
      code: "CHARACTER_NOT_FOUND",
      message: `Unknown character ids: ${missing.join(", ")}. No changes were made.`,
    };
  }

  const plans: TagPlan[] = [];
  for (const update of input.updates) {
    const character = byId.get(update.character_id)!;
    const before = Array.isArray(character.tags) ? [...character.tags] : [];
    const add = normalised(update.add);
    const remove = normalised(update.remove);
    const set = update.set === undefined ? null : normalised(update.set);
    if (set === null) {
      const overlap = add.filter((tag) => remove.includes(tag));
      if (overlap.length > 0) {
        return {
          ok: false,
          code: "CONFLICTING_TAG_OPERATION",
          message: `Character ${update.character_id} adds and removes the same tags: ${overlap.join(", ")}. No changes were made.`,
        };
      }
    }

    let after: string[];
    if (set !== null) {
      after = set;
    } else {
      const removeSet = new Set(remove);
      after = before.filter((tag) => !removeSet.has(tag));
      for (const tag of add) {
        if (!after.includes(tag)) after.push(tag);
      }
    }
    const diff = exactTagDiff(before, after);
    plans.push({
      characterId: character.id,
      characterName: character.name,
      before,
      after,
      added: diff.added,
      removed: diff.removed,
      changed: JSON.stringify(before) !== JSON.stringify(after),
    });
  }

  const hashBody = plans.map((plan) => ({
    character_id: plan.characterId,
    before: plan.before,
    after: plan.after,
  }));
  return {
    ok: true,
    plans,
    previewHash: sha256(JSON.stringify({ version: 1, plans: hashBody })),
  };
}

function tagEditRecord(plan: TagPlan, after: readonly string[]): EditRecord {
  return {
    op: "edit",
    surface: "character_field",
    surfaceId: plan.characterId,
    surfaceLabel: plan.characterName,
    field: "tags",
    before: JSON.stringify(plan.before),
    after: JSON.stringify(after),
    valueEncoding: "json",
    scope: characterScope(plan.characterId),
  };
}

async function validateApply(input: BulkTagInput, ctx: ToolCtx): Promise<ValidationResult> {
  if (input.dry_run !== false) return { result: true };
  if (!input.preview_hash) {
    return {
      result: false,
      errorCode: "PREVIEW_REQUIRED",
      message: "Run this batch with dry_run:true first, then pass its preview_hash unchanged.",
    };
  }
  const built = await buildPlans(input, ctx);
  if (!built.ok) {
    return { result: false, errorCode: built.code, message: built.message };
  }
  if (built.previewHash !== input.preview_hash) {
    return {
      result: false,
      errorCode: "STALE_PREVIEW",
      message: "One or more live tag arrays changed after the preview. No changes were made; run dry_run:true again.",
    };
  }
  return { result: true };
}

export const bulkUpdateCharacterTagsTool = defineTool({
  name: "bulk_update_character_tags",
  description,
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      updates: {
        type: "array",
        minItems: 1,
        maxItems: MAX_UPDATES,
        items: {
          type: "object",
          properties: {
            character_id: { type: "string" },
            add: { type: "array", items: { type: "string" }, maxItems: MAX_TAGS_PER_OPERATION },
            remove: { type: "array", items: { type: "string" }, maxItems: MAX_TAGS_PER_OPERATION },
            set: { type: "array", items: { type: "string" }, maxItems: MAX_TAGS_PER_OPERATION },
          },
          required: ["character_id"],
          additionalProperties: false,
        },
      },
      dry_run: { type: "boolean", description: "Defaults true. Preview before applying." },
      preview_hash: { type: "string", description: "Required when dry_run=false; copy it from the latest matching preview." },
    },
    required: ["updates"],
    additionalProperties: false,
  },
  requiresCharacter: false,
  isReadOnly: (input) => input.dry_run !== false,
  validateInput: validateApply,
  execute: async (input, ctx) => {
    const built = await buildPlans(input, ctx);
    if (!built.ok) {
      return { content: `Error: [${built.code}] ${built.message}`, isError: true };
    }

    const rows = built.plans.map((plan) => ({
      character_id: plan.characterId,
      name: plan.characterName,
      changed: plan.changed,
      before: plan.before,
      after: plan.after,
      added: plan.added,
      removed: plan.removed,
    }));
    const changed = built.plans.filter((plan) => plan.changed);

    if (input.dry_run !== false) {
      const payload = JSON.stringify({
        dry_run: true,
        requested: built.plans.length,
        changed: changed.length,
        unchanged: built.plans.length - changed.length,
        preview_hash: built.previewHash,
        updates: rows,
        note: "Review this preview, then call again with the same updates, dry_run:false, and this preview_hash. Drift before apply makes zero writes; drift during apply aborts and safely compensates earlier rows.",
      }, null, 2);
      return { content: await spillOrReturn(ctx, payload, "bulk_update_character_tags:preview") };
    }

    if (built.previewHash !== input.preview_hash) {
      return {
        content: "Error: [STALE_PREVIEW] One or more live tag arrays changed after validation. No changes were made; run dry_run:true again.",
        isError: true,
      };
    }
    if (changed.length === 0) {
      return {
        content: JSON.stringify({
          ok: true,
          dry_run: false,
          requested: built.plans.length,
          updated: 0,
          unchanged: built.plans.length,
        }),
      };
    }
    if (!ctx.stageEdit) {
      return {
        content: "Error: [DURABILITY_UNAVAILABLE] Durable edit staging is unavailable. No changes were made.",
        isError: true,
      };
    }

    interface StagedPlan {
      readonly plan: TagPlan;
      readonly stage: StagedEdit;
    }
    const applied: StagedPlan[] = [];
    let failure: {
      readonly code: string;
      readonly message: string;
      readonly plan: TagPlan | null;
      readonly updateAttempted: boolean;
      readonly stage: StagedEdit | null;
      readonly failedStage?: {
        readonly editId: string;
        readonly scope: ReturnType<typeof characterScope>;
        readonly cleanupState: "discarded" | "unresolved";
        readonly cleanupError?: string;
      };
    } | null = null;
    for (const plan of changed) {
      if (ctx.signal.aborted) {
        failure = {
          code: "CANCELLED",
          message: "operation cancelled",
          plan: null,
          updateAttempted: false,
          stage: null,
        };
        break;
      }

      // Write the exact before→after intent first, then perform the live-state
      // read immediately before update. This keeps the original get→update race
      // narrow while guaranteeing that no card mutation can precede durability.
      let stage: StagedEdit;
      try {
        stage = await ctx.stageEdit(tagEditRecord(plan, plan.after));
      } catch (err) {
        const failedStage = err instanceof StageEditPersistenceError
          ? {
              editId: err.entry.id,
              scope: err.entry.scope,
              cleanupState: err.cleanupState,
              ...(err.cleanupError !== undefined ? { cleanupError: err.cleanupError } : {}),
            }
          : undefined;
        failure = {
          code: "LEDGER_STAGE_FAILED",
          message: (err as Error).message || "could not durably stage the character tag edit",
          plan,
          updateAttempted: false,
          stage: null,
          ...(failedStage !== undefined ? { failedStage } : {}),
        };
        break;
      }

      let live;
      try {
        live = await ctx.spindle.characters.get(plan.characterId, ctx.userId);
      } catch (err) {
        failure = {
          code: "LIVE_STATE_READ_FAILED",
          message: (err as Error).message || "could not verify live character tags",
          plan,
          updateAttempted: false,
          stage,
        };
        break;
      }
      if (!live) {
        failure = {
          code: "CHARACTER_NOT_FOUND",
          message: `character ${plan.characterId} no longer exists`,
          plan,
          updateAttempted: false,
          stage,
        };
        break;
      }
      const liveTags = Array.isArray(live.tags) ? [...live.tags] : [];
      if (!sameTags(liveTags, plan.before)) {
        failure = {
          code: "STALE_LIVE_STATE",
          message: `character ${plan.characterId} tags changed while the batch was running`,
          plan,
          updateAttempted: false,
          stage,
        };
        break;
      }

      try {
        await ctx.spindle.characters.update(plan.characterId, { tags: plan.after }, ctx.userId);
        applied.push({ plan, stage });
      } catch (err) {
        failure = {
          code: "UPDATE_FAILED",
          message: (err as Error).message || "character update failed",
          plan,
          updateAttempted: true,
          stage,
        };
        break;
      }
    }

    if (failure) {
      const candidates: Array<StagedPlan & { knownApplied: boolean }> = applied.map(({ plan, stage }) => ({
        plan,
        stage,
        knownApplied: true,
      }));
      if (failure.plan && failure.updateAttempted && failure.stage) {
        candidates.push({ plan: failure.plan, stage: failure.stage, knownApplied: false });
      }

      const survivors: Array<StagedPlan & { liveTags: string[] | null }> = [];
      const uncertain: Array<StagedPlan & { liveTags: string[] | null }> = [];
      const toDiscard: StagedPlan[] = [];
      const cleanupFailures: Array<{
        character_id: string;
        edit_id: string;
        scope: ReturnType<typeof characterScope>;
        error: string;
      }> = [];
      if (failure.failedStage?.cleanupState === "unresolved" && failure.plan) {
        cleanupFailures.push({
          character_id: failure.plan.characterId,
          edit_id: failure.failedStage.editId,
          scope: failure.failedStage.scope,
          error: failure.failedStage.cleanupError ?? "staged ledger cleanup could not be confirmed",
        });
      }
      if (failure.stage && !failure.updateAttempted && failure.plan) {
        // This row was staged but its post-stage live check failed. No host
        // update was attempted, so its write-ahead entry must be discarded.
        toDiscard.push({ plan: failure.plan, stage: failure.stage });
      }
      const rolledBack: string[] = [];
      for (const candidate of [...candidates].reverse()) {
        const { plan, stage, knownApplied } = candidate;
        let liveTags: string[];
        try {
          const live = await ctx.spindle.characters.get(plan.characterId, ctx.userId);
          if (!live) {
            if (knownApplied) survivors.push({ plan, stage, liveTags: null });
            else uncertain.push({ plan, stage, liveTags: null });
            continue;
          }
          liveTags = Array.isArray(live.tags) ? [...live.tags] : [];
        } catch {
          if (knownApplied) survivors.push({ plan, stage, liveTags: null });
          else uncertain.push({ plan, stage, liveTags: null });
          continue;
        }

        if (sameTags(liveTags, plan.before)) {
          rolledBack.push(plan.characterId);
          toDiscard.push({ plan, stage });
          continue;
        }
        if (!sameTags(liveTags, plan.after)) {
          if (knownApplied) survivors.push({ plan, stage, liveTags });
          else uncertain.push({ plan, stage, liveTags });
          continue;
        }

        // Compensation is deliberately conditional: never restore a stale
        // preview over tags that no longer equal this batch's exact output.
        try {
          await ctx.spindle.characters.update(plan.characterId, { tags: plan.before }, ctx.userId);
          rolledBack.push(plan.characterId);
          toDiscard.push({ plan, stage });
        } catch {
          // The live value was exactly our output immediately before this
          // failed restore. Record only our exact before→after mutation.
          survivors.push({ plan, stage, liveTags });
        }
      }
      // A divergent live value may include a later user/external edit. Attribute
      // only the exact mutation this batch is known to have applied. Its stage
      // is already durable, so committing publishes it without a backend append.
      for (const survivor of survivors) survivor.stage.commit();
      // An update call that threw may still have committed before losing its
      // acknowledgement. If its follow-up state is missing, unreadable, or
      // divergent, retain the write-ahead entry conservatively: discarding it
      // could turn a real mutation into unledgered history.
      for (const item of uncertain) item.stage.commit();
      // Fully rolled-back rows and stages whose host update was never attempted
      // must not leave live ledger patches. Attempt every discard even if an
      // earlier cleanup failed.
      for (const item of toDiscard) {
        try {
          await item.stage.discard();
        } catch (err) {
          cleanupFailures.push({
            character_id: item.plan.characterId,
            edit_id: item.stage.entry.id,
            scope: item.stage.entry.scope,
            error: (err as Error).message || "staged ledger cleanup failed",
          });
        }
      }

      return {
        content: JSON.stringify({
          ok: false,
          partial: survivors.length > 0 || uncertain.length > 0 || cleanupFailures.length > 0,
          error_code: failure.code,
          error: failure.message,
          failed_character_id: failure.plan?.characterId ?? null,
          failed_stage: failure.failedStage ?? null,
          rolled_back_character_ids: rolledBack,
          surviving_changes: survivors.map(({ plan, liveTags }) => ({
            character_id: plan.characterId,
            before: plan.before,
            after: plan.after,
            live_tags: liveTags,
          })),
          uncertain_update_states: uncertain.map(({ plan, stage, liveTags }) => ({
            character_id: plan.characterId,
            edit_id: stage.entry.id,
            live_tags: liveTags,
            ledger_retained: true,
          })),
          ledger_cleanup_failures: cleanupFailures,
          note: cleanupFailures.length > 0
            ? "Rollback completed where the batch still owned the live tags, but one or more staged ledger entries could not be durably discarded. The unresolved ledger cleanup is reported above."
            : survivors.length > 0
            ? "Rollback was incomplete. Only this batch's exact surviving mutations were recorded; divergent live tags were not attributed to the agent."
            : uncertain.length > 0
              ? "An attempted update had an uncertain outcome. Its durable before-to-after ledger entry was retained so a possible real mutation cannot become untracked; divergent live state was left untouched."
              : "The attempted batch was fully rolled back.",
        }, null, 2),
        isError: true,
      };
    }

    // Every stage was durable before its card mutation. Publish the exact
    // entries only after the whole batch succeeds so the backend mirrors them
    // into session state without writing the ledgers a second time.
    for (const item of applied) item.stage.commit();
    return {
      content: JSON.stringify({
        ok: true,
        dry_run: false,
        requested: built.plans.length,
        updated: applied.length,
        unchanged: built.plans.length - applied.length,
        character_ids: applied.map(({ plan }) => plan.characterId),
      }, null, 2),
    };
  },
});
