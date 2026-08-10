import generatedReleaseNotes from '../generated/release-notes.md?raw';

export const KAIROS_VERSION = typeof __KAIROS_VERSION__ === 'string' ? __KAIROS_VERSION__ : '0.0.0';

// Checked-in release history generated from git tags by
// scripts/ci/update-release-notes.mjs. Keeping this as source-controlled content
// makes the What's New panel independent of updater state and build-time git.
export const KAIROS_CHANGELOG = generatedReleaseNotes;
