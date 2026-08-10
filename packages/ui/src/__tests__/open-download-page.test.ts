import { describe, expect, it } from 'vitest';
// @ts-expect-error - plain ESM script without type declarations
import {
  DEFAULT_DOWNLOAD_URL,
  downloadUrl,
  openCommand,
} from '../../scripts/open-download-page.mjs';

describe('open download page', () => {
  it('defaults to the published downloads URL', () => {
    expect(downloadUrl({})).toBe(DEFAULT_DOWNLOAD_URL);
  });

  it('allows an explicit download URL override', () => {
    expect(downloadUrl({ KAIROS_DOWNLOAD_URL: 'https://example.test/kairos' })).toBe(
      'https://example.test/kairos',
    );
  });

  it('opens the URL with the platform-appropriate opener', () => {
    const url = 'https://example.test/kairos';
    expect(openCommand('darwin', url)).toEqual({ command: 'open', args: [url] });
    expect(openCommand('win32', url)).toEqual({ command: 'cmd', args: ['/c', 'start', '', url] });
    expect(openCommand('linux', url)).toEqual({ command: 'xdg-open', args: [url] });
  });
});
