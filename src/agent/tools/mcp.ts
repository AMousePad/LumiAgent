import { z } from "zod";
import type { ToolCtx } from "./_context";
import { defineTool, type ToolResult } from "./_framework";
import { readBudgetChars, spillOrReturn } from "./_io";
import listDescription from "../prompts/claude/tools/list-mcp-servers/description.txt";
import getDescription from "../prompts/claude/tools/get-mcp-server/description.txt";
import createDescription from "../prompts/claude/tools/create-mcp-server/description.txt";
import connectDescription from "../prompts/claude/tools/connect-mcp-server/description.txt";
import toolsDescription from "../prompts/claude/tools/list-mcp-tools/description.txt";
import callDescription from "../prompts/claude/tools/call-mcp-tool/description.txt";

const serverId = z.string().min(1).describe("Full server ID from list_mcp_servers or create_mcp_server.");
const serverInput = z.object({ server_id: serverId }).strict();
const listInput = z.object({
  limit: z.number().int().min(1).max(100).optional().describe("Page size, default 50."),
  offset: z.number().int().min(0).optional().describe("Zero-based offset, default 0."),
}).strict();
const toolsInput = z.object({
  server_id: serverId,
  query: z.string().min(1).optional().describe("Filter tool names and descriptions by a case-insensitive substring."),
  limit: z.number().int().min(1).max(100).optional().describe("Page size, default 20."),
  offset: z.number().int().min(0).optional().describe("Zero-based offset into matching tools, default 0."),
}).strict();
const callInput = z.object({
  server_id: serverId,
  tool_name: z.string().min(1).describe("Exact MCP tool name returned by list_mcp_tools, without a prefix."),
  arguments: z.record(z.string(), z.unknown()).optional().describe("Arguments matching the tool's input_schema. Defaults to {}."),
  timeout_ms: z.number().int().min(1_000).max(120_000).optional().describe("Host timeout in milliseconds, default 30000."),
}).strict();
const createInput = z.object({
  name: z.string().trim().min(1).max(200),
  transport_type: z.enum(["streamable_http", "sse", "stdio"]),
  url: z.string().min(1).max(4096).optional().describe("Absolute HTTP(S) endpoint for streamable_http or sse."),
  command: z.string().min(1).optional().describe("Executable for stdio, subject to Lumiverse's launch policy."),
  args: z.array(z.string()).optional().describe("Command arguments for stdio."),
  env: z.record(z.string(), z.string()).optional().describe("Environment variables for stdio."),
  headers: z.record(z.string(), z.string()).optional().describe("HTTP headers for streamable_http or sse."),
  is_enabled: z.boolean().optional().describe("Whether the profile is enabled, default true."),
  auto_connect: z.boolean().optional().describe("Connect automatically on host startup, default false."),
}).strict();

async function mcpResult(ctx: ToolCtx, origin: string, operation: () => Promise<unknown>): Promise<ToolResult> {
  if (ctx.signal.aborted) {
    return { content: "Error: [CANCELLED] MCP operation cancelled before execution.", isError: true };
  }
  let payload: string;
  let isError = false;
  try {
    const result = await operation();
    payload = typeof result === "string" ? result : JSON.stringify(result, null, 2);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    payload = `Error: [SPINDLE_ERROR] ${message}`;
    isError = true;
  }
  try {
    return { content: await spillOrReturn(ctx, payload, origin), ...(isError ? { isError: true } : {}) };
  } catch {
    if (isError) {
      return { content: `${payload.slice(0, readBudgetChars(ctx))}\n\n[MCP error output truncated because its full text could not be stored.]`, isError: true };
    }
    // A storage failure after a successful remote call must not invite a repeated mutation.
    return {
      content: `${payload.slice(0, readBudgetChars(ctx))}\n\n[Output truncated: the MCP operation completed, but its full result could not be stored. Do not repeat a state-changing call to recover the output.]`,
    };
  }
}

export const listMcpServersTool = defineTool({
  name: "list_mcp_servers",
  description: listDescription,
  inputSchema: listInput,
  jsonSchema: z.toJSONSchema(listInput),
  isReadOnly: () => true,
  execute: (input, ctx) => mcpResult(ctx, "list_mcp_servers", async () => {
    const limit = input.limit ?? 50;
    const offset = input.offset ?? 0;
    const result = await ctx.spindle.mcp.servers.list({ limit, offset, userId: ctx.userId });
    return {
      ...result,
      offset,
      has_more: offset + result.data.length < result.total,
      ...(result.total === 0 ? { note: "No MCP servers configured. Use create_mcp_server or Lumiverse Settings > MCP Servers to add one." } : {}),
    };
  }),
});

