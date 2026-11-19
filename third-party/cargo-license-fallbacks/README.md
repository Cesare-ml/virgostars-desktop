# Cargo package license fallbacks

Some published Cargo packages omit their repository-level license file. These
copies let the Windows release notice generator fail closed without relying on
an unversioned network download at build time.

- `alloc-BSD-3-Clause.txt`: [upstream license at the crate's source revision](https://github.com/dropbox/rust-alloc-no-stdlib/blob/0a81fd6928ea3b33c8cd484aa4575d50ffb98012/LICENSE), for `alloc-stdlib` 0.3.0.
- `webview2-MIT.txt`: [upstream license at the source revision](https://github.com/wravery/webview2-rs/blob/edc2caf886175ccaebe86078c9cfe1ae2a187328/LICENSE), for `webview2-com` and `webview2-com-sys` 0.39.1. The [macros crate revision](https://github.com/wravery/webview2-rs/blob/dffa41a8a46d3f5565eefbff2de57d38d399f158/LICENSE) contains the same license, for `webview2-com-macros` 0.8.1.
- `selectors-MPL-2.0.txt`: standard MPL 2.0 text from the locally resolved `cssparser` 0.37.0 package, for `selectors` 0.38.0 whose source headers specify MPL 2.0.
- `tauri-plugin-Apache-2.0.txt`: Apache 2.0 text from the locally resolved `tauri` 2.12.5 package, for `tauri-plugin` 2.7.4, whose crate declares Apache-2.0 OR MIT and whose source credits Tauri Programme within The Commons Conservancy.

Fallbacks are limited to these exact versions by the generator; review them
again when a dependency changes. They do not license VirgoStars project code.
