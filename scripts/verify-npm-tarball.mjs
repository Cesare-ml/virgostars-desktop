/**
 * Validate that a pinned npm tarball URL actually identifies the locked package.
 * An official registry hostname alone does not prevent a package-name swap.
 *
 * This is a lockfile-structure check, not a network/download verification.
 */
const PACKAGE_NAME=/^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/;
const PACKAGE_VERSION=/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const DEPENDENCY_FIELDS=['dependencies','devDependencies','optionalDependencies','peerDependencies'];

function hasDeclaredAlias(packages, installedName, sourceName) {
  const prefix='npm:'+sourceName+'@';
  return Object.values(packages).some(record =>
    record !== null && typeof record === 'object' && !Array.isArray(record) &&
    DEPENDENCY_FIELDS.some(field => {
      const deps=record[field];
      const spec=deps && typeof deps === 'object' && !Array.isArray(deps)
        ? deps[installedName] : undefined;
      return typeof spec === 'string' && spec.startsWith(prefix) &&
        spec.length > prefix.length && !/\s/.test(spec);
    }));
}

/**
 * Reject mismatched package/version paths while retaining explicitly declared
 * npm aliases, including the three @isaacs/cliui cjs compatibility aliases.
 */
export function assertNpmTarballIdentity(lockPath, entry, packages, url) {
  const match=lockPath.match(/(?:^|\/)node_modules\/((?:@[^/]+\/)?[^/]+)$/);
  if (!match) throw new Error('Invalid npm installed package path');
  const installedName=match[1];
  const sourceName=entry.name ?? installedName;
  if (typeof sourceName !== 'string' || !PACKAGE_NAME.test(sourceName) ||
      !PACKAGE_NAME.test(installedName) ||
      typeof entry.version !== 'string' || !PACKAGE_VERSION.test(entry.version)) {
    throw new Error('Invalid npm tarball package identity');
  }
  if (sourceName !== installedName &&
      !hasDeclaredAlias(packages, installedName, sourceName)) {
    throw new Error('Undeclared npm package alias');
  }
  const basename=sourceName.split('/').at(-1);
  const expected='/'+sourceName+'/-/'+basename+'-'+entry.version+'.tgz';
  if (url.pathname !== expected) {
    throw new Error('npm tarball URL differs from locked package identity');
  }
}
