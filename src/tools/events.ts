import {
  ChannelType,
  GuildScheduledEventEntityType,
  GuildScheduledEventPrivacyLevel,
  PermissionFlagsBits,
} from 'discord.js';
import type { ToolDefinition, ToolResult } from './types.js';

function fmt(d: Date): string {
  return d.toLocaleString('fr-FR', {
    day: '2-digit',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Paris',
  });
}

interface CreateArgs {
  name: string;
  start_time: string;
  end_time?: string;
  description?: string;
  channel_id?: string;
  location?: string;
}

export const createEventTool: ToolDefinition = {
  name: 'create_event',
  description:
    "Cree un evenement programme. Donne start_time (et end_time) au format ISO 8601 avec le fuseau, calcule depuis la date du Contexte (ex: '2026-06-15T20:00:00+02:00'). Soit channel_id (un vocal ou un stage), soit location (lieu externe en texte, qui exige aussi end_time). Action directe.",
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: "Nom de l'evenement." },
      start_time: { type: 'string', description: 'Date/heure de debut, ISO 8601 avec fuseau (ex: 2026-06-15T20:00:00+02:00).' },
      end_time: { type: 'string', description: 'Date/heure de fin, ISO 8601. Obligatoire pour un evenement avec location.' },
      description: { type: 'string', description: "Description (optionnel)." },
      channel_id: { type: 'string', description: 'ID du salon vocal ou stage ou se tient l\'evenement.' },
      location: { type: 'string', description: "Lieu externe en texte (si pas de salon vocal). Exige end_time." },
    },
    required: ['name', 'start_time'],
  },
  requiredPermission: PermissionFlagsBits.ManageEvents,
  execute: async (rawArgs, ctx): Promise<ToolResult> => {
    const a = rawArgs as CreateArgs;
    if (!a.name || typeof a.name !== 'string') {
      return { ok: false, error: 'name (string) requis.' };
    }
    const start = new Date(a.start_time);
    if (Number.isNaN(start.getTime())) {
      return { ok: false, error: `start_time invalide: "${a.start_time}". Utilise un format ISO 8601 avec fuseau.` };
    }
    if (start.getTime() <= Date.now()) {
      return { ok: false, error: "La date de debut doit etre dans le futur." };
    }
    let end: Date | undefined;
    if (a.end_time !== undefined) {
      end = new Date(a.end_time);
      if (Number.isNaN(end.getTime())) {
        return { ok: false, error: `end_time invalide: "${a.end_time}".` };
      }
      if (end.getTime() <= start.getTime()) {
        return { ok: false, error: 'end_time doit etre apres start_time.' };
      }
    }

    let entityType: GuildScheduledEventEntityType;
    let channelId: string | undefined;
    let location: string | undefined;

    if (a.channel_id) {
      const ch = ctx.guild.channels.cache.get(a.channel_id);
      if (!ch) return { ok: false, error: `Salon "${a.channel_id}" introuvable.` };
      if (ch.type === ChannelType.GuildVoice) entityType = GuildScheduledEventEntityType.Voice;
      else if (ch.type === ChannelType.GuildStageVoice) entityType = GuildScheduledEventEntityType.StageInstance;
      else return { ok: false, error: "Un evenement avec salon doit pointer vers un vocal ou un stage." };
      channelId = a.channel_id;
    } else if (a.location) {
      if (!end) return { ok: false, error: 'Un evenement avec un lieu (location) exige aussi end_time.' };
      entityType = GuildScheduledEventEntityType.External;
      location = a.location;
    } else {
      return { ok: false, error: 'Precise soit channel_id (vocal/stage), soit location (lieu externe).' };
    }

    try {
      const event = await ctx.guild.scheduledEvents.create({
        name: a.name,
        scheduledStartTime: start,
        scheduledEndTime: end,
        privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
        entityType,
        channel: channelId,
        entityMetadata: location ? { location } : undefined,
        description: a.description,
        reason: `A.E.G.I.S: evenement cree par ${ctx.owner.tag}`,
      });
      const where = location ? location : channelId ? `<#${channelId}>` : '';
      return {
        ok: true,
        summary: `Evenement "${event.name}" cree`,
        display: `Evenement **${event.name}** programme le ${fmt(start)}${where ? ` (${where})` : ''}.`,
        data: { id: event.id, name: event.name },
      };
    } catch (err) {
      return { ok: false, error: `Echec de la creation de l'evenement: ${String(err)}` };
    }
  },
};

export const listEventsTool: ToolDefinition = {
  name: 'list_events',
  description: 'Liste les evenements programmes du serveur (a venir et en cours).',
  parameters: { type: 'object', properties: {}, required: [] },
  requiredPermission: null,
  execute: async (_args, ctx): Promise<ToolResult> => {
    try {
      const events = await ctx.guild.scheduledEvents.fetch();
      const sorted = Array.from(events.values()).sort(
        (a, b) => (a.scheduledStartTimestamp ?? 0) - (b.scheduledStartTimestamp ?? 0),
      );
      const lines: string[] = [`### Evenements de ${ctx.guild.name} (${sorted.length})`, ''];
      if (sorted.length === 0) {
        lines.push('-# *(aucun evenement programme)*');
      } else {
        for (const e of sorted) {
          const when = e.scheduledStartAt ? fmt(e.scheduledStartAt) : 'date inconnue';
          const where = e.entityMetadata?.location ?? (e.channelId ? `<#${e.channelId}>` : '');
          lines.push(`- **${e.name}** le ${when}${where ? ` (${where})` : ''}`);
        }
      }
      return {
        ok: true,
        summary: `${sorted.length} evenement(s)`,
        display: lines.join('\n'),
        data: sorted.map((e) => ({ id: e.id, name: e.name, start: e.scheduledStartTimestamp })),
      };
    } catch (err) {
      return { ok: false, error: `Echec de la lecture des evenements: ${String(err)}` };
    }
  },
};

export const deleteEventTool: ToolDefinition = {
  name: 'delete_event',
  description: "Supprime un evenement programme par son ID (visible via list_events). Action directe.",
  parameters: {
    type: 'object',
    properties: {
      event_id: { type: 'string', description: "ID de l'evenement a supprimer." },
    },
    required: ['event_id'],
  },
  requiredPermission: PermissionFlagsBits.ManageEvents,
  execute: async (rawArgs, ctx): Promise<ToolResult> => {
    const a = rawArgs as { event_id: string };
    if (!a.event_id || typeof a.event_id !== 'string') {
      return { ok: false, error: 'event_id (string) requis.' };
    }
    const event = await ctx.guild.scheduledEvents.fetch(a.event_id).catch(() => null);
    if (!event) return { ok: false, error: `Evenement ID "${a.event_id}" introuvable.` };
    const name = event.name;
    try {
      await event.delete();
      return {
        ok: true,
        summary: `Evenement "${name}" supprimé`,
        display: `Evenement **${name}** supprimé.`,
        data: { id: a.event_id, name },
      };
    } catch (err) {
      return { ok: false, error: `Echec de la suppression de l'evenement: ${String(err)}` };
    }
  },
};
