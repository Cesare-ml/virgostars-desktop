//! A local, encrypted pre-update snapshot. Never copies keys or follows symlinks.
use std::{fs, io::{self,Read}, path::{Path,PathBuf}, time::{SystemTime,UNIX_EPOCH}};

fn regular(path:&Path)->io::Result<bool>{match fs::symlink_metadata(path){Ok(m) if m.is_file() && !m.file_type().is_symlink()=>Ok(true),Ok(_)=>Err(io::ErrorKind::InvalidData.into()),Err(e) if e.kind()==io::ErrorKind::NotFound=>Ok(false),Err(e)=>Err(e)}}
fn directory(path:&Path)->io::Result<bool>{match fs::symlink_metadata(path){Ok(m) if m.is_dir() && !m.file_type().is_symlink()=>Ok(true),Ok(_)=>Err(io::ErrorKind::InvalidData.into()),Err(e) if e.kind()==io::ErrorKind::NotFound=>Ok(false),Err(e)=>Err(e)}}
fn copy_checked(from:&Path,to:&Path)->io::Result<()> {
    let mut src=fs::File::open(from)?;
    let mut dst=fs::OpenOptions::new().create_new(true).write(true).open(to)?;
    io::copy(&mut src,&mut dst)?; dst.sync_all()?; drop(dst);
    let mut a=fs::File::open(from)?; let mut b=fs::File::open(to)?;
    let (mut x,mut y)=([0u8;65536],[0u8;65536]);
    loop {let n=a.read(&mut x)?;let m=b.read(&mut y)?;if n!=m||x[..n]!=y[..m]{return Err(io::ErrorKind::InvalidData.into())} if n==0{return Ok(())}}
}
pub fn snapshot(folder:&Path)->io::Result<PathBuf> {
    if !directory(folder)? {fs::create_dir_all(folder)?;}
    let backups=folder.join("update-backups");
    if !directory(&backups)? {fs::create_dir(&backups)?;}
    let timestamp=SystemTime::now().duration_since(UNIX_EPOCH).map_err(|_|io::ErrorKind::InvalidData)?.as_nanos();
    let dest=backups.join(format!("before-{timestamp}-{}",std::process::id())); fs::create_dir(&dest)?;
    let archive=folder.join("charts-v2.vsarchive");
    if regular(&archive)? {copy_checked(&archive,&dest.join("charts-v2.vsarchive"))?;}
    let photos=folder.join("private-chart-photos-v1");
    if directory(&photos)? {
        let target=dest.join("private-chart-photos-v1"); fs::create_dir(&target)?;
        for item in fs::read_dir(&photos)? {let item=item?;let path=item.path();
            if path.extension().and_then(|s|s.to_str())!=Some("vphoto") {continue;}
            if regular(&path)? {copy_checked(&path,&target.join(item.file_name()))?;}
        }
    }
    Ok(dest)
}
#[cfg(test)]
mod tests {
 use super::*;
 #[test] fn snapshot_keeps_encrypted_inputs_unchanged() {
  let tmp=tempfile::tempdir().unwrap(); let root=tmp.path();
  fs::write(root.join("charts-v2.vsarchive"),b"encrypted fixture").unwrap();
  fs::create_dir(root.join("private-chart-photos-v1")).unwrap();
  fs::write(root.join("private-chart-photos-v1/a.vphoto"),b"sealed photo").unwrap();
  let backup=snapshot(root).unwrap();
  assert_eq!(fs::read(backup.join("charts-v2.vsarchive")).unwrap(),b"encrypted fixture");
  assert_eq!(fs::read(backup.join("private-chart-photos-v1/a.vphoto")).unwrap(),b"sealed photo");
  assert_eq!(fs::read(root.join("charts-v2.vsarchive")).unwrap(),b"encrypted fixture");
 }
 #[test] fn failed_backup_never_changes_the_original_archive() {
  let tmp=tempfile::tempdir().unwrap(); let root=tmp.path();
  fs::write(root.join("charts-v2.vsarchive"),b"encrypted fixture").unwrap();
  fs::write(root.join("update-backups"),b"not a directory").unwrap();
  assert!(snapshot(root).is_err());
  assert_eq!(fs::read(root.join("charts-v2.vsarchive")).unwrap(),b"encrypted fixture");
 }
}
