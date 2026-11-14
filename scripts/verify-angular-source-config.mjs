/**
 * Read-only pre-build guard for reviewed Angular sources and staging roots.
 * An output-only verifier cannot prevent arbitrary inputs running during ng build.
 * Changes to this allowlist require a security/build review.
 */
import { lstatSync, readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MAX_CONFIG_BYTES = 64 * 1024;

// Exact, intentionally small Angular builder surface. Do not permit unreviewed
// scripts, styles, file replacements, network fonts or asset staging folders.
const REVIEWED_CONFIG = {
  $schema: './node_modules/@angular/cli/lib/config/schema.json',
  version: 1,
  projects: {
    desktop: {
      projectType: 'application',
      root: '',
      sourceRoot: 'src',
      architect: {
        build: {
          builder: '@angular-devkit/build-angular:application',
          options: {
            browser: 'src/main.ts',
            index: 'src/index.html',
            styles: ['src/styles.css'],
            tsConfig: 'tsconfig.app.json',
            outputPath: 'dist/desktop',
            assets: [{ glob: '**/*', input: '.local/frontend/assets', output: 'assets' }],
            optimization: {
              scripts: true,
              styles: { minify: true, inlineCritical: false },
              fonts: false,
            },
            subresourceIntegrity: false,
          },
          configurations: {
            'private-artwork': {
              assets: [{ glob: '**/*', input: '.local/frontend-private/assets', output: 'assets' }],
              fileReplacements: [{
                replace: 'src/app/asset-mode.ts',
                with: 'src/app/asset-mode.private.ts',
              }],
            },
          },
        },
        serve: {
          builder: '@angular-devkit/build-angular:dev-server',
          options: { buildTarget: 'desktop:build' },
        },
      },
    },
  },
};

/** Reject any unreviewed Angular configuration key or altered staged input. */
export function verifyAngularSourceConfig(config) {
  if (!isDeepStrictEqual(config, REVIEWED_CONFIG)) {
    throw new Error('ANGULAR SOURCE CONFIG: unreviewed build configuration');
  }
  return Object.freeze({ project: 'desktop', buildModes: 2 });
}

/** Inspect only this checkout's config, never following a symlink or logging its path. */
export function verifyAngularSourceConfigCheckout(root = ROOT) {
  const filename = join(root, 'angular.json');
  const stat = lstatSync(filename);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_CONFIG_BYTES) {
    throw new Error('ANGULAR SOURCE CONFIG: unsafe configuration file');
  }
  const bytes = readFileSync(filename);
  if (bytes.length > MAX_CONFIG_BYTES) {
    throw new Error('ANGULAR SOURCE CONFIG: oversized configuration file');
  }
  const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  return verifyAngularSourceConfig(JSON.parse(source));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 2) throw new Error('Unexpected CLI arguments');
    verifyAngularSourceConfigCheckout();
    console.log('Angular source configuration: reviewed synthetic/private build inputs verified.');
  } catch {
    // Never echo a user-supplied path, malicious config value or parse error.
    console.error('ANGULAR SOURCE CONFIG: verification failed; review angular.json.');
    process.exitCode = 1;
  }
}
