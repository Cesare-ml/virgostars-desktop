//! Device-private portrait attachments. These are NOT part of the chart database, the
//! chart DTO or any sync/outbox schema. Only the native host sees their directory.
//! Each JPEG is independently sealed with the device's archive key and its chart UUID
//! as authenticated context: moving ciphertext to another chart cannot swap portraits.
use crate::archive_keys::Key;
use chacha20poly1305::aead::{Aead, KeyInit, Payload};
use chacha20poly1305::{Key as CipherKey, XChaCha20Poly1305, XNonce};
use std::{fs, io::Write, path::Path};
use zeroize::Zeroizing;

pub const MAX_PHOTO_BYTES: usize = 220_000;
const FOLDER: &str = "private-chart-photos-v1";
const MAGIC: &[u8; 8] = b"VSPHOTO\0";
const VERSION: u8 = 1;
const NONCE_LEN: usize = 24;
const HEADER_LEN: usize = MAGIC.len() + 1 + NONCE_LEN;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PhotoError { Invalid, Unavailable, Corrupt }

pub fn valid_jpeg(bytes: &[u8]) -> bool {
    (8..=MAX_PHOTO_BYTES).contains(&bytes.len())
        && bytes.starts_with(&[0xff, 0xd8, 0xff])
        && bytes.ends_with(&[0xff, 0xd9])
}

fn file_name(id: &str) -> String { format!("{id}.vphoto") }
fn valid_id(id: &str) -> bool {
    id.len() == 36 && id.bytes().enumerate().all(|(index, byte)| match index {
        8 | 13 | 18 | 23 => byte == b'-',
        _ => matches!(byte, b'0'..=b'9' | b'a'..=b'f'),
    })
}
fn associated_data(id: &str) -> Vec<u8> {
    let mut aad = b"VirgoStars/offline-private-portrait/v1/".to_vec();
    aad.extend_from_slice(id.as_bytes());
    aad
}

pub fn list_ids(folder: &Path, chart_ids: &[String]) -> Result<Vec<String>, PhotoError> {
    let photos = folder.join(FOLDER);
    if !photos.exists() { return Ok(Vec::new()); }
    // Only known saved charts may be advertised. Files belonging to deleted charts
    // never become visible and cannot be selected through the renderer.
    Ok(chart_ids.iter().filter(|id| valid_id(id) && photos.join(file_name(id)).is_file()).cloned().collect())
}

pub fn save(folder: &Path, key: &Key, id: &str, jpeg: &[u8]) -> Result<(), PhotoError> {
    if !valid_id(id) || !valid_jpeg(jpeg) { return Err(PhotoError::Invalid); }
    let mut nonce = [0u8; NONCE_LEN];
    getrandom::fill(&mut nonce).map_err(|_| PhotoError::Unavailable)?;
    let mut header = Vec::from(MAGIC.as_slice());
    header.push(VERSION);
    header.extend_from_slice(&nonce);
    let cipher = XChaCha20Poly1305::new(CipherKey::from_slice(&key[..]));
    let content = cipher.encrypt(XNonce::from_slice(&nonce), Payload {msg:jpeg, aad:&associated_data(id)})
        .map_err(|_| PhotoError::Unavailable)?;
    let directory = folder.join(FOLDER);
    fs::create_dir_all(&directory).map_err(|_| PhotoError::Unavailable)?;
    let path = directory.join(file_name(id));
    let staging = directory.join(format!("{id}.vphoto.tmp"));
    let written = (|| -> std::io::Result<()> {
        let mut file = fs::OpenOptions::new().write(true).create(true).truncate(true).open(&staging)?;
        file.write_all(&header)?;
        file.write_all(&content)?;
        file.sync_all()
    })();
    if written.is_err() { let _ = fs::remove_file(&staging); return Err(PhotoError::Unavailable); }
    fs::rename(&staging, &path).map_err(|_| {
        let _ = fs::remove_file(&staging);
        PhotoError::Unavailable
    })
}

pub fn read(folder: &Path, key: &Key, id: &str) -> Result<Option<Zeroizing<Vec<u8>>>, PhotoError> {
    if !valid_id(id) { return Err(PhotoError::Invalid); }
    let path = folder.join(FOLDER).join(file_name(id));
    let sealed = match fs::read(&path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err(PhotoError::Unavailable),
    };
    if sealed.len() < HEADER_LEN + 16 || &sealed[..MAGIC.len()] != MAGIC || sealed[MAGIC.len()] != VERSION {
        return Err(PhotoError::Corrupt);
    }
    let nonce = &sealed[MAGIC.len() + 1..HEADER_LEN];
    let cipher = XChaCha20Poly1305::new(CipherKey::from_slice(&key[..]));
    let plain = cipher.decrypt(XNonce::from_slice(nonce), Payload {
        msg:&sealed[HEADER_LEN..], aad:&associated_data(id),
    }).map_err(|_| PhotoError::Corrupt)?;
    if !valid_jpeg(&plain) { return Err(PhotoError::Corrupt); }
    Ok(Some(Zeroizing::new(plain)))
}

pub fn remove(folder: &Path, id: &str) -> Result<(), PhotoError> {
    if !valid_id(id) { return Err(PhotoError::Invalid); }
    match fs::remove_file(folder.join(FOLDER).join(file_name(id))) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err(PhotoError::Unavailable),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::archive_keys::new_key;

    const ID_A: &str = "11111111-1111-4111-8111-111111111111";
    const ID_B: &str = "22222222-2222-4222-8222-222222222222";
    // A valid-shaped synthetic JPEG fixture; no real faces or identifying metadata.
    const JPEG: &[u8] = &[0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0xff, 0xd9];

    #[test]
    fn photos_are_device_only_encrypted_and_bound_to_chart_id() {
        let root = std::env::temp_dir().join(format!("vs-private-photos-{}-{}", std::process::id(),
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        let key = new_key().unwrap();
        save(&root, &key, ID_A, JPEG).unwrap();
        let path = root.join(FOLDER).join(file_name(ID_A));
        let encrypted = fs::read(&path).unwrap();
        assert!(!encrypted.windows(JPEG.len()).any(|part| part == JPEG));
        assert_eq!(read(&root, &key, ID_A).unwrap().unwrap().as_slice(), JPEG);
        assert_eq!(read(&root, &new_key().unwrap(), ID_A).err(), Some(PhotoError::Corrupt));
        fs::copy(&path, root.join(FOLDER).join(file_name(ID_B))).unwrap();
        assert_eq!(read(&root, &key, ID_B).err(), Some(PhotoError::Corrupt));
        assert_eq!(list_ids(&root, &[ID_A.into()]).unwrap(), vec![ID_A.to_string()]);
        remove(&root, ID_A).unwrap();
        assert!(read(&root, &key, ID_A).unwrap().is_none());
        let _ = fs::remove_dir_all(root);
    }
    #[test]
    fn rejects_oversized_or_non_jpeg_data() {
        assert!(!valid_jpeg(&[0, 1, 2]));
        assert!(!valid_jpeg(&vec![0xff; MAX_PHOTO_BYTES + 1]));
        assert!(!valid_id("../../sensitive"));
    }
}
