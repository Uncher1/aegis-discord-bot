import type { ToolDefinition } from './types.js';
import { listChannelsTool } from './listChannels.js';
import { listRolesTool } from './listRoles.js';
import { createChannelTool } from './createChannel.js';
import { createCategoryTool } from './createCategory.js';
import { modifyChannelTool } from './modifyChannel.js';
import { modifyCategoryTool } from './modifyCategory.js';
import { deleteChannelTool } from './deleteChannel.js';
import { deleteCategoryTool } from './deleteCategory.js';
import { createRoleTool } from './createRole.js';
import { modifyRoleTool } from './modifyRole.js';
import { deleteRoleTool } from './deleteRole.js';
import { assignRoleTool, removeRoleTool } from './memberRoles.js';
import {
  kickMemberTool,
  banMemberTool,
  unbanMemberTool,
  timeoutMemberTool,
} from './moderation.js';
import { setNicknameTool, moveMemberTool } from './memberManagement.js';
import { purgeMessagesTool } from './purgeMessages.js';
import { modifyServerTool } from './modifyServer.js';
import { cloneChannelTool } from './cloneChannel.js';
import { createEmojiTool, deleteEmojiTool } from './emoji.js';
import { createEventTool, listEventsTool, deleteEventTool } from './events.js';

export const tools: ToolDefinition[] = [
  listChannelsTool,
  listRolesTool,
  createChannelTool,
  createCategoryTool,
  modifyChannelTool,
  modifyCategoryTool,
  deleteChannelTool,
  deleteCategoryTool,
  createRoleTool,
  modifyRoleTool,
  deleteRoleTool,
  assignRoleTool,
  removeRoleTool,
  kickMemberTool,
  banMemberTool,
  unbanMemberTool,
  timeoutMemberTool,
  setNicknameTool,
  moveMemberTool,
  purgeMessagesTool,
  modifyServerTool,
  cloneChannelTool,
  createEmojiTool,
  deleteEmojiTool,
  createEventTool,
  listEventsTool,
  deleteEventTool,
];

export function findTool(name: string): ToolDefinition | undefined {
  return tools.find((t) => t.name === name);
}

export function toolsAsLlmFormat(): Array<{
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}> {
  return tools.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}
