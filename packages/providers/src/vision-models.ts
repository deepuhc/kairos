/**
 * Name-based vision detection for endpoints that expose no capability metadata.
 *
 * Ollama's `/api/tags` and most OpenAI-compatible `/models` responses report
 * only an id, so multimodal support has to be inferred from the model name.
 * Beyond the obvious `llava` / `*-vision` tags, several families carry no such
 * marker (`qwen2.5vl`, `gemma3`, `minicpm-v`, `moondream`, `pixtral`) and would
 * otherwise be invisible to a `requireCapability: 'vision'` route — which would
 * silently route an image at a text-only model.
 *
 * Shared by OllamaProvider and CustomHttpProvider so a model is classified the
 * same way whether it is reached directly or through a custom endpoint.
 *
 * Markers are deliberately conservative: a false positive sends an image to a
 * blind model, which fails at request time, so prefer missing an exotic model
 * over mis-tagging a text-only one.
 */

/** Open-weight multimodal families, as served by Ollama / vLLM / LM Studio. */
export const LOCAL_VISION_MARKERS: readonly string[] = [
  'llava',
  'bakllava',
  'vision',
  'minicpm-v',
  'moondream',
  'gemma3',
  'llama4',
  'pixtral',
  'internvl',
  'glm-4v',
  'granite3.2-vision',
];

/**
 * The Qwen-VL family, whose tags vary: `qwen2-vl`, `qwen2.5vl`, `qwen-vl`.
 * Boundary-anchored so `vl` inside an unrelated word cannot match.
 */
const VL_FAMILY = /(^|[-_.\d])vl([-_.:]|$)/;

/** Hosted models that accept images — only meaningful for cloud-facing endpoints. */
export const HOSTED_VISION_MARKERS: readonly string[] = [
  'gpt-4o',
  '4o-mini',
  'gpt-4.1',
  'gpt-5',
  'claude',
  'gemini',
  'pixtral',
];

/**
 * True when a model id looks like a locally-served vision-capable model.
 * Use `includeHosted` for endpoints that may proxy cloud models (e.g. an
 * OpenAI-compatible gateway or Open WebUI in front of mixed backends).
 */
export function looksLikeVisionModel(modelId: string, includeHosted = false): boolean {
  const lower = modelId.toLowerCase();
  const markers = includeHosted
    ? [...LOCAL_VISION_MARKERS, ...HOSTED_VISION_MARKERS]
    : LOCAL_VISION_MARKERS;
  return markers.some((marker) => lower.includes(marker)) || VL_FAMILY.test(lower);
}
