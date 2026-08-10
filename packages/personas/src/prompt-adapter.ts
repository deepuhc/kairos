import type { Persona } from './types.js';

/**
 * Build the system prompt for an AI session based on the active persona.
 * Combines the persona's base system prompt with optional context.
 */
export function buildSystemPrompt(persona: Persona, options?: PromptOptions): string {
  const parts: string[] = [];

  // Base persona prompt
  parts.push(persona.systemPrompt);

  // Privacy context
  if (persona.defaultPrivacy === 'local') {
    parts.push('\nIMPORTANT: This session is running in local-only mode. All processing happens on-device. Do not suggest actions that would send data to external services.');
  }

  // Project context (if provided)
  if (options?.projectContext) {
    parts.push(`\nProject context:\n${options.projectContext}`);
  }

  // User-defined additional instructions
  if (options?.additionalInstructions) {
    parts.push(`\n${options.additionalInstructions}`);
  }

  // Kid mode safety layer
  if (options?.kidMode) {
    parts.push('\nSAFETY: This session is in kid-safe mode. Keep all responses age-appropriate. Do not discuss violence, explicit content, dangerous activities, or anything unsuitable for children. If asked about inappropriate topics, redirect to a constructive alternative.');
  }

  return parts.join('\n');
}

export interface PromptOptions {
  projectContext?: string;
  additionalInstructions?: string;
  kidMode?: boolean;
}
