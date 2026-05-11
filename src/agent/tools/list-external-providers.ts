import { z } from "zod";
import { defineTool } from "./_framework";

const inputSchema = z.object({}).strict();

export const listExternalProvidersTool = defineTool({
  name: "list_external_providers",
  description: "List third-party extensions that have opted in to exposing data through the lumiagent surface protocol. Returns each provider's id, display name, and the surfaces it offers (with descriptions, field schemas, scope). Call this FIRST when the user asks about data not in the character's canonical surfaces (e.g. LumiRealm modules, other extensions' stored items). The agent then uses list_external_items / read_external_item / edit_external_item / update_external_item to interact with each surface.",
  inputSchema,
  jsonSchema: { type: "object", properties: {}, required: [] },
  defaultSensitivity: "insensitive",
  execute: async (_input, ctx) => {
    const { discoverProviders } = await import("../../external/registry");
    const providers = await discoverProviders(ctx.spindle);
    return {
      content: JSON.stringify({
        count: providers.length,
        providers: providers.map((p) => ({
          id: p.id,
          name: p.manifest.extension.name,
          version: p.manifest.extension.version,
          surfaces: p.manifest.surfaces.map((s) => ({
            id: s.id,
            label: s.label,
            description: s.description,
            item_kind: s.item_kind,
            scope: s.scope.kind,
            fields: s.fields,
          })),
        })),
      }, null, 2),
    };
  },
});
