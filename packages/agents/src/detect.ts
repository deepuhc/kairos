import { exec as execCb } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execCb);

export interface DetectedTool {
  name: string;
  command: string;
  args: string[];
  adapter: 'cli' | 'ollama-http';
  description: string;
}

const KNOWN_TOOLS: Array<{ name: string; command: string; args: string[]; adapter: 'cli' | 'ollama-http'; description: string }> = [
  { name: 'Ollama', command: 'ollama', args: ['run'], adapter: 'ollama-http', description: 'Local LLM inference via Ollama' },
  { name: 'Claude Code', command: 'claude', args: ['-p', '--output-format', 'stream-json', '--verbose'], adapter: 'cli', description: 'Anthropic Claude Code CLI' },
  { name: 'Goose', command: 'goose', args: ['session'], adapter: 'cli', description: 'Block Goose agent with MCP' },
  { name: 'Open Interpreter', command: 'interpreter', args: [], adapter: 'cli', description: 'Open Interpreter CLI' },
  { name: 'aichat', command: 'aichat', args: [], adapter: 'cli', description: 'AIChat multi-provider CLI' },
];

export async function detectTools(): Promise<DetectedTool[]> {
  const results = await Promise.all(
    KNOWN_TOOLS.map(async (tool) => {
      const available = await commandExists(tool.command);
      return available ? tool : null;
    })
  );
  return results.filter((t): t is DetectedTool => t !== null);
}

async function commandExists(cmd: string): Promise<boolean> {
  try {
    await exec(`which ${cmd}`);
    return true;
  } catch {
    return false;
  }
}
