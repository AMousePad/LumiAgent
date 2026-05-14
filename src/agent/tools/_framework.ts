import type { z, ZodType } from "zod";
import type { ToolCtx } from "./_context";

export interface ToolResult {
  readonly content: string;
  readonly isError?: boolean;
}

export interface ToolDefinition<TInput = unknown> {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: ZodType<TInput>;
  readonly jsonSchema: Record<string, unknown>;
  readonly requiresRecentRead?: ReadGate;
  // True when the tool's execution is meaningless without an active character
  // (path-based card surface, card mutators, chat/ledger/phone-line ops, etc).
  // Filtered out of the schemas the LLM sees when state.characterId is null,
  // so the agent literally cannot call them in no-character sessions.
  readonly requiresCharacter?: boolean;
  // Both default false (safe). isReadOnly is a strict statement that the call
  // performs no spindle/userStorage writes and pushes nothing onto the edit
  // ledger. isConcurrencySafe means it's safe to run alongside other
  // concurrency-safe calls in the same batch, usually equivalent to
  // isReadOnly but tools with side-effects on independent keys may set it
  // without being read-only. Loop runs consecutive concurrency-safe calls
  // in parallel (cap 5).
  readonly isReadOnly?: (input: TInput) => boolean;
  readonly isConcurrencySafe?: (input: TInput) => boolean;
  // Pre-flight validation, called before execute(). Returning a coded error
  // short-circuits dispatch and surfaces to the model. Use for checks that
  // can decide pass/fail without performing side effects (recent-read gate,
  // shape checks, range checks). Heavier checks belong in execute().
  readonly validateInput?: (input: TInput, ctx: ToolCtx) => Promise<ValidationResult> | ValidationResult;
  readonly execute: (input: TInput, ctx: ToolCtx) => Promise<ToolResult>;
}

export type ValidationResult =
  | { readonly result: true }
  | { readonly result: false; readonly message: string; readonly errorCode: string };

export interface ReadGate {
  surface: (input: Record<string, unknown>) => string;
  hint: (key: string) => string;
}

export function defineTool<TInput>(config: {
  name: string;
  description: string;
  inputSchema: ZodType<TInput>;
  jsonSchema: Record<string, unknown>;
  requiresRecentRead?: ReadGate;
  requiresCharacter?: boolean;
  isReadOnly?: (input: TInput) => boolean;
  isConcurrencySafe?: (input: TInput) => boolean;
  validateInput?: (input: TInput, ctx: ToolCtx) => Promise<ValidationResult> | ValidationResult;
  execute: (input: TInput, ctx: ToolCtx) => Promise<ToolResult>;
}): ToolDefinition<TInput> {
  return config;
}

export class ToolRegistry {
  private readonly map = new Map<string, ToolDefinition>();

  register<T>(tool: ToolDefinition<T>): void {
    if (this.map.has(tool.name)) {
      throw new Error(`Tool '${tool.name}' already registered.`);
    }
    this.map.set(tool.name, tool as ToolDefinition);
  }

  get(name: string): ToolDefinition | undefined {
    return this.map.get(name);
  }

  list(): readonly ToolDefinition[] {
    return [...this.map.values()];
  }

  schemas(): Array<{ name: string; description: string; parameters: Record<string, unknown> }> {
    return this.list().map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.jsonSchema,
    }));
  }

  schemaFor(name: string): { name: string; description: string; parameters: Record<string, unknown> } | undefined {
    const t = this.map.get(name);
    if (!t) return undefined;
    return { name: t.name, description: t.description, parameters: t.jsonSchema };
  }

  // True when the tool requires an active character. Used by the LLM-facing
  // schema build to drop char-required tools in no-character sessions.
  requiresCharacter(name: string): boolean {
    return this.map.get(name)?.requiresCharacter === true;
  }
}

export function formatZodError(err: z.ZodError): string {
  return err.issues
    .map((i) => `  • ${i.path.length > 0 ? i.path.join(".") : "(root)"}: ${i.message}`)
    .join("\n");
}
