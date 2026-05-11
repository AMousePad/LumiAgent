import { z } from "zod";
import { defineTool } from "./_framework";

const inputSchema = z.object({}).strict();

export const getUserInfoTool = defineTool({
  name: "get_user_info",
  description: "Get the user's Lumiverse role (`user` / `admin` / `operator`) and visibility (whether they have the app open in any browser session right now). Useful for tailoring suggestions or skipping toasts when the user can't see them.",
  inputSchema,
  jsonSchema: { type: "object", properties: {}, required: [] },
  defaultSensitivity: "insensitive",
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
