import type { PipelineDefinition, PhaseDefinition } from '@kairos/orchestrator';

export type NodeType = 'ai-task' | 'human-review' | 'file-input' | 'file-output' | 'condition' | 'loop' | 'delay';

export type TemplateCategory = 'developer' | 'designer' | 'hr' | 'finance' | 'sales' | 'legal' | 'student' | 'general';

export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  category: TemplateCategory;
  icon: string;
  version: string;
  author?: string;
  graph: VisualGraph;
  pipeline: PipelineDefinition;
}

export interface VisualGraph {
  nodes: VisualNode[];
  edges: VisualEdge[];
}

export interface VisualNode {
  id: string;
  type: NodeType;
  label: string;
  position: { x: number; y: number };
  config: NodeConfig;
}

export interface NodeConfig {
  /** For ai-task nodes */
  prompt?: string;
  model?: string;
  /** For human-review nodes */
  reviewMessage?: string;
  /** For condition nodes */
  condition?: string;
  /** For delay nodes */
  delayMs?: number;
  /** For file-input/output nodes */
  filePattern?: string;
  outputPath?: string;
}

export interface VisualEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  /** For condition edges: which branch */
  branch?: 'true' | 'false';
}
