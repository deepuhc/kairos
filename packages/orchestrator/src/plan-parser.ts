import type { PipelineDefinition, PhaseDefinition, PhaseType, GateType } from './types.js';

export function parsePlan(markdown: string, name?: string): PipelineDefinition {
  const lines = markdown.split('\n');
  const phases: PhaseDefinition[] = [];
  let planName = name || 'Unnamed Plan';

  for (const line of lines) {
    const trimmed = line.trim();

    // Extract plan name from first heading
    if (trimmed.startsWith('# ') && !planName) {
      planName = trimmed.slice(2).trim();
      continue;
    }

    // Parse task lines: - [ ] id: description [depends: a, b] [role: X] [type: gate]
    const taskMatch = trimmed.match(/^-\s*\[[ x]?\]\s*(\w[\w-]*):\s*(.+)$/i);
    if (!taskMatch) continue;

    const id = taskMatch[1];
    let description = taskMatch[2];

    const annotations = extractAnnotations(description);
    description = annotations.cleanText;

    const dependsOn = annotations.depends
      ? annotations.depends.split(',').map((d) => d.trim()).filter(Boolean)
      : [];

    let type: PhaseType = 'agent';
    let gateType: GateType | undefined;
    let gateMessage: string | undefined;

    if (annotations.type === 'gate') {
      type = 'gate';
      gateType = (annotations.gateType as GateType) || 'human_approval';
      gateMessage = description;
    } else if (annotations.type === 'fanout') {
      type = 'fanout';
    }

    phases.push({
      id,
      type,
      dependsOn,
      role: annotations.role,
      prompt: description,
      gateType,
      gateMessage,
    });
  }

  return {
    id: `plan_${Date.now()}`,
    name: planName,
    phases,
  };
}

interface Annotations {
  depends?: string;
  role?: string;
  type?: string;
  gateType?: string;
  cleanText: string;
}

function extractAnnotations(text: string): Annotations {
  const annotations: Annotations = { cleanText: text };

  const bracketPattern = /\[(\w+):\s*([^\]]+)\]/g;
  let match;

  while ((match = bracketPattern.exec(text)) !== null) {
    const key = match[1].toLowerCase();
    const value = match[2].trim();

    switch (key) {
      case 'depends': annotations.depends = value; break;
      case 'role': annotations.role = value; break;
      case 'type': annotations.type = value; break;
      case 'gate': annotations.gateType = value; break;
    }
  }

  annotations.cleanText = text.replace(bracketPattern, '').trim();
  return annotations;
}
