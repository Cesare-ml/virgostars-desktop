/** Test-only Node resolver for the extensionless TypeScript paths used by Angular. */
export async function resolve(specifier, context, nextResolve) {
  if (context.parentURL?.endsWith('.ts') && specifier.startsWith('.') &&
      !/\.(?:[cm]?ts|[cm]?js)$/.test(specifier)) {
    return nextResolve(specifier + '.ts', context);
  }
  return nextResolve(specifier, context);
}
