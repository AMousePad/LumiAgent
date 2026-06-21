import { z } from "zod";
import { defineTool } from "./_framework";
import description from "../prompts/claude/tools/get-user-info/description.txt";

const inputSchema = z.object({}).strict();

export const getUserInfoTool = defineTool({
  name: "get_user_info",
  description,
  inputSchema,
  jsonSchema: { type: "object", properties: {}, required: [] },
  execute: async (_input, ctx) => {
    try {
      const [role, visible] = await Promise.all([
        ctx.spindle.users.getRole(ctx.userId).catch(() => null),
        ctx.spindle.users.isVisible(ctx.userId).catch(() => null),
      ]);
      return { content: JSON.stringify({ user_id: ctx.userId, role, is_visible: visible }, null, 2) };
    } catch (err) {
      return { content: JSON.stringify({ error: (err as Error).message }), isError: true };
    }
  },
});
