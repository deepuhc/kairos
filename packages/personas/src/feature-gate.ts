import type { Persona, Feature, FeatureVisibility } from './types.js';

export class FeatureGate {
  private persona: Persona;

  constructor(persona: Persona) {
    this.persona = persona;
  }

  /** Check if a feature is visible for the current persona */
  isVisible(feature: Feature): boolean {
    return this.persona.features[feature] === 'visible';
  }

  /** Check if a feature should be shown but in collapsed/minimized state */
  isCollapsed(feature: Feature): boolean {
    return this.persona.features[feature] === 'collapsed';
  }

  /** Check if a feature is completely hidden */
  isHidden(feature: Feature): boolean {
    return this.persona.features[feature] === 'hidden';
  }

  /** Get the visibility state for a feature */
  visibility(feature: Feature): FeatureVisibility[Feature] {
    return this.persona.features[feature];
  }

  /** Get all visible features */
  visibleFeatures(): Feature[] {
    return (Object.entries(this.persona.features) as [Feature, string][])
      .filter(([, v]) => v === 'visible')
      .map(([f]) => f);
  }

  /** Update persona (e.g., when user switches) */
  setPersona(persona: Persona): void {
    this.persona = persona;
  }
}
