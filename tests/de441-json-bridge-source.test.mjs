import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const src = readFileSync(new URL('experiments/de441-json-bridge/src/main.rs', root), 'utf8');
const manifest = readFileSync(new URL('experiments/de441-json-bridge/Cargo.toml', root), 'utf8');

const bodies = [
  ['Sun', 'sun', 'body_center'], ['Moon', 'moon', 'body_center'],
  ['Mercury', 'mercury', 'body_center'], ['Venus', 'venus', 'body_center'],
  ['MarsBarycenter', 'mars_barycenter', 'system_barycenter'],
  ['JupiterBarycenter', 'jupiter_barycenter', 'system_barycenter'],
  ['SaturnBarycenter', 'saturn_barycenter', 'system_barycenter'],
  ['UranusBarycenter', 'uranus_barycenter', 'system_barycenter'],
  ['NeptuneBarycenter', 'neptune_barycenter', 'system_barycenter'],
  ['PlutoBarycenter', 'pluto_barycenter', 'system_barycenter'],
];
const approximations = [
  ['Ut1EqualsUtc','ut1_equals_utc'],
  ['TruncatedTdbMinusTt','truncated_tdb_minus_tt'],
  ['NoNutation','no_nutation'], ['NoLightTime','no_light_time'],
  ['NoAberration','no_aberration'], ['NoGravitationalDeflection','no_gravitational_deflection'],
  ['NoPolarMotion','no_polar_motion'], ['NoAtmosphericRefraction','no_atmospheric_refraction'],
  ['OuterPlanetSystemBarycenters','outer_planet_system_barycenters'],
];

test('experimental binary uses pinned original Rust ephemeris core, never duplicated astronomy', () => {
  assert.match(manifest,/virgostars-ephemeris-core = \{/);
  assert.match(manifest,/git = "https:\/\/github.com\/Cesare-ml\/VirgoStars-Ephemeris"/);
  assert.match(manifest,/rev = "[0-9a-f]{40}"/);
  assert.doesNotMatch(manifest,/\bpath = "\.\.\/\.\.\/src-tauri/);
  assert.match(src,/use virgostars_ephemeris_core::first_sky::\{/);
  assert.match(src,/let sky = calculate\(&mut kernel, civil, observer\)/);
  assert.match(src,/let mut kernel = De441::new\(&mut file\)/);
});

test('all ten geometry bodies map to explicit center kinds, never planetary center for outer barycenters', () => {
  for (const [rust, id, center] of bodies) {
    assert.ok(src.includes('Body::'+rust+' => ("'+id+'", "'+center+'")'), rust);
  }
  assert.match(src,/Body::Earth\), None/);
  assert.match(src,/const BODIES: usize = 10;/);
});

test('all nine model approximations are honestly disclosed', () => {
  for(const [rust, name] of approximations) {
    assert.ok(src.includes('SkyApproximation::'+rust+' => "'+name+'"'), rust);
  }
  assert.match(src,/MODEL_APPROXIMATIONS/);
});

test('the CLI explicitly labels experimental geometric model and serializes required units/provenance', () => {
  for(const field of ['scientific_status: "experimental_unverified"',
    'source_format: "DE441_classic_binary"', 'observer_datum: "WGS84"',
    'frame: "mean_ecliptic_and_equatorial_of_date"',
    'geometry: "topocentric_geometric"', 'height_meters: f64',
    'kernel_sha256: String', 'distance_km: f64', 'tai_minus_utc_seconds: i32']) {
    assert.ok(src.includes(field), field);
  }
  assert.match(src,/\#\[serde\(rename_all = "camelCase"\)\]/);
});

test('external kernel path remains a CLI-only argument, no WebView IPC, fallback or bundled file', () => {
  assert.match(src,/env::args\(\)\.skip\(1\)/);
  assert.match(src,/Sha256::new\(\)/);
  assert.match(src,/let digest = sha256\(&mut file\)/);
  assert.match(src,/file.seek\(SeekFrom::Start\(0\)\)/);
  assert.match(src,/supported_utc_window\(utc\)/);
  assert.match(src,/MAX_SHA256_CHUNK: usize = 64 \* 1024/);
  assert.match(src,/is_canonical_utc\(utc\)/);
  assert.match(src,/i64::from\(lat_micro\)\.abs\(\)/);
  assert.match(src,/DE441_BRIDGE_ERROR:\{code\}/);
  assert.doesNotMatch(src.split("#[cfg(test)]")[0], /use tauri|reqwest|std::process::Command|\.unwrap\(\)/);
  assert.doesNotMatch(manifest,/default-run|workspace =/);
});
