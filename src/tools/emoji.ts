import { PermissionFlagsBits } from 'discord.js';
import type { ToolDefinition, ToolResult } from './types.js';

export const listEmojisTool: ToolDefinition = {
  name: 'list_emojis',
  description: "Liste les emojis personnalises du serveur avec leur nom et leur ID (utile avant un delete_emoji).",
  parameters: { type: 'object', properties: {}, required: [] },
  requiredPermission: null,
  execute: async (_args, ctx): Promise<ToolResult> => {
    const emojis = Array.from(ctx.guild.emojis.cache.values());
    const lines: string[] = [`### Emojis de ${ctx.guild.name} (${emojis.length})`, ''];
    if (emojis.length === 0) {
      lines.push('-# *(aucun emoji personnalise)*');
    } else {
      for (const e of emojis) {
        lines.push(`- ${e.toString()} \`:${e.name}:\` (\`${e.id}\`)${e.animated ? ' (animé)' : ''}`);
      }
    }
    return {
      ok: true,
      summary: `${emojis.length} emoji(s)`,
      display: lines.join('\n'),
      data: emojis.map((e) => ({ id: e.id, name: e.name, animated: e.animated })),
    };
  },
};

export const createEmojiTool: ToolDefinition = {
  name: 'create_emoji',
  description:
    "Ajoute un emoji personnalise au serveur a partir d'une image (URL). L'URL vient d'un lien d'image dans le message ou d'une image jointe (listee dans le Contexte). Le nom ne doit contenir que des lettres, chiffres et underscores (2 a 32 caracteres). Action directe.",
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: "Nom de l'emoji (lettres/chiffres/underscores, 2-32 caracteres)." },
      image_url: { type: 'string', description: "URL de l'image (png/jpg/gif, max 256 Ko cote Discord)." },
    },
    required: ['name', 'image_url'],
  },
  requiredPermission: PermissionFlagsBits.ManageGuildExpressions,
  execute: async (rawArgs, ctx): Promise<ToolResult> => {
    const a = rawArgs as { name: string; image_url: string };
    if (!a.name || !/^\w{2,32}$/.test(a.name)) {
      return { ok: false, error: "Nom d'emoji invalide: uniquement lettres, chiffres et underscores, 2 a 32 caracteres." };
    }
    if (!a.image_url || !/^https?:\/\//i.test(a.image_url)) {
      return { ok: false, error: 'image_url doit etre une URL http(s) valide vers une image.' };
    }
    try {
      const emoji = await ctx.guild.emojis.create({
        attachment: a.image_url,
        name: a.name,
        reason: `A.E.G.I.S: emoji ajoute par ${ctx.owner.tag}`,
      });
      return {
        ok: true,
        summary: `Emoji "${emoji.name}" ajouté`,
        display: `Emoji ${emoji.toString()} (\`:${emoji.name}:\`) ajouté au serveur.`,
        data: { id: emoji.id, name: emoji.name },
      };
    } catch (err) {
      return { ok: false, error: `Echec de l'ajout de l'emoji (image trop lourde ou URL invalide ?): ${String(err)}` };
    }
  },
};

export const deleteEmojiTool: ToolDefinition = {
  name: 'delete_emoji',
  description:
    "Supprime un emoji personnalise du serveur. emoji_id est l'ID de l'emoji (visible via list ou dans le markdown <:nom:id>). Action directe.",
  parameters: {
    type: 'object',
    properties: {
      emoji_id: { type: 'string', description: "ID de l'emoji a supprimer." },
    },
    required: ['emoji_id'],
  },
  requiredPermission: PermissionFlagsBits.ManageGuildExpressions,
  execute: async (rawArgs, ctx): Promise<ToolResult> => {
    const a = rawArgs as { emoji_id: string };
    if (!a.emoji_id || typeof a.emoji_id !== 'string') {
      return { ok: false, error: 'emoji_id (string) requis.' };
    }
    const emoji = ctx.guild.emojis.cache.get(a.emoji_id);
    if (!emoji) return { ok: false, error: `Emoji ID "${a.emoji_id}" introuvable sur le serveur.` };
    const name = emoji.name ?? a.emoji_id;
    try {
      await emoji.delete(`A.E.G.I.S: emoji supprime par ${ctx.owner.tag}`);
      return {
        ok: true,
        summary: `Emoji "${name}" supprimé`,
        display: `Emoji \`:${name}:\` supprimé du serveur.`,
        data: { id: a.emoji_id, name },
      };
    } catch (err) {
      return { ok: false, error: `Echec de la suppression de l'emoji: ${String(err)}` };
    }
  },
};
