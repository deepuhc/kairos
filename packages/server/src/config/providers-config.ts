import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { RegistryConfig, CustomHttpConfig } from '@kairos/providers';

// Loads provider endpoints from ~/.kairos/providers.json so a remote Ollama (or
// any OpenAI-compatible / Open WebUI endpoint) can be configured without
// hardcoding a host in source. A tailnet IP or LAN address is machine-specific
// and must not live in the repo.
//
// Resolution order, lowest precedence first:
//   1. Built-in defaults (Ollama at localhost:11434)
//   2. OLLAMA_HOST env var (handled inside OllamaProvider)
//   3. ~/.kairos/providers.json  (or $KAIROS_CONFIG_DIR/providers.json)
//
// The file is optional and best-effort: a missing, unreadable, or malformed file
// never prevents the server from starting — it degrades to the defaults.

/** Where the config file is expected to live. */
export function providersConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  const dir = env.KAIROS_CONFIG_DIR?.trim() || join(homedir(), '.kairos');
  return join(dir, 'providers.json');
}

export interface LoadResult {
  config: RegistryConfig;
  /** Human-readable notes about what was loaded or ignored, for startup logging. */
  warnings: string[];
  /** True when a config file was found and parsed. */
  loaded: boolean;
}

const CUSTOM_TYPES = new Set(['ollama', 'openai-compatible', 'open-webui']);
const AUTH_TYPES = new Set(['bearer', 'basic', 'api-key']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/**
 * Validate one `custom` entry. Returns null (with a warning) rather than
 * throwing, so one bad entry cannot take down the whole config.
 */
function parseCustomEntry(raw: unknown, index: number, warnings: string[]): CustomHttpConfig | null {
  const where = `custom[${index}]`;
  if (!isRecord(raw)) {
    warnings.push(`${where}: not an object — ignored`);
    return null;
  }

  const name = optionalString(raw.name);
  const baseUrl = optionalString(raw.baseUrl);
  const type = optionalString(raw.type);

  if (!name) {
    warnings.push(`${where}: missing "name" — ignored`);
    return null;
  }
  if (!baseUrl) {
    warnings.push(`${where} (${name}): missing "baseUrl" — ignored`);
    return null;
  }
  if (!type || !CUSTOM_TYPES.has(type)) {
    warnings.push(
      `${where} (${name}): "type" must be one of ${[...CUSTOM_TYPES].join(', ')} — ignored`,
    );
    return null;
  }

  const entry: CustomHttpConfig = {
    name,
    baseUrl: baseUrl.replace(/\/+$/, ''),
    type: type as CustomHttpConfig['type'],
    // Default to local: these endpoints are homelab/LAN by nature, and the flag
    // is a privacy-routing hint — assuming local keeps data off cloud providers.
    isLocal: typeof raw.isLocal === 'boolean' ? raw.isLocal : true,
  };

  const defaultModel = optionalString(raw.defaultModel);
  if (defaultModel) entry.defaultModel = defaultModel;

  if (isRecord(raw.auth)) {
    const authType = optionalString(raw.auth.type);
    const token = optionalString(raw.auth.token);
    if (authType && AUTH_TYPES.has(authType) && token) {
      entry.auth = { type: authType as 'bearer' | 'basic' | 'api-key', token };
    } else {
      warnings.push(`${where} (${name}): incomplete "auth" — ignored, sending no credentials`);
    }
  }

  return entry;
}

/**
 * Turn already-parsed JSON into a RegistryConfig. Pure — no filesystem access —
 * so it can be unit-tested directly.
 */
export function parseProvidersConfig(raw: unknown): LoadResult {
  const warnings: string[] = [];
  if (!isRecord(raw)) {
    return { config: {}, warnings: ['providers.json: top level is not an object — ignored'], loaded: false };
  }

  const config: RegistryConfig = {};

  const ollamaBaseUrl = isRecord(raw.ollama) ? optionalString(raw.ollama.baseUrl) : undefined;
  if (ollamaBaseUrl) config.ollama = { baseUrl: ollamaBaseUrl.replace(/\/+$/, '') };

  for (const key of ['anthropic', 'openai', 'gemini'] as const) {
    if (!isRecord(raw[key])) continue;
    const section = raw[key] as Record<string, unknown>;
    const apiKey = optionalString(section.apiKey);
    const baseUrl = optionalString(section.baseUrl);
    if (apiKey || baseUrl) {
      config[key] = { ...(apiKey && { apiKey }), ...(baseUrl && { baseUrl }) };
    }
  }

  if (raw.custom !== undefined) {
    if (!Array.isArray(raw.custom)) {
      warnings.push('providers.json: "custom" must be an array — ignored');
    } else {
      const entries = raw.custom
        .map((entry, i) => parseCustomEntry(entry, i, warnings))
        .filter((e): e is CustomHttpConfig => e !== null);
      if (entries.length > 0) config.custom = entries;
    }
  }

  return { config, warnings, loaded: true };
}

/**
 * Read and parse ~/.kairos/providers.json. Never throws: a missing file yields
 * an empty config, and a malformed one yields an empty config plus a warning.
 */
export function loadProvidersConfig(path = providersConfigPath()): LoadResult {
  let text: string;
  try {
    text = readFileSync(path, 'utf-8');
  } catch {
    // No config file is the normal case — stay silent.
    return { config: {}, warnings: [], loaded: false };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { config: {}, warnings: [`${path}: invalid JSON (${message}) — using defaults`], loaded: false };
  }

  const result = parseProvidersConfig(parsed);
  return { ...result, warnings: result.warnings.map((w) => `${path}: ${w}`.replace(`${path}: providers.json:`, `${path}:`)) };
}
