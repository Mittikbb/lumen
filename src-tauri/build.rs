fn main() {
    // The icon is compiled into the .exe as a resource; without this, a new
    // icon is ignored until something else forces this script to rerun.
    println!("cargo:rerun-if-changed=icons/icon.ico");
    tauri_build::build()
}
