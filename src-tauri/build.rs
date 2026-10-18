fn main() {
    // The icon is compiled into the .exe as a resource; without this, a new
    // icon is ignored until something else forces this script to rerun.
    println!("cargo:rerun-if-changed=icons/icon.ico");
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        build_mediaremote_helper();
    }
    tauri_build::build()
}

/// The "now playing" helper Lumen runs inside /usr/bin/perl on macOS (see
/// src/macos/mediaremote.m). Universal, since perl runs as either arch.
fn build_mediaremote_helper() {
    const SOURCE: &str = "src/macos/mediaremote.m";
    println!("cargo:rerun-if-changed={SOURCE}");
    let out = std::path::PathBuf::from(std::env::var("OUT_DIR").unwrap()).join("mediaremote.dylib");
    let status = std::process::Command::new("xcrun")
        .args(["clang", "-dynamiclib", "-fobjc-arc", "-O2", "-Wall", "-Werror"])
        .args(["-arch", "arm64", "-arch", "x86_64", "-mmacosx-version-min=12.0"])
        .args(["-framework", "Foundation", SOURCE, "-o"])
        .arg(&out)
        .status()
        .expect("xcrun clang is needed to build the macOS media helper");
    assert!(status.success(), "building {SOURCE} failed");
}
