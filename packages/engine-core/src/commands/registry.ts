import type { CommandDefinition } from './definition';
import { applyWorkspaceCommand } from './workspace/apply';
import type { CommandName, CommandSource } from './types';

/** The complete and sole mutation authority for every trusted source. */
export const AGENT_ACCESSIBLE_COMMAND_NAMES = Object.freeze(['workspace.apply'] as const);
const agentAccessibleCommandNames = new Set<string>(AGENT_ACCESSIBLE_COMMAND_NAMES);

/** Raw scene, texture, material, hierarchy, and animation mutation commands
 * have no registry entry and therefore cannot enter any command batch. */
const registrations = {
  'workspace.apply': applyWorkspaceCommand,
} satisfies Partial<Record<CommandName, CommandDefinition>>;

export const getCommandDefinition = (name: string): CommandDefinition | undefined =>
  registrations[name as keyof typeof registrations];

export const getAgentCommandDefinition = (name: string): CommandDefinition | undefined => {
  return agentAccessibleCommandNames.has(name) ? getCommandDefinition(name) : undefined;
};

export const listAgentCommandDefinitions = (): readonly CommandDefinition[] =>
  AGENT_ACCESSIBLE_COMMAND_NAMES.map((name) => registrations[name]);

export const commandAllowedForSource = (name: CommandName, source: CommandSource): boolean => {
  if (!(name in registrations)) return false;
  if (source === 'system') return true;
  if (source === 'agent') {
    return agentAccessibleCommandNames.has(name);
  }
  return name === 'workspace.apply';
};
