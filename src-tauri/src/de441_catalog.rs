//! Candidate trust boundary for a pinned DE441 release catalog.
//! No networking, file installation, or IPC is enabled by this module.
#![allow(dead_code)]

use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use virgostars_ephemeris_core::calendar::{Calendar, CalendarDateTime, TimeScale};

const MAX_BYTES: usize = 512 * 1024;
const MAX_ASSET: u64 = 2 * 1024 * 1024 * 1024;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Catalog {
    schema: String,
    release_tag: String,
    source_sha256: String,
    packs: Vec<Pack>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Pack {
    id: String,
    filename: String,
    first_year: i32,
    last_year: i32,
    start_jd_tdb: f64,
    end_jd_tdb: f64,
    required: bool,
    bytes: u64,
    sha256: String,
}

fn safe_component(s: &str, max: usize) -> bool {
    !s.is_empty()
        && s.len() <= max
        && s.bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_' || b == b'.')
        && !s.contains("..")
        && !s.starts_with('.')
}

fn digest(s: &str) -> bool {
    s.len() == 64
        && s.bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

fn year_start(year: i32) -> Result<f64, &'static str> {
    CalendarDateTime {
        year,
        month: 1,
        day: 1,
        hour: 0,
        minute: 0,
        second: 0.0,
        scale: TimeScale::Tdb,
    }
    .to_julian_date(Calendar::ProlepticGregorian)
    .and_then(|d| d.to_de441_epoch())
    .map(|d| d.0)
    .map_err(|_| "invalid_year")
}

/// The expected digest must be embedded in a separately authenticated app
/// update, never taken from this catalog or its HTTP response.
pub(crate) fn parse_pinned(
    bytes: &[u8],
    trusted_sha256: &[u8; 32],
) -> Result<Catalog, &'static str> {
    if bytes.is_empty() || bytes.len() > MAX_BYTES || trusted_sha256.iter().all(|b| *b == 0) {
        return Err("invalid_catalog");
    }
    if Sha256::digest(bytes).as_slice() != trusted_sha256 {
        return Err("unauthenticated_catalog");
    }
    let catalog: Catalog = serde_json::from_slice(bytes).map_err(|_| "invalid_catalog")?;
    if catalog.schema != "virgostars.de441.release-catalog.v1"
        || !safe_component(&catalog.release_tag, 100)
        || !digest(&catalog.source_sha256)
        || catalog.packs.is_empty()
        || catalog.packs.len() > 256
    {
        return Err("invalid_catalog");
    }
    let mut ids = HashSet::new();
    let mut filenames = HashSet::new();
    let mut previous_end = None;
    let mut required = 0;
    for pack in &catalog.packs {
        if !safe_component(&pack.id, 80)
            || !safe_component(&pack.filename, 128)
            || !pack.filename.ends_with(".eph")
            || !ids.insert(&pack.id)
            || !filenames.insert(&pack.filename)
            || !digest(&pack.sha256)
            || pack.bytes == 0
            || pack.bytes >= MAX_ASSET
            || pack.first_year > pack.last_year
            || pack.last_year >= 20000
        {
            return Err("invalid_pack");
        }
        if pack.start_jd_tdb != year_start(pack.first_year)?
            || pack.end_jd_tdb != year_start(pack.last_year + 1)?
            || previous_end.is_some_and(|end| end != pack.start_jd_tdb)
        {
            return Err("invalid_boundaries");
        }
        if pack.required {
            required += 1;
            if (pack.first_year, pack.last_year) != (1000, 2200) {
                return Err("invalid_base");
            }
        }
        previous_end = Some(pack.end_jd_tdb);
    }
    if required != 1 {
        return Err("invalid_base");
    }
    Ok(catalog)
}

impl Catalog {
    /// The catalog cannot supply a host, scheme, path or query component.
    pub(crate) fn asset_url(&self, pack: &Pack) -> String {
        format!(
            "https://github.com/Cesare-ml/VirgoStars-Ephemeris/releases/download/{}/{}",
            self.release_tag, pack.filename
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn catalog() -> serde_json::Value {
        serde_json::json!({
          "schema":"virgostars.de441.release-catalog.v1", "releaseTag":"data-v1",
          "sourceSha256":"a".repeat(64),
          "packs":[
            {"id":"past", "filename":"past.eph", "firstYear":800, "lastYear":999,
             "startJdTdb":2013253.5, "endJdTdb":2086302.5, "required":false, "bytes":42, "sha256":"b".repeat(64)},
            {"id":"base", "filename":"base.eph", "firstYear":1000, "lastYear":2200,
             "startJdTdb":2086302.5, "endJdTdb":2524958.5, "required":true, "bytes":42, "sha256":"c".repeat(64)},
            {"id":"future", "filename":"future.eph", "firstYear":2201, "lastYear":2400,
             "startJdTdb":2524958.5, "endJdTdb":2598007.5, "required":false, "bytes":42, "sha256":"d".repeat(64)}
          ]
        })
    }

    fn parse(value: &serde_json::Value) -> Result<Catalog, &'static str> {
        let bytes = serde_json::to_vec(value).unwrap();
        parse_pinned(&bytes, &Sha256::digest(&bytes).into())
    }

    #[test]
    fn exact_pin_and_restricted_asset_url() {
        let data = serde_json::to_vec(&catalog()).unwrap();
        let pin: [u8; 32] = Sha256::digest(&data).into();
        let cat = parse_pinned(&data, &pin).unwrap();
        assert_eq!(
            cat.asset_url(&cat.packs[0]),
            "https://github.com/Cesare-ml/VirgoStars-Ephemeris/releases/download/data-v1/past.eph"
        );
        let mut altered = data.clone();
        altered.push(b' ');
        assert_eq!(
            parse_pinned(&altered, &pin).unwrap_err(),
            "unauthenticated_catalog"
        );
        assert!(parse_pinned(&data, &[0; 32]).is_err());
    }

    #[test]
    fn authenticated_but_invalid_catalog_is_rejected() {
        let mut value = catalog();
        value["packs"][0]["filename"] = "../base.eph".into();
        assert!(parse(&value).is_err());
        value = catalog();
        value["releaseTag"] = "v1?redirect=evil".into();
        assert!(parse(&value).is_err());
        value = catalog();
        value["packs"][0]["endJdTdb"] = 2086301.5.into();
        assert!(parse(&value).is_err());
        value = catalog();
        value["packs"][1]["required"] = false.into();
        assert!(parse(&value).is_err());
        value = catalog();
        value["packs"][2]["sha256"] = "bad".into();
        assert!(parse(&value).is_err());
    }
}
