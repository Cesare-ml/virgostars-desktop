fn main() {
    println!("cargo:rerun-if-env-changed=VIRGOSTARS_EMBED_PRIVATE_STARS");
    println!("cargo:rerun-if-changed=../.local/ephemeris/fixed-stars.json");
    let output = std::path::PathBuf::from(std::env::var_os("OUT_DIR").expect("OUT_DIR"))
        .join("vs-star-catalog.json");
    let contents = if std::env::var_os("VIRGOSTARS_EMBED_PRIVATE_STARS").as_deref() == Some(std::ffi::OsStr::new("1")) {
        let path = std::path::Path::new("../.local/ephemeris/fixed-stars.json");
        let bytes = std::fs::read(path).expect("approved private stellar catalog is missing");
        assert!(bytes.len() <= 8 * 1024 * 1024, "stellar catalog exceeds size limit");
        bytes
    } else { Vec::new() };
    std::fs::write(output, contents).expect("cannot stage compile-time stellar catalog");
    tauri_build::build();
}
