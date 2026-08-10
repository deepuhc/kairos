import type { Persona, PersonaId } from './types.js';
import { BUILT_IN_PERSONAS } from './built-in.js';

export class PersonaRegistry {
  private personas: Map<PersonaId, Persona> = new Map();

  constructor() {
    for (const persona of BUILT_IN_PERSONAS) {
      this.personas.set(persona.id, persona);
    }
  }

  get(id: PersonaId): Persona | undefined {
    return this.personas.get(id);
  }

  getAll(): Persona[] {
    return [...this.personas.values()];
  }

  register(persona: Persona): void {
    this.personas.set(persona.id, persona);
  }

  unregister(id: PersonaId): boolean {
    return this.personas.delete(id);
  }

  /** Get IDs of all registered personas */
  ids(): PersonaId[] {
    return [...this.personas.keys()];
  }
}
