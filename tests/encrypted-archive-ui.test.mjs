import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {STRINGS} from '../src/app/translations.ts';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const html = read('src/app/desktop-app.component.html');
const component = read('src/app/desktop-app.component.ts');
const rust = read('src-tauri/src/chart_archive.rs');
const vault = read('src-tauri/src/archive_vault.rs');
const keys = read('src-tauri/src/archive_keys.rs');
const cargo = read('src-tauri/Cargo.toml');

test('the archive is described as encrypted, never as plain SQLite, once it is', () => {
  for (const locale of ['it', 'en']) {
    const note = STRINGS[locale]['archive.note'];
    assert.match(note, /cifrat|encrypted/i);
    assert.doesNotMatch(note, /non cifrato|not encrypted/i);
    assert.doesNotMatch(STRINGS[locale]['footer.real'], /non cifrato|not encrypted/i);
    assert.match(STRINGS[locale]['archive.locked'], /cifrat|encrypted/i);
  }
});

test('a locked archive has its own message and is never presented as empty', () => {
  assert.match(component, /archive_locked:'archive\.locked'/);
  for (const locale of ['it', 'en']) {
    assert.ok(STRINGS[locale]['archive.locked'].length > 40);
  }
});

test('the old plain file is only removed after an explicit, confirmed request', () => {
  assert.match(html, /<div class="legacy-warning" \*ngIf="legacyPresent" role="alert">/);
  assert.match(html, /\(click\)="askRemoveLegacy\(\)"/);
  assert.match(html, /\(click\)="confirmRemoveLegacy\(\)"/);
  assert.match(component, /if \(!this\.pendingLegacyRemoval \|\| this\.archiveBusy\) return;/);
  assert.match(component, /runArchive\(\{operation:'remove_legacy'\}, 'archive\.legacy\.removed'\)/);
  // Nothing in the interface removes it silently.
  assert.equal((component.match(/remove_legacy/g) ?? []).length, 1);
  for (const locale of ['it', 'en']) {
    assert.match(STRINGS[locale]['archive.legacy'], /secur|sicur/i, 'says that ordinary deletion is not secure erasure');
  }
});

test('the native archive has no plaintext fallback and no path or key crosses the IPC', () => {
  // Locked, never plain: a missing key is not replaced when an archive exists.
  assert.match(rust, /keys\.load\(\)\.map_err\(key_failure\)\?\.ok_or\("archive_locked"\)/);
  assert.match(rust, /Connection::open_in_memory\(\)/);
  assert.doesNotMatch(rust, /Connection::open\(&paths\.(sealed|staging)\)|SQLITE_OPEN_CREATE/);
  // The WebView cannot name a file or receive key material.
  const request = rust.match(/pub struct ArchiveRequestV1 \{[\s\S]*?\n\}/)?.[0] ?? '';
  assert.doesNotMatch(request, /path|key|secret/i);
  const response = rust.match(/pub struct ArchiveResponseV1 \{[\s\S]*?\n\}/)?.[0] ?? '';
  assert.doesNotMatch(response, /path|key|secret/i);
});

test('encryption uses a reviewed AEAD from RustCrypto with a random key and a fresh random nonce', () => {
  assert.match(cargo, /^chacha20poly1305 = "0\.10"/m);
  assert.match(vault, /XChaCha20Poly1305/);
  assert.match(vault, /getrandom::fill\(&mut nonce\)/);
  assert.match(vault, /aad: &head/, 'the header is authenticated');
  assert.match(keys, /getrandom::fill\(&mut key\[\.\.\]\)/);
  assert.match(keys, /keyring::Entry::new\(SERVICE, ACCOUNT\)/);
  // No home-made primitive and no key derived from a device identifier.
  assert.doesNotMatch(vault + keys, /sha2|md5|xor|hostname|machine[-_ ]?id|COMPUTERNAME|USERNAME/i);
});
