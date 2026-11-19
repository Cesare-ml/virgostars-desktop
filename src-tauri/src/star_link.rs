//! Opens only a VirgoStars star page; WebView input cannot select a host or path.
fn star_page(id: u32) -> Option<String> {
    (1..=1_000_000).contains(&id).then(|| format!("https://virgostars.it/stella/{id}/stella"))
}

#[tauri::command]
pub fn open_star_page(id: u32) -> bool {
    star_page(id).is_some_and(|url| open::that(url).is_ok())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_bounded_ids_produce_fixed_https_star_links() {
        assert_eq!(star_page(541).as_deref(), Some("https://virgostars.it/stella/541/stella"));
        assert_eq!(star_page(0), None);
        assert_eq!(star_page(1_000_001), None);
    }
}
