import { z } from "zod";
import { defineTool, type ValidationResult } from "./_framework";
import type { ToolCtx } from "./_context";
import { spillOrReturn } from "./_io";
import { normaliseCharacterTags } from "./_surfaces";
import { listAllCharacters } from "../../state/character-catalog";
import { sha256 } from "../../state/patch-stack";
import { characterScope } from "../../types";
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

function ledgerTagEdit(ctx: ToolCtx, plan: TagPlan, after: readonly string[]): void {
  ctx.pushEdit({
    op: "edit",
    surface: "character_field",
    surfaceId: plan.characterId,
    surfaceLabel: plan.characterName,
    field: "tags",
    before: JSON.stringify(plan.before),
    after: JSON.stringify(after),
    valueEncoding: "json",
    scope: characterScope(plan.characterId),
  });
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

    const applied: TagPlan[] = [];
    let failure: {
      readonly code: string;
      readonly message: string;
      readonly plan: TagPlan | null;
      readonly updateAttempted: boolean;
    } | null = null;
    for (const plan of changed) {
      if (ctx.signal.aborted) {
        failure = {
          code: "CANCELLED",
          message: "operation cancelled",
          plan: null,
          updateAttempted: false,
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
        };
        break;
      }
      if (!live) {
        failure = {
          code: "CHARACTER_NOT_FOUND",
          message: `character ${plan.characterId} no longer exists`,
          plan,
          updateAttempted: false,
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
        };
        break;
      }

      try {
        await ctx.spindle.characters.update(plan.characterId, { tags: plan.after }, ctx.userId);
        applied.push(plan);
      } catch (err) {
        failure = {
          code: "UPDATE_FAILED",
          message: (err as Error).message || "character update failed",
          plan,
          updateAttempted: true,
        };
        break;
      }
    }

    if (failure) {
      const candidates: Array<{ plan: TagPlan; knownApplied: boolean }> = applied.map((plan) => ({
        plan,
        knownApplied: true,
      }));
      if (failure.plan && failure.updateAttempted) {
        candidates.push({ plan: failure.plan, knownApplied: false });
      }

      const survivors: Array<{ plan: TagPlan; liveTags: string[] | null }> = [];
      const unattributed: Array<{ plan: TagPlan; liveTags: string[] | null }> = [];
      const rolledBack: string[] = [];
      for (const candidate of [...candidates].reverse()) {
        const { plan, knownApplied } = candidate;
        let liveTags: string[];
        try {
          const live = await ctx.spindle.characters.get(plan.characterId, ctx.userId);
          if (!live) {
            if (knownApplied) survivors.push({ plan, liveTags: null });
            else unattributed.push({ plan, liveTags: null });
            continue;
          }
          liveTags = Array.isArray(live.tags) ? [...live.tags] : [];
        } catch {
          if (knownApplied) survivors.push({ plan, liveTags: null });
          else unattributed.push({ plan, liveTags: null });
          continue;
        }

        if (sameTags(liveTags, plan.before)) {
          rolledBack.push(plan.characterId);
          continue;
        }
        if (!sameTags(liveTags, plan.after)) {
          if (knownApplied) survivors.push({ plan, liveTags });
          else unattributed.push({ plan, liveTags });
          continue;
        }

        // Compensation is deliberately conditional: never restore a stale
        // preview over tags that no longer equal this batch's exact output.
        try {
          await ctx.spindle.characters.update(plan.characterId, { tags: plan.before }, ctx.userId);
          rolledBack.push(plan.characterId);
        } catch {
          // The live value was exactly our output immediately before this
          // failed restore. Record only our exact before→after mutation.
          survivors.push({ plan, liveTags });
        }
      }
      // A divergent live value may include a later user/external edit. Attribute
      // only the exact mutation this batch is known to have applied.
      for (const survivor of survivors) ledgerTagEdit(ctx, survivor.plan, survivor.plan.after);

      return {
        content: JSON.stringify({
          ok: false,
          partial: survivors.length > 0,
          error_code: failure.code,
          error: failure.message,
          failed_character_id: failure.plan?.characterId ?? null,
          rolled_back_character_ids: rolledBack,
          surviving_changes: survivors.map(({ plan, liveTags }) => ({
            character_id: plan.characterId,
            before: plan.before,
            after: plan.after,
            live_tags: liveTags,
          })),
          unattributed_divergent_states: unattributed.map(({ plan, liveTags }) => ({
            character_id: plan.characterId,
            live_tags: liveTags,
          })),
          note: survivors.length > 0
            ? "Rollback was incomplete. Only this batch's exact surviving mutations were recorded; divergent live tags were not attributed to the agent."
            : unattributed.length > 0
              ? "Known batch writes were rolled back. Divergent live tags were left untouched and were not attributed to the agent."
              : "The attempted batch was fully rolled back.",
        }, null, 2),
        isError: true,
      };
    }

    for (const plan of applied) ledgerTagEdit(ctx, plan, plan.after);
    return {
      content: JSON.stringify({
        ok: true,
        dry_run: false,
        requested: built.plans.length,
        updated: applied.length,
        unchanged: built.plans.length - applied.length,
        character_ids: applied.map((plan) => plan.characterId),
      }, null, 2),
    };
  },
});
