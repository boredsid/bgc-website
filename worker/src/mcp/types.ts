import type { Env } from '../index';

// A tool exposed by the /mcp endpoint. `handler` returns JSON-serializable
// data (the protocol layer wraps it as text content) and throws ToolError
// for failures whose message is safe to show the calling agent.
export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>, env: Env, ctx: ExecutionContext) => Promise<unknown>;
}

export class ToolError extends Error {}
