import { z } from "zod";
import { defineTool } from "./_framework";
import type { RegexScriptCreateDTO, RegexPlacementDTO, RegexScopeDTO, RegexTargetDTO, RegexMacroModeDTO } from "lumiverse-spindle-types";

const inputSchema = z.object({
  name: z.string().min(1),
  find_regex: z.string().min(1),
  replace_string: z.string().optional(),
  flags: z.string().optional(),
  placement: z.array(z.string()).optional(),
  target: z.string().optional(),
  disabled: z.boolean().optional(),
  description: z.string().optional(),
});

export const createRegexScriptTool = defineTool({
  name: "create_regex_script",
  description: "Create a new regex script scoped to the active character. Returns the new script's id.",
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      name: { type: "string" },
      find_regex: { type: "string" },
      replace_string: { type: "string" },
      flags: { type: "string", description: "default 'g'" },
      placement: { type: "array", items: { type: "string", enum: ["user_input", "ai_output", "world_info", "reasoning"] } },
      target: { type: "string", enum: ["prompt", "response", "display"], description: "default 'display'" },
      disabled: { type: "boolean" },
      description: { type: "string" },
    },
    required: ["name", "find_regex"],
  },
  defaultSensitivity: "insensitive",
  requiresCharacter: true,
  execute: async (input, ctx) => {
    const placement = (input.placement ?? ["ai_output"]) as RegexPlacementDTO[];
    const create: RegexScriptCreateDTO = {
      name: input.name,
      find_regex: input.find_regex,
      scope: "character" as RegexScopeDTO,
      scope_id: ctx.characterId,
      placement,
    };
    if (input.replace_string !== undefined) create.replace_string = input.replace_string;
    if (input.flags !== undefined) create.flags = input.flags;
    if (input.target) create.target = input.target as RegexTargetDTO;
    if (input.disabled !== undefined) create.disabled = input.disabled;
    if (input.description !== undefined) create.description = input.description;
    create.substitute_macros = "none" as RegexMacroModeDTO;
    const created = await ctx.spindle.regex_scripts.create(create, ctx.userId);
    ctx.pushEdit({ op: "create", surface: "regex_script", surfaceId: created.id, surfaceLabel: created.name, snapshot: created });
    return { content: JSON.stringify({ script_id: created.id, name: created.name, target: created.target, placement: created.placement }) };
  },
});
