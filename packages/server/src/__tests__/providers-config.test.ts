import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parseProvidersConfig,
  loadProvidersConfig,
  providersConfigPath,
} from '../config/providers-config.js';

const tmpDirs: string[] = [];

function writeConfig(contents: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'kairos-cfg-'));
  tmpDirs.push(dir);
  const path = join(dir, 'providers.json');
  writeFileSync(path, contents, 'utf-8');
  return path;
}

afterEach(() => {
  while (tmpDirs.length) rmSync(tmpDirs.pop()!, { recursive: true, force: true });
});

describe('providersConfigPath', () => {
  it('defaults to ~/.kairos/providers.json', () => {
    expect(providersConfigPath({} as NodeJS.ProcessEnv)).toMatch(/\.kairos[/\\]providers\.json$/);
  });

  it('honours KAIROS_CONFIG_DIR', () => {
    const path = providersConfigPath({ KAIROS_CONFIG_DIR: '/custom/dir' } as NodeJS.ProcessEnv);
    expect(path).toBe(join('/custom/dir', 'providers.json'));
  });
});

describe('parseProvidersConfig', () => {
  it('maps a remote Ollama baseUrl', () => {
    const { config } = parseProvidersConfig({ ollama: { baseUrl: 'http://100.80.191.11:11434' } });
    expect(config.ollama).toEqual({ baseUrl: 'http://100.80.191.11:11434' });
  });

  it('strips a trailing slash so request URLs never double up', () => {
    const { config } = parseProvidersConfig({ ollama: { baseUrl: 'http://host:11434/' } });
    expect(config.ollama?.baseUrl).toBe('http://host:11434');
  });

  it('parses a full custom entry', () => {
    const { config, warnings } = parseProvidersConfig({
      custom: [
        {
          name: 'homelab',
          baseUrl: 'http://100.80.191.11:11434',
          type: 'ollama',
          isLocal: true,
          defaultModel: 'qwen2.5:14b',
        },
      ],
    });
    expect(warnings).toEqual([]);
    expect(config.custom).toHaveLength(1);
    expect(config.custom?.[0]).toMatchObject({
      name: 'homelab',
      type: 'ollama',
      defaultModel: 'qwen2.5:14b',
      isLocal: true,
    });
  });

  it('defaults isLocal to true for custom endpoints', () => {
    const { config } = parseProvidersConfig({
      custom: [{ name: 'h', baseUrl: 'http://h:11434', type: 'ollama' }],
    });
    expect(config.custom?.[0].isLocal).toBe(true);
  });

  it('carries bearer auth through', () => {
    const { config } = parseProvidersConfig({
      custom: [
        {
          name: 'webui',
          baseUrl: 'http://h:8080',
          type: 'open-webui',
          auth: { type: 'bearer', token: 'tok' },
        },
      ],
    });
    expect(config.custom?.[0].auth).toEqual({ type: 'bearer', token: 'tok' });
  });

  it('drops incomplete auth but keeps the endpoint', () => {
    const { config, warnings } = parseProvidersConfig({
      custom: [{ name: 'webui', baseUrl: 'http://h:8080', type: 'ollama', auth: { type: 'bearer' } }],
    });
    expect(config.custom?.[0].auth).toBeUndefined();
    expect(warnings.join()).toMatch(/incomplete "auth"/);
  });

  it('rejects an unknown custom type', () => {
    const { config, warnings } = parseProvidersConfig({
      custom: [{ name: 'x', baseUrl: 'http://h', type: 'telepathy' }],
    });
    expect(config.custom).toBeUndefined();
    expect(warnings.join()).toMatch(/"type" must be one of/);
  });

  it('skips a bad entry but keeps the good ones', () => {
    const { config, warnings } = parseProvidersConfig({
      custom: [
        { name: 'good', baseUrl: 'http://h:11434', type: 'ollama' },
        { baseUrl: 'http://h:8080', type: 'ollama' },
      ],
    });
    expect(config.custom).toHaveLength(1);
    expect(config.custom?.[0].name).toBe('good');
    expect(warnings.join()).toMatch(/missing "name"/);
  });

  it('warns when custom is not an array', () => {
    const { warnings } = parseProvidersConfig({ custom: { name: 'x' } });
    expect(warnings.join()).toMatch(/must be an array/);
  });

  it('ignores a non-object top level', () => {
    expect(parseProvidersConfig(['nope']).loaded).toBe(false);
    expect(parseProvidersConfig(null).config).toEqual({});
  });

  it('omits cloud sections that carry no values', () => {
    const { config } = parseProvidersConfig({ anthropic: {}, openai: { apiKey: '  ' } });
    expect(config.anthropic).toBeUndefined();
    expect(config.openai).toBeUndefined();
  });
});

describe('loadProvidersConfig', () => {
  it('returns an empty config when the file is absent', () => {
    const result = loadProvidersConfig('/nonexistent/kairos/providers.json');
    expect(result).toEqual({ config: {}, warnings: [], loaded: false });
  });

  it('reads a real file', () => {
    const path = writeConfig(JSON.stringify({ ollama: { baseUrl: 'http://box:11434' } }));
    const result = loadProvidersConfig(path);
    expect(result.loaded).toBe(true);
    expect(result.config.ollama?.baseUrl).toBe('http://box:11434');
  });

  it('degrades to defaults on malformed JSON instead of throwing', () => {
    const path = writeConfig('{ not json ');
    const result = loadProvidersConfig(path);
    expect(result.loaded).toBe(false);
    expect(result.config).toEqual({});
    expect(result.warnings.join()).toMatch(/invalid JSON/);
  });

  it('prefixes warnings with the config path', () => {
    const path = writeConfig(JSON.stringify({ custom: 'bad' }));
    expect(loadProvidersConfig(path).warnings[0]).toContain(path);
  });
});
