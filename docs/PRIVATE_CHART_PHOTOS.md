# Private chart portraits — offline-only native attachment (prototype)

Status: implemented in Desktop source; no Windows native/manual acceptance yet. Not security reviewed.

## Privacy contract

- Photos are **not** in `ChartRecordV1`, `SavedChartV1`, future `SavedNatalChartV1` sync records, a remote request, an outbox, or browser localStorage. Only the display preference is persisted on this device; default is hidden.
- The file picker accepts local JPEG, PNG and WebP up to 12 MiB. The renderer paints the selected image on an in-memory canvas up to 720 pixels per edge and produces a JPEG of at most 220,000 bytes. Re-encoding drops original metadata such as EXIF, GPS and camera details. No fetch, upload or remote fallback is implemented.
- The native host stores `private-chart-photos-v1/<uuid>.vphoto` under the application's local data directory. The renderer never receives this path. JPEG bytes are encrypted with XChaCha20-Poly1305, a new random nonce, the existing device-only archive key from Windows Credential Manager/macOS Keychain and authenticated associated data identifying that **specific UUID**. Ciphertext cannot be moved to another chart to impersonate an attachment.
- A photo can be attached only to an existing saved chart. Reading, writing and deleting fail closed when the archive is locked/corrupt; the chart archive schema and encryption format are unchanged. The `list` operation reports only photo availability by known chart UUID; it never includes image bytes. Only an explicit `photo_read` loads one image, lazily for visible cards.
- Switching photos off, closing the archive or destroying the Angular component revokes WebView object URLs. Hiding does not delete the image. Removing the photo deletes its sealed device file; deleting a chart also attempts to delete its photo.

## Failure and portability boundaries

- At-rest protection does not defend an unlocked session or malware running as the OS user. There is **no recovery key** and no cross-device photo portability. An OS account/key reset makes photos unreadable.
- Individual photo files do not inflate the whole-file encrypted chart archive; a photo update does not rewrite every chart. Sidecars are deliberately not part of the current or future sync protocol.
- Chart deletion and photo-file deletion span two filesystem changes, not one transaction. If the second delete fails (e.g. locked file), the host reports an error but an encrypted orphan photo file may remain. This needs fault-injection/cleanup handling before beta and must not be reported as a successful complete deletion.
- Only synthetic subjects may be placed in repository tests. Do not add genuine portraits to test fixtures, logs or examples.

## Manual acceptance (Windows, pending)

1. Attach a portrait to a fictional saved chart, verify its thumbnail appears only when **Show photos** is on, and remains available after restart without network.
2. Hide photos, restart, verify the hidden preference persists. Show again to verify decryption with the OS credential.
3. Change a subject's date, time, place and name through **Edit details**; verify the same archive ID, photo association and recalculated positions on opening.
4. Replace/remove the photo and delete the chart; inspect the app-local folder for cleartext JPEGs, temporary files and orphan ciphertext.
5. Test damaged/swapped ciphertext, missing OS credential, access denial, large images, wrong MIME, DST folds, multiple pending thumbnails and interruption mid-write.
6. When cloud synchronization is implemented, verify that photo bytes, paths and metadata never reach VirgoStars servers. This future integration test is not yet verifiable.
