import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Message, StreamChunk } from '@kairos/providers';
import { RunManager, type OrchestratorEventSink } from '../run-manager.js';
import { getAgentRole, DEFAULT_PIPELINE_ROLES, type AgentRoleId } from '@kairos/personas';

// A fake router: yields the text chunks for whichever role's prompt it sees, so
// each persona "produces" a valid artifact without any real provider. We infer
// the role from the artifact path named in the user prompt.
function fakeRouter(reply: (roleId: AgentRoleId) => string) {
  return {
    async *streamChunks(messages: Message[]): AsyncIterable<StreamChunk> {
      const user = messages.find((m) => m.role === 'user');
      const text = typeof user?.content === 'string' ? user.content : '';
      // Match the TARGET artifact (named in "write it to <path>"), not an upstream
      // path that also appears in the prompt body.
      const role = DEFAULT_PIPELINE_ROLES.find((id) =>
        text.includes(`write it to ${getAgentRole(id)!.artifact.path}`),
      );
      yield { type: 'text', text: reply(role ?? 'product-marketing') };
      yield { type: 'usage', inputTokens: 10, outputTokens: 20 };
    },
  } as unknown as import('@kairos/providers').SmartRouter;
}

function collectingSink(): OrchestratorEventSink & { events: Array<{ event: string; data: unknown }> } {
  const events: Array<{ event: string; data: unknown }> = [];
  return { events, publish: (event, data) => { events.push({ event, data }); } };
}

function validBody(roleId: AgentRoleId): string {
  const role = getAgentRole(roleId)!;
  const sections = (role.artifact.requiredSections ?? []).join(' and ');
  return `# ${role.name}\n\n${sections}\n\n${'x'.repeat(role.artifact.minBytes)}`;
}

describe('RunManager', () => {
  let home: string;
  let project: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'kairos-rm-'));
    project = await mkdtemp(join(tmpdir(), 'kairos-rmp-'));
    process.env.KAIROS_HOME = home;
  });

  afterAll(() => {
    delete process.env.KAIROS_HOME;
  });

  it('runs the full pipeline, writing each artifact and publishing progress', async () => {
    const sink = collectingSink();
    const rm = new RunManager({ router: fakeRouter(validBody), events: sink });

    const final = await rm.start('build a todo app', project);
    expect(final.status).toBe('done');
    expect(rm.isRunning).toBe(false);

    // Each role's artifact was written to the project dir.
    const pm = await readFile(join(project, 'docs/market-research.md'), 'utf8');
    expect(pm).toContain('Product Marketing');

    // Progress streamed as orchestrator:update events.
    const updates = sink.events.filter((e) => e.event === 'orchestrator:update');
    expect(updates.length).toBeGreaterThan(0);
    expect(updates.at(-1)!.data).toMatchObject({ type: 'run:done' });
  });

  it('rejects a second concurrent run', async () => {
    const rm = new RunManager({ router: fakeRouter(validBody), events: collectingSink() });
    const first = rm.start('goal', project);
    await expect(rm.start('goal2', project)).rejects.toThrow(/already active/);
    await first;
  });

  it('blocks a phase whose artifact never validates', async () => {
    const sink = collectingSink();
    // product-marketing always emits a too-short body → gate fails → blocked.
    const rm = new RunManager({
      router: fakeRouter((id) => (id === 'product-marketing' ? 'x' : validBody(id))),
      events: sink,
    });
    const final = await rm.start('goal', project);
    expect(final.status).toBe('blocked');
    const pm = final.phases.find((p) => p.role === 'product-marketing')!;
    expect(pm.status).toBe('blocked');
  });
});
