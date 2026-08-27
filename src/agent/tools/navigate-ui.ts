import { z } from "zod";
import { defineTool } from "./_framework";
import description from "../prompts/claude/tools/navigate-ui/description.txt";
import argDrawerTab from "../prompts/claude/tools/navigate-ui/arg_drawer_tab.txt";
import argSettingsView from "../prompts/claude/tools/navigate-ui/arg_settings_view.txt";
import argList from "../prompts/claude/tools/navigate-ui/arg_list.txt";

const inputSchema = z.object({
  drawer_tab: z.string().optional(),
  settings_view: z.string().optional(),
  list: z.boolean().optional(),
}).strict().refine(
  (d) => [d.drawer_tab, d.settings_view, d.list].filter((v) => v !== undefined && v !== false).length === 1,
  { message: "pass exactly one of drawer_tab / settings_view / list" },
);

export const navigateUiTool = defineTool({
  name: "navigate_ui",
  description,
  inputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      drawer_tab: { type: "string", description: argDrawerTab },
      settings_view: { type: "string", description: argSettingsView },
      list: { type: "boolean", description: argList },
    },
    required: [],
    additionalProperties: false,
  },
  requiresCharacter: false,
  isReadOnly: (input) => (input as { list?: boolean }).list === true,
  execute: async (input, ctx) => {
    try {
      if (input.list === true) {
        const [drawer, settings] = await Promise.all([
          ctx.spindle.ui.getDrawerTabs({ userId: ctx.userId }),
          ctx.spindle.ui.getSettingsTabs({ userId: ctx.userId }),
        ]);
        return {
          content: JSON.stringify({
            drawer_tabs: drawer.map((t) => ({ id: t.id, name: t.tabName ?? t.shortName ?? t.id })),
            settings_views: settings.map((t) => ({ id: t.id, name: t.tabName ?? t.shortName ?? t.id })),
          }, null, 2),
        };
      }
      if (input.drawer_tab !== undefined) {
        await ctx.spindle.ui.openDrawerTab(input.drawer_tab, { userId: ctx.userId });
        return { content: JSON.stringify({ opened: { drawer_tab: input.drawer_tab } }) };
      }
      await ctx.spindle.ui.openSettings(input.settings_view!, { userId: ctx.userId });
      return { content: JSON.stringify({ opened: { settings_view: input.settings_view } }) };
    } catch (err) {
      return { content: `Error: [SPINDLE_ERROR] ${(err as Error).message}`, isError: true };
    }
  },
});
