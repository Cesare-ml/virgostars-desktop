// Cross-platform, pure macOS release rules. No network, filesystem writes or secrets.
export const REPO = 'Cesare-ml/virgostars-desktop';
export const PINNED = Object.freeze({
  'astrological-charts': 'd85cf7000be49c5fb2a1549f7f8d005a475b5be4',
  'astrological-functions': 'e9b87011178bd2f4ae6795c5d92480e3d659afd1',
  'astrological-assets': '03e5671fd45595f7560e1a779e8b92c66a9922c6'
});
export const DOWNLOADS = Object.freeze({
  cities: Object.freeze({
    url: 'https://github.com/Cesare-ml/virgostars-desktop/releases/download/places-20261112-v2/world-cities.zip',
    sha256: 'b27c5d268deca8a20c58e1ff3c9a3d275b11ab38471d8a78915965649b8a2b64',
    maxBytes: 70_000_000
  }),
  de441: Object.freeze({
    url: 'https://github.com/Cesare-ml/VirgoStars-Ephemeris/releases/download/de441-desktop-v1.0.0/de441-v2-desktop-core-1000-2200.eph',
    sha256: '72ee04b5ee048320ae3198f9f70d02e03aef2229260ade0bc2404efe7a744f32',
    bytes: 111_662_384
  }),
  catalog: Object.freeze({
    sha256: 'ad80ef75b5f3984947a6dc04d4de184c35701600ca587aff155d7228fd03667b'
  })
});
export function macTarget(arch) {
  if (arch === 'arm64') return 'aarch64-apple-darwin';
  if (arch === 'x64') return 'x86_64-apple-darwin';
  throw new Error('Only native Apple Silicon or Intel x64 Mac builds are supported');
}
export function parseBuildOptions(args) {
  if (args.some(x => x !== '--release' && x !== '--original') ||
      new Set(args).size !== args.length)
    throw new Error('Usage: node scripts/mac/build.mjs [--original] [--release]');
  return Object.freeze({original: args.includes('--original'), release: args.includes('--release')});
}
export function releaseCredentialsPresent(env) {
  return Boolean(env.APPLE_SIGNING_IDENTITY && env.APPLE_SIGNING_IDENTITY !== '-' &&
    env.APPLE_TEAM_ID && env.APPLE_ID && env.APPLE_PASSWORD);
}
export function validatedTag(tag, version) {
  if (!/^v[0-9]+\.[0-9]+\.[0-9]+$/.test(tag) || tag !== 'v' + version)
    throw new Error('The release tag must exactly match the packaged application version: v' + version);
  return tag;
}
export function verifyReport(report, expectedVersion, currentCommit) {
  if (!report || report.schema !== 'virgostars.macos.build/1' ||
      report.version !== expectedVersion || report.sourceCommit !== currentCommit ||
      report.platform !== 'darwin' || report.releaseEligible !== true ||
      report.signing !== 'apple-developer-notarized' ||
      !['arm64','x64'].includes(report.arch) ||
      !['synthetic','rights-cleared-original'].includes(report.artwork) ||
      !Array.isArray(report.artifacts) || report.artifacts.length !== 1 ||
      !/^VirgoStars-Desktop-[a-zA-Z0-9._-]+\.dmg$/.test(report.artifacts[0].file) ||
      !/^[a-f0-9]{64}$/.test(report.artifacts[0].sha256) ||
      !(report.artifacts[0].bytes > 0)) {
    throw new Error('No verified, notarized release report for the current source/version');
  }
  return report.artifacts[0];
}
