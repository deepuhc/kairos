import type { WorkflowTemplate, TemplateCategory } from './types.js';

export class TemplateRegistry {
  private templates: Map<string, WorkflowTemplate> = new Map();

  register(template: WorkflowTemplate): void {
    this.templates.set(template.id, template);
  }

  unregister(id: string): boolean {
    return this.templates.delete(id);
  }

  get(id: string): WorkflowTemplate | undefined {
    return this.templates.get(id);
  }

  list(category?: TemplateCategory): WorkflowTemplate[] {
    const all = [...this.templates.values()];
    if (!category) return all;
    return all.filter(t => t.category === category);
  }

  search(query: string): WorkflowTemplate[] {
    const q = query.toLowerCase();
    return [...this.templates.values()].filter(t =>
      t.name.toLowerCase().includes(q) ||
      t.description.toLowerCase().includes(q)
    );
  }

  categories(): TemplateCategory[] {
    const cats = new Set<TemplateCategory>();
    for (const t of this.templates.values()) cats.add(t.category);
    return [...cats];
  }
}