export const getMcpServerTool = defineTool({
  name: "get_mcp_server",
  description: getDescription,
  inputSchema: serverInput,
  jsonSchema: z.toJSONSchema(serverInput),
  isReadOnly: () => true,
  execute: (input, ctx) => mcpResult(ctx, `get_mcp_server:${input.server_id}`, async () => {
    const server = await ctx.spindle.mcp.servers.get(input.server_id, ctx.userId);
    if (!server) throw new Error("MCP server not found.");
    const status = await ctx.spindle.mcp.servers.status(input.server_id, ctx.userId);
    const { tools: _tools, ...connection } = status;
    return { server, status: connection };
  }),
});

export const createMcpServerTool = defineTool({
  name: "create_mcp_server",
  description: createDescription,
  inputSchema: createInput,
  jsonSchema: z.toJSONSchema(createInput),
  validateInput: (input) => {
    if (input.transport_type === "stdio") {
      if (!input.command?.trim()) return { result: false, errorCode: "INVALID_INPUT", message: "command is required for stdio." };
    } else {
      try {
        const url = new URL(input.url ?? "");
        if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error();
      } catch {
        return { result: false, errorCode: "INVALID_INPUT", message: "An absolute HTTP(S) url is required for this transport." };
      }
    }
    return { result: true };
  },
  execute: (input, ctx) => mcpResult(ctx, "create_mcp_server", async () => {
    const server = await ctx.spindle.mcp.servers.create({
      name: input.name,
      transport_type: input.transport_type,
      auto_connect: input.auto_connect ?? false,
      ...(input.url !== undefined ? { url: input.url } : {}),
      ...(input.command !== undefined ? { command: input.command } : {}),
      ...(input.args !== undefined ? { args: input.args } : {}),
      ...(input.env !== undefined ? { env: input.env } : {}),
      ...(input.headers !== undefined ? { headers: input.headers } : {}),
      ...(input.is_enabled !== undefined ? { is_enabled: input.is_enabled } : {}),
    }, ctx.userId);
    return { server, note: "Profile created. Use connect_mcp_server before listing or calling its tools." };
  }),
});

export const connectMcpServerTool = defineTool({
  name: "connect_mcp_server",
  description: connectDescription,
  inputSchema: serverInput,
  jsonSchema: z.toJSONSchema(serverInput),
  execute: async (input, ctx) => {
    let connected = false;
    const result = await mcpResult(ctx, `connect_mcp_server:${input.server_id}`, async () => {
      const status = await ctx.spindle.mcp.servers.connect(input.server_id, ctx.userId);
      connected = status.connected;
      const { tools: _tools, ...connection } = status;
      return {
        ...connection,
        note: connected ? "Use list_mcp_tools to inspect tool names and argument schemas." : "Connection failed. Check this server in Lumiverse Settings > MCP Servers.",
      };
    });
    return connected ? result : { ...result, isError: true };
  },
});

export const listMcpToolsTool = defineTool({
  name: "list_mcp_tools",
  description: toolsDescription,
  inputSchema: toolsInput,
  jsonSchema: z.toJSONSchema(toolsInput),
  isReadOnly: () => true,
  execute: (input, ctx) => mcpResult(ctx, `list_mcp_tools:${input.server_id}`, async () => {
    const status = await ctx.spindle.mcp.servers.status(input.server_id, ctx.userId);
    if (!status.connected) throw new Error("MCP server is not connected. Use connect_mcp_server first.");
    const tools = await ctx.spindle.mcp.tools.list(input.server_id, ctx.userId);
    const query = input.query?.toLowerCase();
    const matches = query ? tools.filter((tool) => `${tool.name}\n${tool.description}`.toLowerCase().includes(query)) : tools;
    const offset = input.offset ?? 0;
    const page = matches.slice(offset, offset + (input.limit ?? 20));
    return {
      server_id: input.server_id,
      tools: page,
      total: matches.length,
      offset,
      has_more: offset + page.length < matches.length,
      note: "Call these tools through call_mcp_tool using server_id, the exact tool_name, and arguments matching input_schema.",
    };
  }),
});

export const callMcpToolTool = defineTool({
  name: "call_mcp_tool",
  description: callDescription,
  inputSchema: callInput,
  jsonSchema: z.toJSONSchema(callInput),
  validateInput: (input) => {
    try {
      const serialized = JSON.stringify(input.arguments ?? {});
      if (new TextEncoder().encode(serialized).byteLength > 1_048_576) {
        return { result: false, errorCode: "INVALID_INPUT", message: "MCP tool arguments exceed the 1 MiB host limit." };
      }
    } catch {
      return { result: false, errorCode: "INVALID_INPUT", message: "MCP tool arguments must be JSON serializable." };
    }
    return { result: true };
  },
  execute: (input, ctx) => mcpResult(ctx, `call_mcp_tool:${input.server_id}:${input.tool_name}`, () =>
    ctx.spindle.mcp.tools.call(input.server_id, input.tool_name, input.arguments ?? {}, {
      userId: ctx.userId,
      ...(input.timeout_ms !== undefined ? { timeoutMs: input.timeout_ms } : {}),
    })),
});
