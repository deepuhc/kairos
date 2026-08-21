import type { SmartRouter, Message, ImageContent } from '@kairos/providers';

// The four raster image MIME types the providers' ImageContent block accepts.
// SVG and other image/* types are intentionally excluded — they're not sent to
// vision models as raster data.
const VISION_MIME_TYPES: ReadonlySet<ImageContent['mimeType']> = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
]);

// Guard against sending an enormous image to a model: base64 inflates bytes ~4/3,
// so this cap corresponds to roughly a ~7.5 MB source image. Larger images are
// skipped (returns null) rather than risking a provider payload rejection.
const MAX_BASE64_LENGTH = 10 * 1024 * 1024;

const VISION_PROMPT =
  'Describe this image in detail. Note the main subject, setting, notable objects, ' +
  'colors, and any text. Transcribe any visible text verbatim. Be concise but thorough.';

/** True if this MIME type can be sent to a vision model as raster image data. */
export function isVisionMime(mime: string): mime is ImageContent['mimeType'] {
  return VISION_MIME_TYPES.has(mime as ImageContent['mimeType']);
}

/**
 * Run a base64 image through a vision-capable model and return its text
 * description, or `null` when the image can't/shouldn't be analyzed:
 *   - the MIME type isn't a supported raster type,
 *   - the base64 payload is empty or over the size cap,
 *   - no vision-capable model is configured/available, or
 *   - the provider call fails.
 *
 * Never throws — image extraction must still succeed (with its placeholder
 * content) even when vision is unavailable. Callers treat `null` as "no
 * enrichment" and keep the original extraction result.
 */
export async function describeImage(
  base64: string,
  mime: string,
  router: SmartRouter,
): Promise<string | null> {
  if (!isVisionMime(mime)) return null;
  if (!base64 || base64.length > MAX_BASE64_LENGTH) return null;

  let selection;
  try {
    selection = await router.selectModel({ requireCapability: 'vision' });
  } catch {
    return null;
  }
  if (!selection) return null;

  const messages: Message[] = [
    {
      role: 'user',
      content: [
        { type: 'text', text: VISION_PROMPT },
        { type: 'image', data: base64, mimeType: mime },
      ],
    },
  ];

  try {
    const result = await selection.provider.complete(messages, { model: selection.model.id });
    const text = result.content?.trim();
    return text ? text : null;
  } catch {
    return null;
  }
}
