/**
 * Test-only resolution hook. Fake only the external chart renderer constructor:
 * the actual desktop fictional fixture and pure geometry are still executed.
 * This avoids requiring a built sibling renderer package for synthetic tests.
 */
const FIXTURE_SUFFIX = '/src/app/fictional-fixture.ts';
const STUB_URL = 'data:text/javascript,export%20class%20TemaRender%20%7B%7D';

export async function resolve(specifier, context, nextResolve) {
  if (context.parentURL?.endsWith(FIXTURE_SUFFIX)) {
    if (specifier === 'grafici-astrologici') {
      return { url: STUB_URL, shortCircuit: true };
    }
    if (specifier === './fictional-geometry') {
      return nextResolve('./fictional-geometry.ts', context);
    }
  }
  return nextResolve(specifier, context);
}
