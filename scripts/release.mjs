// Builds, signs and publishes a Lumen release that installed copies update to
// by themselves. Bump the version first (tauri.conf.json, Cargo.toml +
// `cargo update -p lumen`, package.json), commit "Release X" and push; then:
//   node scripts/release.mjs notes.md
// notes.md is the release text in Russian; "{{sha256}}" in it becomes the
// installer's hash. The updater key lives outside the repo, by default in
// %USERPROFILE%\.tauri\lumen-updater.key (or TAURI_SIGNING_PRIVATE_KEY). Lose
// it and installed copies can't update anymore: keep a backup.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const REPO = "Mittikbb/lumen";
const notesFile = process.argv[2];
if (!notesFile) throw new Error("usage: node scripts/release.mjs notes.md");

const version = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8")).version;
const key = process.env.TAURI_SIGNING_PRIVATE_KEY ?? join(homedir(), ".tauri", "lumen-updater.key");
if (!process.env.TAURI_SIGNING_PRIVATE_KEY && !existsSync(key)) throw new Error(`updater key not found: ${key}`);

// npm is a .cmd on Windows and needs a shell; nothing else goes through one,
// or arguments with spaces (the release title) get split.
const run = (cmd, args, env = {}) =>
  execFileSync(cmd, args, {
    stdio: "inherit",
    shell: process.platform === "win32" && cmd === "npm",
    env: { ...process.env, ...env },
  });

console.log(`Building Lumen ${version}…`);
run("npm", ["run", "tauri", "build"], {
  TAURI_SIGNING_PRIVATE_KEY: key,
  TAURI_SIGNING_PRIVATE_KEY_PASSWORD: process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ?? "",
});

const name = `Lumen_${version}_x64-setup.exe`;
const setup = join("src-tauri/target/release/bundle/nsis", name);
const signature = readFileSync(`${setup}.sig`, "utf8").trim();
const sha256 = createHash("sha256").update(readFileSync(setup)).digest("hex");
const notes = readFileSync(notesFile, "utf8").replaceAll("{{sha256}}", sha256);

// What installed copies read to find, check and fetch the new version.
const manifest = join(tmpdir(), "latest.json");
writeFileSync(
  manifest,
  JSON.stringify(
    {
      version,
      notes: `https://github.com/${REPO}/releases/tag/v${version}`,
      pub_date: new Date().toISOString(),
      platforms: {
        "windows-x86_64": {
          signature,
          url: `https://github.com/${REPO}/releases/download/v${version}/${name}`,
        },
      },
    },
    null,
    2,
  ),
);
const notesOut = join(tmpdir(), `lumen-${version}-notes.md`);
writeFileSync(notesOut, notes);

run("gh", ["release", "create", `v${version}`, setup, manifest, "-R", REPO, "--target", "main", "--title", `Lumen ${version}`, "--notes-file", notesOut]);
console.log(`Released Lumen ${version} · SHA-256 ${sha256}`);
