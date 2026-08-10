import type { PipelineDefinition, PhaseDefinition } from '@kairos/orchestrator';
import type { VisualGraph, VisualNode, VisualEdge } from './types.js';

/**
 * Converts a visual node graph into a PipelineDefinition for execution.
 */
export class VisualCompiler {
  compile(name: string, graph: VisualGraph): PipelineDefinition {
    const phases: PhaseDefinition[] = graph.nodes.map(node => this.nodeToPhase(node, graph.edges));

    return {
      id: `pipeline_${Date.now()}`,
      name,
      phases,
    };
  }

  /**
   * Converts a PipelineDefinition back into a VisualGraph for editing.
   */
  decompile(pipeline: PipelineDefinition): VisualGraph {
    const nodes: VisualNode[] = pipeline.phases.map((phase, i) => ({
      id: phase.id,
      type: this.phaseTypeToNodeType(phase),
      label: phase.id,
      position: { x: 200, y: 100 + i * 150 },
      config: {
        prompt: phase.prompt,
      },
    }));

    const edges: VisualEdge[] = [];
    for (const phase of pipeline.phases) {
      for (const dep of phase.dependsOn) {
        edges.push({
          id: `${dep}->${phase.id}`,
          source: dep,
          target: phase.id,
        });
      }
    }

    return { nodes, edges };
  }

  private nodeToPhase(node: VisualNode, edges: VisualEdge[]): PhaseDefinition {
    const incomingEdges = edges.filter(e => e.target === node.id);
    const dependsOn = incomingEdges.map(e => e.source);

    const base: PhaseDefinition = {
      id: node.id,
      type: node.type === 'human-review' ? 'gate' : 'agent',
      dependsOn,
    };

    if (node.config.prompt) base.prompt = node.config.prompt;
    if (node.type === 'human-review') {
      base.gateType = 'human_approval';
      base.gateMessage = node.config.reviewMessage;
    }

    return base;
  }

  private phaseTypeToNodeType(phase: PhaseDefinition): VisualNode['type'] {
    if (phase.type === 'gate') return 'human-review';
    if (phase.type === 'fanout') return 'loop';
    return 'ai-task';
  }
}
