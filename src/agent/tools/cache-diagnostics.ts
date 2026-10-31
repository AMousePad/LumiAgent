import { z } from "zod";
import { defineTool } from "./_framework";
import { spillOrReturn } from "./_io";
import { dialCache } from "../../phoneline/transport";

const identifier = z.string().min(1).max(200).optional();
const position = z.number().int().nonnegative().optional();
const inspectSchema = z.object({
  action: z.enum(["live", "report", "findings", "job", "diff_list", "diff_open", "diff_page"]),
  chat_id: identifier, job_id: identifier, kind: z.enum(["audit", "simulation"]).optional(),
  before: identifier, after: identifier, diff_id: identifier, old_index: position, new_index: position,
  cursor: position, fold: position, part: z.enum(["body", "header"]).optional(), include_unchanged: z.boolean().optional(),
}).strict();
export const inspectCacheTool = defineTool({
  name: "inspect_cache",
  description: "Inspect LumiCache cache-risk evidence without changing monitoring or approving sends. live returns the last successful/current prompt references for chat_id or the pinned chat. report returns the latest audit and simulation summaries with up to 30 findings. findings pages the chosen kind. job polls a job_id, respect pollAfterMs and read report after completion. diff_list takes before/after snapshot references and returns changed messages. diff_open takes those references and returned old_index/new_index (zero-based), returning at most 20 rows and a diff_id. diff_page takes diff_id, cursor and optional fold to expand unchanged context. Use only returned references and cursors. Full prompts remain in LumiCache. Evidence is cache risk, not confirmed provider cache usage. Discover run_cache_diagnostic to run fresh checks.",
  inputSchema: inspectSchema,
  jsonSchema: { type: "object", properties: {
    action: { type: "string", enum: ["live", "report", "findings", "job", "diff_list", "diff_open", "diff_page"] },
    chat_id: { type: "string" }, job_id: { type: "string" }, kind: { type: "string", enum: ["audit", "simulation"] },
    before: { type: "string" }, after: { type: "string" }, diff_id: { type: "string" },
    old_index: { type: "integer", minimum: 0 }, new_index: { type: "integer", minimum: 0 }, cursor: { type: "integer", minimum: 0 }, fold: { type: "integer", minimum: 0 },
    part: { type: "string", enum: ["body", "header"] }, include_unchanged: { type: "boolean" },
  }, required: ["action"] },
  requiresCharacter: false,
  isReadOnly: () => true,
  execute: async (input, ctx) => {
    try {
      ctx.signal.throwIfAborted();
      const chatId = input.chat_id ?? ctx.pinnedChatId;
      if (["live", "report", "findings"].includes(input.action) && !chatId) throw new Error("Pass chat_id or pin the chat to inspect.");
      const result = await dialCache(ctx.spindle, { userId: ctx.userId, action: input.action, chatId: chatId ?? undefined,
        jobId: input.job_id, kind: input.kind, before: input.before, after: input.after, diffId: input.diff_id,
        oldIndex: input.old_index, newIndex: input.new_index, cursor: input.cursor, fold: input.fold, part: input.part, includeUnchanged: input.include_unchanged });
      return { content: await spillOrReturn(ctx, JSON.stringify(result, null, 2), `inspect_cache:${input.action}`, "Use returned cursors to request the next bounded page. Do not load entire prompts into the conversation.") };
    } catch (error) { return { content: `LumiCache: ${(error as Error).message}`, isError: true }; }
  },
});

const runSchema = z.object({ action: z.enum(["audit", "simulation", "cancel"]), chat_id: identifier, connection_id: identifier, job_id: identifier }).strict();
export const runCacheDiagnosticTool = defineTool({
  name: "run_cache_diagnostic",
  description: "Start a LumiCache cache-health audit or simulation, or cancel its job_id. Returns a background job immediately. Poll with inspect_cache action=job, then read its report. Requires LumiCache enabled in a connected Lumiverse browser. chat_id defaults to the pinned chat. connection_id selects the chat model being tested, not necessarily this agent's model. Simulation builds five future prompts and up to three historical prompts on a disposable chat copy, then removes it. No chat-model generation requests are made, but configured retrieval may run. Simulation follows normal change approval. These temporary diagnostics are outside Workshop undo. Only the user can release a paused send in LumiCache.",
  inputSchema: runSchema,
  jsonSchema: { type: "object", properties: { action: { type: "string", enum: ["audit", "simulation", "cancel"] },
    chat_id: { type: "string" }, connection_id: { type: "string" }, job_id: { type: "string" } }, required: ["action"] },
  requiresCharacter: false,
  execute: async (input, ctx) => {
    try {
      ctx.signal.throwIfAborted();
      const chatId = input.chat_id ?? ctx.pinnedChatId;
      if (input.action !== "cancel" && !chatId) throw new Error("Pass chat_id or pin the chat to diagnose.");
      if (input.action === "cancel" && !input.job_id) throw new Error("Pass the returned job_id to cancel.");
      const result = await dialCache(ctx.spindle, { userId: ctx.userId, action: input.action === "cancel" ? "cancel" : "start",
        kind: input.action === "cancel" ? undefined : input.action, chatId: chatId ?? undefined, connectionId: input.connection_id, jobId: input.job_id,
        ...(ctx.rootCallId ? { callId: `cache:${ctx.sessionId}:${ctx.rootCallId}`.slice(0, 200) } : {}) });
      return { content: JSON.stringify(result, null, 2) };
    } catch (error) { return { content: `LumiCache: ${(error as Error).message}`, isError: true }; }
  },
});
