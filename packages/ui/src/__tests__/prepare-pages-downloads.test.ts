import { describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
// @ts-expect-error - plain ESM script without type declarations
import {
  collectDownloads,
  findVersionedWindowsInstaller,
  loadTestimonials,
  normalizeTestimonials,
  renderPage,
} from '../../scripts/prepare-pages-downloads.mjs';

function createTempRepo() {
  const root = mkdtempSync(path.join(tmpdir(), 'kairos-downloads-'));
  mkdirSync(path.join(root, 'src-tauri'), { recursive: true });
  writeFileSync(
    path.join(root, 'src-tauri', 'tauri.conf.json'),
    JSON.stringify({ version: '0.1.6' }),
  );
  return root;
}

describe('preparePagesDownloads', () => {
  it('renders an OS selector with direct signed artifact downloads', () => {
    const html = renderPage(
      [
        {
          id: 'macos',
          format: 'App archive',
          fileName: 'Kairos.app.tar.gz',
          href: 'downloads/macos/Kairos.app.tar.gz',
          signatureHref: 'downloads/macos/Kairos.app.tar.gz.sig',
          size: '18 MB',
        },
        {
          id: 'windows',
          format: 'NSIS installer',
          fileName: 'Kairos_0.1.6_x64-setup.exe',
          href: 'downloads/windows/Kairos_0.1.6_x64-setup.exe',
          signatureHref: 'downloads/windows/Kairos_0.1.6_x64-setup.exe.sig',
          stableHref: 'downloads/windows/Kairos-setup.exe',
          size: '12 MB',
        },
        {
          id: 'linux-appimage',
          format: 'AppImage',
          fileName: 'Kairos_0.1.6_amd64.AppImage',
          href: 'downloads/linux-appimage/Kairos_0.1.6_amd64.AppImage',
          signatureHref: 'downloads/linux-appimage/Kairos_0.1.6_amd64.AppImage.sig',
          stableHref: 'downloads/linux-appimage/Kairos.AppImage',
          size: '95 MB',
        },
        {
          id: 'linux-deb',
          format: 'Debian package',
          fileName: 'Kairos_0.1.6_amd64.deb',
          href: 'downloads/linux-deb/Kairos_0.1.6_amd64.deb',
          signatureHref: 'downloads/linux-deb/Kairos_0.1.6_amd64.deb.sig',
          stableHref: 'downloads/linux-deb/Kairos.deb',
          size: '14 MB',
        },
      ],
      {
        version: '0.1.6',
        commit: 'abc123',
        ref: 'main',
        testimonials: [
          {
            username: 'alex',
            note: 'Kairos makes agent sessions feel reviewable instead of messy.',
            created_at: '2026-07-28T10:00:00Z',
          },
          {
            username: 'maya <script>',
            note: 'I use it every day for Claude, Codex, and Gemini & custom agents.',
            created_at: '2026-07-27T10:00:00Z',
          },
        ],
      },
    );

    // OS selector tabs, including Linux (previously dropped by renderPage).
    expect(html).toContain('data-os-target="macos"');
    expect(html).toContain('data-os-target="windows"');
    expect(html).toContain('data-os-target="linux"');
    expect(html).toContain('detectOs');

    expect(html).toContain('class="logo-svg"');
    expect(html).toContain('One desktop for every coding agent.');
    expect(html).toContain('Agent-agnostic desktop UI');
    expect(html).toContain('Source repo');
    expect(html).toContain('Kairos Mac desktop app screenshot');
    expect(html).toContain('class="screenshot-shell"');
    expect(html).toContain('src="mac.png"');
    // Section anchors + in-page nav links to them.
    expect(html).toContain('id="install"');
    expect(html).toContain('id="screenshot"');
    expect(html).toContain('id="why-kairos"');
    expect(html).toContain('id="wall-of-love"');
    expect(html).toContain('id="notes"');
    expect(html).toContain('class="top-link" href="#install"');
    expect(html).toContain('class="top-link" href="#why-kairos"');
    expect(html).toContain('class="top-link" href="#wall-of-love"');

    // Single-sourced "Why Kairos" story rendered from docs/why-kairos.md.
    expect(html).toContain('class="story"');
    expect(html).toContain('class="story-shell"');
    expect(html).toContain('How it&#39;s built');
    // Tech points render as titled card items (strong title + blurb).
    expect(html).toContain('<strong>Rust backend.</strong>');
    expect(html).toContain('<strong>Agent Client Protocol (ACP).</strong>');
    expect(html).toContain('<strong>Agentic Desktop layouts.</strong>');
    expect(html).toContain('Wall of love');
    expect(html).toContain('People are moving their agent work into Kairos.');
    expect(html).toContain('class="proof-shell"');
    expect(html).toContain('class="quote-wall"');
    expect(html).toContain('column-count: 3;');
    // Avatars use initials+gradient only (no external photo service).
    expect(html).toContain('onerror="this.classList.add(\'broken\')"');
    expect(html).toContain('Kairos makes agent sessions feel reviewable instead of messy.');
    expect(html).toContain('maya &lt;script&gt;');
    expect(html).toContain('Gemini &amp; custom agents.');
    expect(html).toContain('Bring your agent');
    expect(html).toContain('Pick your OS and download the signed artifact.');
    expect(html).toContain('class="download-btn"');
    expect(html).toContain('class="artifact-copy"');
    expect(html).toContain('.artifact-card { display: grid; gap: 14px;');
    expect(html).toContain('class="install-body"');
    expect(html).toContain('.artifact-actions { display: flex; align-items: center; justify-content: flex-start;');
    expect(html).toContain('white-space: nowrap;');
    expect(html).toContain('Download macOS app');
    expect(html).toContain('After downloading');
    expect(html).toContain('Double-click the downloaded archive to extract Kairos.app.');
    expect(html).toContain('Drag Kairos.app into the Applications folder.');
    expect(html).toContain('Launch Kairos from Applications, not Downloads.');
    expect(html).toContain('App Translocation');
    expect(html).toContain('Download Windows installer');
    expect(html).toContain('Download Linux AppImage');
    expect(html).toContain('Download Debian package');
    expect(html).toContain('href="downloads/windows/Kairos_0.1.6_x64-setup.exe"');
    expect(html).toContain('href="downloads/windows/Kairos_0.1.6_x64-setup.exe.sig"');
    expect(html).toContain('href="downloads/linux-appimage/Kairos_0.1.6_amd64.AppImage"');
    expect(html).toContain('href="downloads/linux-deb/Kairos_0.1.6_amd64.deb"');
    expect(html).toContain('signed artifact');
    expect(html).toContain('· <a class="signature-link"');
    expect(html).toContain('>signature</a>');
    expect(html).toContain('glibc 2.35+');
    expect(html).toContain('Debian 11 is too old');
    expect(html).toContain('notarization is not enabled yet');
    expect(html).toContain('background: var(--surface); box-shadow: var(--shadow);');
    expect(html).not.toContain('background: rgba(255,255,255,.82)');
    expect(html).not.toContain('class="mac-frame"');
    expect(html).not.toContain('shot-nav');
    expect(html).not.toContain('Download desktop app');
    expect(html).not.toContain('View release manifest');
    expect(html).not.toContain('One desktop workspace for agent sessions');
    expect(html).not.toContain('background: #020408');
    expect(html).not.toContain('aspect-ratio: 2178 / 1532');

    // No command-first workaround UI remains.
    expect(html).not.toContain('data-copy-command');
    expect(html).not.toContain('navigator.clipboard.writeText(command)');
    expect(html).not.toContain('Copy command');
    expect(html).not.toContain('curl -fL');
    expect(html).not.toContain('Invoke-WebRequest');
    expect(html).not.toContain('Unblock-File');
    expect(html).not.toContain('Kairos.AppImage \\\\');

    // Uses the product's self-hosted fonts, not the old serif fallback stack.
    expect(html).toContain('fonts/InterVariable.woff2');
    expect(html).not.toContain('Avenir Next');
    expect(html).not.toContain('Desktop for devai');
    expect(html).not.toContain('Internal build');
    expect(html).not.toContain('Or download directly');
  });

  it('omits the testimonial rail when no testimonials are available', () => {
    const html = renderPage(
      [{
        id: 'macos',
        format: 'App archive',
        fileName: 'Kairos.app.tar.gz',
        href: 'downloads/macos/Kairos.app.tar.gz',
        signatureHref: 'downloads/macos/Kairos.app.tar.gz.sig',
        size: '18 MB',
      }],
      { version: '0.1.6' },
    );

    expect(html).not.toContain('Wall of love');
    expect(html).not.toContain('class="quote-wall"');
    // The testimonials nav link is dropped with the section; other anchors stay.
    expect(html).not.toContain('href="#wall-of-love"');
    expect(html).toContain('class="top-link" href="#why-kairos"');
  });

  it('normalizes testimonial payloads for the landing page', () => {
    const testimonials = normalizeTestimonials({
      testimonials: [
        { username: ' rajat ', note: ' useful ', created_at: '2026-07-28T10:00:00Z' },
        { username: '', note: 'missing author' },
        { username: 'anon', note: '   ' },
      ],
    });

    expect(testimonials).toEqual([
      { username: 'rajat', note: 'useful', created_at: '2026-07-28T10:00:00Z' },
    ]);
  });

  it('keeps all testimonials for the landing page wall', () => {
    const testimonials = normalizeTestimonials(Array.from({ length: 14 }, (_, index) => ({
      username: `user${index}`,
      note: `note ${index}`,
    })));

    expect(testimonials).toHaveLength(14);
  });

  it('loads testimonials from a deploy snapshot file', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'kairos-testimonials-'));
    try {
      const snapshot = path.join(root, 'testimonials.json');
      writeFileSync(
        snapshot,
        JSON.stringify({
          testimonials: [
            { username: ' rajat ', note: ' useful ', created_at: '2026-07-28T10:00:00Z' },
            { username: '', note: 'missing author' },
          ],
        }),
      );

      const result = await loadTestimonials({ filePath: snapshot, requireTestimonials: true });

      expect(result).toEqual({
        source: snapshot,
        testimonials: [
          { username: 'rajat', note: 'useful', created_at: '2026-07-28T10:00:00Z' },
        ],
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('carries forward testimonials from the previous Pages manifest', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'kairos-testimonials-carry-'));
    try {
      mkdirSync(path.join(root, 'downloads'), { recursive: true });
      writeFileSync(
        path.join(root, 'downloads', 'latest.json'),
        JSON.stringify({
          testimonials: [
            { username: 'maya', note: 'Kairos keeps my agents organized.' },
          ],
        }),
      );

      const result = await loadTestimonials({
        filePath: path.join(root, 'missing.json'),
        carryForwardRoot: root,
        requireTestimonials: true,
      });

      expect(result).toEqual({
        source: 'carry-forward',
        testimonials: [
          { username: 'maya', note: 'Kairos keeps my agents organized.', created_at: null },
        ],
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('does not carry forward over an explicit empty testimonials snapshot in strict mode', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'kairos-testimonials-empty-'));
    try {
      const snapshot = path.join(root, 'testimonials.json');
      writeFileSync(snapshot, JSON.stringify({ testimonials: [] }));
      mkdirSync(path.join(root, 'downloads'), { recursive: true });
      writeFileSync(
        path.join(root, 'downloads', 'latest.json'),
        JSON.stringify({
          testimonials: [
            { username: 'maya', note: 'Previous deploy.' },
          ],
        }),
      );

      await expect(loadTestimonials({
        filePath: snapshot,
        carryForwardRoot: root,
        requireTestimonials: true,
      })).rejects.toThrow('No testimonials found');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('omits the Linux tab entirely when no Linux artifacts are present', () => {
    const html = renderPage(
      [{
        id: 'macos',
        format: 'App archive',
        fileName: 'Kairos.app.tar.gz',
        href: 'downloads/macos/Kairos.app.tar.gz',
        signatureHref: 'downloads/macos/Kairos.app.tar.gz.sig',
        size: '18 MB',
      }],
      { version: '0.1.6' },
    );

    expect(html).toContain('data-os-target="macos"');
    expect(html).not.toContain('data-os-target="linux"');
    expect(html).not.toContain('data-os-target="windows"');
  });

  it('collects macOS and Windows downloads even when Linux artifacts are missing', () => {
    const root = createTempRepo();
    try {
      const downloadsRoot = path.join(root, 'public', 'downloads');
      const targetDir = path.join(root, 'src-tauri', 'target');

      const windowsInstaller = path.join(
        targetDir,
        'release',
        'bundle',
        'nsis',
        'Kairos_0.1.6_x64-setup.exe',
      );
      mkdirSync(path.dirname(windowsInstaller), { recursive: true });
      writeFileSync(windowsInstaller, 'windows');
      writeFileSync(`${windowsInstaller}.sig`, 'windows-signature\n');

      const macArchive = path.join(
        targetDir,
        'release',
        'bundle',
        'macos',
        'Kairos.app.tar.gz',
      );
      mkdirSync(path.dirname(macArchive), { recursive: true });
      writeFileSync(macArchive, 'mac');
      writeFileSync(`${macArchive}.sig`, 'mac-signature\n');

      const downloads = collectDownloads({
        root,
        version: '0.1.6',
        targetDir,
        downloadsRoot,
      });

      expect(downloads.map((download) => download.id)).toEqual(['windows', 'macos']);
      expect(downloadsRoot).toContain('downloads');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('keeps library collection defaults independent from CI Windows target env', () => {
    const previousTarget = process.env.KAIROS_WINDOWS_RUST_TARGET;
    process.env.KAIROS_WINDOWS_RUST_TARGET = 'x86_64-pc-windows-gnullvm';
    const root = createTempRepo();
    try {
      const downloadsRoot = path.join(root, 'public', 'downloads');
      const targetDir = path.join(root, 'src-tauri', 'target');

      const windowsInstaller = path.join(
        targetDir,
        'release',
        'bundle',
        'nsis',
        'Kairos_0.1.6_x64-setup.exe',
      );
      mkdirSync(path.dirname(windowsInstaller), { recursive: true });
      writeFileSync(windowsInstaller, 'windows');
      writeFileSync(`${windowsInstaller}.sig`, 'windows-signature\n');

      const macArchive = path.join(
        targetDir,
        'release',
        'bundle',
        'macos',
        'Kairos.app.tar.gz',
      );
      mkdirSync(path.dirname(macArchive), { recursive: true });
      writeFileSync(macArchive, 'mac');
      writeFileSync(`${macArchive}.sig`, 'mac-signature\n');

      const downloads = collectDownloads({
        root,
        version: '0.1.6',
        targetDir,
        downloadsRoot,
      });

      expect(downloads.map((download) => download.id)).toEqual(['windows', 'macos']);
    } finally {
      if (previousTarget === undefined) {
        delete process.env.KAIROS_WINDOWS_RUST_TARGET;
      } else {
        process.env.KAIROS_WINDOWS_RUST_TARGET = previousTarget;
      }
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('carries forward previous Linux downloads when the current Linux artifacts are missing', () => {
    const root = createTempRepo();
    const carryForwardRoot = mkdtempSync(path.join(tmpdir(), 'kairos-downloads-carry-'));
    try {
      const downloadsRoot = path.join(root, 'public', 'downloads');
      const targetDir = path.join(root, 'src-tauri', 'target');

      const windowsInstaller = path.join(
        targetDir,
        'release',
        'bundle',
        'nsis',
        'Kairos_0.1.6_x64-setup.exe',
      );
      mkdirSync(path.dirname(windowsInstaller), { recursive: true });
      writeFileSync(windowsInstaller, 'windows');
      writeFileSync(`${windowsInstaller}.sig`, 'windows-signature\n');

      const macArchive = path.join(
        targetDir,
        'release',
        'bundle',
        'macos',
        'Kairos.app.tar.gz',
      );
      mkdirSync(path.dirname(macArchive), { recursive: true });
      writeFileSync(macArchive, 'mac');
      writeFileSync(`${macArchive}.sig`, 'mac-signature\n');

      mkdirSync(path.join(carryForwardRoot, 'downloads', 'linux-appimage'), { recursive: true });
      mkdirSync(path.join(carryForwardRoot, 'downloads', 'linux-deb'), { recursive: true });
      writeFileSync(
        path.join(carryForwardRoot, 'downloads', 'latest.json'),
        JSON.stringify({
          downloads: [
            {
              id: 'linux-appimage',
              os: 'Linux',
              format: 'AppImage',
              fileName: 'Kairos_0.1.5_amd64.AppImage',
              href: 'downloads/linux-appimage/Kairos_0.1.5_amd64.AppImage',
              signatureHref: 'downloads/linux-appimage/Kairos_0.1.5_amd64.AppImage.sig',
              stableHref: 'downloads/linux-appimage/Kairos.AppImage',
              stableSignatureHref: 'downloads/linux-appimage/Kairos.AppImage.sig',
              size: '95 MB',
            },
            {
              id: 'linux-deb',
              os: 'Linux',
              format: 'Debian package',
              fileName: 'Kairos_0.1.5_amd64.deb',
              href: 'downloads/linux-deb/Kairos_0.1.5_amd64.deb',
              signatureHref: 'downloads/linux-deb/Kairos_0.1.5_amd64.deb.sig',
              stableHref: 'downloads/linux-deb/Kairos.deb',
              stableSignatureHref: 'downloads/linux-deb/Kairos.deb.sig',
              size: '14 MB',
            },
          ],
        }),
      );
      writeFileSync(
        path.join(carryForwardRoot, 'downloads', 'linux-appimage', 'Kairos_0.1.5_amd64.AppImage'),
        'old-appimage',
      );
      writeFileSync(
        path.join(carryForwardRoot, 'downloads', 'linux-appimage', 'Kairos_0.1.5_amd64.AppImage.sig'),
        'old-appimage-signature\n',
      );
      writeFileSync(
        path.join(carryForwardRoot, 'downloads', 'linux-appimage', 'Kairos.AppImage'),
        'old-appimage',
      );
      writeFileSync(
        path.join(carryForwardRoot, 'downloads', 'linux-appimage', 'Kairos.AppImage.sig'),
        'old-appimage-signature\n',
      );
      writeFileSync(
        path.join(carryForwardRoot, 'downloads', 'linux-deb', 'Kairos_0.1.5_amd64.deb'),
        'old-deb',
      );
      writeFileSync(
        path.join(carryForwardRoot, 'downloads', 'linux-deb', 'Kairos_0.1.5_amd64.deb.sig'),
        'old-deb-signature\n',
      );
      writeFileSync(
        path.join(carryForwardRoot, 'downloads', 'linux-deb', 'Kairos.deb'),
        'old-deb',
      );
      writeFileSync(
        path.join(carryForwardRoot, 'downloads', 'linux-deb', 'Kairos.deb.sig'),
        'old-deb-signature\n',
      );

      const downloads = collectDownloads({
        root,
        version: '0.1.6',
        targetDir,
        downloadsRoot,
        carryForwardRoot,
      });

      expect(downloads.map((download) => download.id)).toEqual([
        'windows',
        'macos',
        'linux-appimage',
        'linux-deb',
      ]);
      expect(existsSync(path.join(downloadsRoot, 'linux-appimage', 'Kairos_0.1.5_amd64.AppImage'))).toBe(true);
      expect(existsSync(path.join(downloadsRoot, 'linux-deb', 'Kairos_0.1.5_amd64.deb'))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(carryForwardRoot, { recursive: true, force: true });
    }
  });

  it('prefers target-specific Windows installers over stale generic bundle output', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'kairos-downloads-'));
    try {
      const targetDir = path.join(root, 'target');
      const genericInstaller = path.join(
        targetDir,
        'release',
        'bundle',
        'nsis',
        'Kairos_0.1.6_x64-setup.exe',
      );
      const targetInstaller = path.join(
        targetDir,
        'x86_64-pc-windows-gnullvm',
        'release',
        'bundle',
        'nsis',
        'Kairos_0.1.6_x64-setup.exe',
      );
      mkdirSync(path.dirname(genericInstaller), { recursive: true });
      mkdirSync(path.dirname(targetInstaller), { recursive: true });
      writeFileSync(genericInstaller, 'stale');
      writeFileSync(targetInstaller, 'current');

      expect(
        findVersionedWindowsInstaller(targetDir, '0.1.6', 'x86_64-pc-windows-gnullvm'),
      ).toBe(targetInstaller);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('does not fall back to generic Windows output when a CI target is declared', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'kairos-downloads-'));
    try {
      const targetDir = path.join(root, 'target');
      const genericInstaller = path.join(
        targetDir,
        'release',
        'bundle',
        'nsis',
        'Kairos_0.1.6_x64-setup.exe',
      );
      mkdirSync(path.dirname(genericInstaller), { recursive: true });
      writeFileSync(genericInstaller, 'stale');

      expect(() =>
        findVersionedWindowsInstaller(targetDir, '0.1.6', 'x86_64-pc-windows-gnullvm'),
      ).toThrow('x86_64-pc-windows-gnullvm');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
