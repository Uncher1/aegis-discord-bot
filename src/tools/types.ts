import type { Guild, PermissionResolvable, User } from 'discord.js';

export interface ToolContext {
  guild: Guild;
  owner: User;
}

export type ToolResult =
  | { ok: true; summary: string; display?: string; data?: unknown }
  | { ok: false; error: string };

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  requiredPermission: PermissionResolvable | null;
  execute: (args: unknown, ctx: ToolContext) => Promise<ToolResult>;
}
