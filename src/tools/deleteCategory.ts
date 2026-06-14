import {
  ChannelType,
  PermissionFlagsBits,
  type CategoryChannel,
  type GuildChannel,
} from 'discord.js';
import type { ToolDefinition, ToolResult } from './types.js';
import { addPending } from '../bot/pendingAction.js';

interface Args {
  category_id: string;
  delete_children?: boolean;
}

export const deleteCategoryTool: ToolDefinition = {
  name: 'delete_category',
  description:
    "Supprime DEFINITIVEMENT une categorie. Action irreversible: enregistre la suppression et renvoie une demande de confirmation; rien n'est supprime tant que le proprietaire n'a pas confirme par 'oui'. Par defaut les salons enfants ne sont PAS supprimes (ils deviennent sans categorie). Mets delete_children=true UNIQUEMENT si le proprietaire demande explicitement de supprimer aussi les salons a l'interieur.",
  parameters: {
    type: 'object',
    properties: {
      category_id: {
        type: 'string',
        description: 'ID de la categorie a supprimer.',
      },
      delete_children: {
        type: 'boolean',
        description:
          "Si true, supprime aussi TOUS les salons contenus dans la categorie (tres destructif). Par defaut false: les salons enfants sont seulement detaches et deviennent sans categorie.",
      },
    },
    required: ['category_id'],
  },
  requiredPermission: PermissionFlagsBits.ManageChannels,
  execute: async (rawArgs, ctx): Promise<ToolResult> => {
    const a = rawArgs as Args;
    if (!a.category_id || typeof a.category_id !== 'string') {
      return { ok: false, error: 'category_id (string) requis.' };
    }
    const raw = ctx.guild.channels.cache.get(a.category_id);
    if (!raw) {
      return { ok: false, error: `Categorie ID "${a.category_id}" introuvable.` };
    }
    if (raw.type !== ChannelType.GuildCategory) {
      return {
        ok: false,
        error: `"${raw.name}" n'est pas une categorie. Utilise delete_channel pour un salon.`,
      };
    }
    const category = raw as CategoryChannel;
    const name = category.name;
    const children = Array.from(category.children.cache.values()) as GuildChannel[];
    const childCount = children.length;
    const alsoChildren = a.delete_children === true;

    const scopeNote = alsoChildren
      ? ` ET ses ${childCount} salon(s) a l'interieur`
      : childCount > 0
        ? ` (ses ${childCount} salon(s) deviendront sans categorie, pas supprimes)`
        : '';

    addPending(ctx.owner.id, {
      toolName: 'delete_category',
      requiredPermission: PermissionFlagsBits.ManageChannels,
      description: `Supprimer la categorie ${name}${scopeNote}`,
      run: async (): Promise<ToolResult> => {
        // Re-fetch at execution time: state may have changed since queueing.
        const fresh = ctx.guild.channels.cache.get(a.category_id);
        if (!fresh || fresh.type !== ChannelType.GuildCategory) {
          return { ok: false, error: `La categorie ${name} n'existe plus (deja supprimee ?).` };
        }
        const freshCat = fresh as CategoryChannel;
        const freshChildren = Array.from(freshCat.children.cache.values()) as GuildChannel[];
        const fc = freshChildren.length;
        const reason = `A.E.G.I.S: suppression demandee par ${ctx.owner.tag}`;
        const failed: string[] = [];
        let deletedChildren = 0;
        try {
          if (alsoChildren) {
            for (const child of freshChildren) {
              try {
                await child.delete(reason);
                deletedChildren++;
              } catch (err) {
                failed.push(`#${child.name} (${String(err)})`);
              }
            }
          }
          await freshCat.delete(reason);
        } catch (err) {
          return { ok: false, error: `Echec de la suppression de la categorie: ${String(err)}` };
        }

        let detail = `Categorie **${name}** supprimee.`;
        if (alsoChildren) {
          detail += ` ${deletedChildren}/${fc} salon(s) enfant(s) supprime(s).`;
          if (failed.length > 0) detail += ` Echecs: ${failed.join(', ')}.`;
        } else if (fc > 0) {
          detail += ` Les ${fc} salon(s) enfant(s) sont maintenant sans categorie.`;
        }
        return {
          ok: true,
          summary: `Categorie "${name}" supprimee`,
          display: detail,
          data: { id: a.category_id, name, deletedChildren, failures: failed.length },
        };
      },
    });

    return {
      ok: true,
      summary: `Suppression de la categorie ${name} mise en attente de confirmation`,
      display: '',
      data: { pending: true, target: name, alsoChildren },
    };
  },
};
