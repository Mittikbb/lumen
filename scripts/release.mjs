// Builds, signs and publishes a Lumen release that installed copies update to
// by themselves. Bump the version first (tauri.conf.json, Cargo.toml +
// `cargo update -p lumen`, package.json), commit "Release X" and push; then,
// in a terminal (it asks for the updater key's password):
//   node scripts/release.mjs notes.md [--dry-run]
// notes.md is the release text in Russian; "{{sha256}}" in it becomes the
// installer's hash. --dry-run builds and checks everything but publishes
// nothing.
//
// The updater key lives outside the repo, in %USERPROFILE%\.tauri\
// lumen-updater-2.key (or LUMEN_UPDATER_KEY), protected by a password
// (TAURI_SIGNING_PRIVATE_KEY_PASSWORD, or typed in when asked). Lose it and
// installed copies can't update anymore: keep a backup.
//
// Two manifests go out with every release. Copies up to 0.5.6 trust the first
// key, which had no password, and read latest.json; it always points them at
// the bridge release 0.5.7, signed with that old key but carrying the new
// one. From 0.5.7 on copies read latest-v2.json, signed with the new key.
// Every signature is checked against the key the receiving copies hold before
// anything is published.
import { execFileSync } from "node:child_process";
import { createHash, createPublicKey, verify } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const REPO = "Mittikbb/lumen";
const BRIDGE = "0.5.7";
const OLD_KEY = join(homedir(), ".tauri", "lumen-updater.key");
const OLD_PUBKEY =
  "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDVFRkNCQTA4MERDODgzNzYKUldSMmc4Z05DTHI4WHA5ZWpjZHIrZThEKzFuVk5VNnlsTVdxbVNmRXFIaWptOU5tVHI5OVNiRUMK";
const KEY = process.env.LUMEN_UPDATER_KEY ?? join(homedir(), ".tauri", "lumen-updater-2.key");
const TAURI_CLI = "node_modules/@tauri-apps/cli/tauri.js";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const notesFile = args.find((a) => !a.startsWith("--"));
if (!notesFile) throw new Error("usage: node scripts/release.mjs notes.md [--dry-run]");

const conf = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8"));
const version = conf.version;
const pubkey = conf.plugins.updater.pubkey;
const bridge = version === BRIDGE;
if (!existsSync(KEY)) throw new Error(`updater key not found: ${KEY}`);
if (bridge && !existsSync(OLD_KEY)) throw new Error(`the bridge release needs the old key too: ${OLD_KEY}`);
if (pubkey === OLD_PUBKEY) throw new Error("tauri.conf.json still has the old updater pubkey");

// npm is a .cmd on Windows and needs a shell; nothing else goes through one,
// or arguments with spaces (the release title) get split.
const run = (cmd, args, env = {}) =>
  execFileSync(cmd, args, {
    stdio: "inherit",
    shell: process.platform === "win32" && cmd === "npm",
    env: { ...process.env, ...env },
  });

const password = process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ?? (await askHidden("Пароль ключа обновлений: "));
// A key without a password is what the rotation away from the first key fixed.
if (!password) throw new Error("the updater key needs a password");
const work = mkdtempSync(join(tmpdir(), `lumen-${version}-`));

// A wrong password or a key that doesn't match tauri.conf.json shows up now,
// not after the build.
const probe = join(work, "probe.txt");
writeFileSync(probe, `Lumen ${version}`);
check(probe, sign(probe, KEY, password), pubkey, "новый ключ (или пароль не тот)");
if (bridge) check(probe, sign(probe, OLD_KEY, ""), OLD_PUBKEY, "старый ключ");
const legacy = bridge ? null : bridgeManifest();

console.log(`Building Lumen ${version}…`);
run("npm", ["run", "tauri", "build"], {
  TAURI_SIGNING_PRIVATE_KEY: KEY,
  TAURI_SIGNING_PRIVATE_KEY_PASSWORD: password,
});

const name = `Lumen_${version}_x64-setup.exe`;
const setup = join("src-tauri/target/release/bundle/nsis", name);
const signature = readFileSync(`${setup}.sig`, "utf8").trim();
check(setup, signature, pubkey, "установщик");
const sha256 = createHash("sha256").update(readFileSync(setup)).digest("hex");
const notes = readFileSync(notesFile, "utf8").replaceAll("{{sha256}}", sha256);

writeFileSync(join(work, "latest-v2.json"), manifest(signature));
if (bridge) {
  const oldSignature = sign(setup, OLD_KEY, "");
  writeFileSync(`${setup}.sig`, signature);
  check(setup, oldSignature, OLD_PUBKEY, "установщик для старых копий");
  writeFileSync(join(work, "latest.json"), manifest(oldSignature));
} else {
  writeFileSync(join(work, "latest.json"), legacy);
}
const notesOut = join(work, "notes.md");
writeFileSync(notesOut, notes);

const assets = [setup, join(work, "latest.json"), join(work, "latest-v2.json")];
if (dryRun) {
  console.log(`Dry run: Lumen ${version} is ready in ${work}, nothing published · SHA-256 ${sha256}`);
} else {
  run("gh", ["release", "create", `v${version}`, ...assets, "-R", REPO, "--target", "main", "--title", `Lumen ${version}`, "--notes-file", notesOut]);
  console.log(`Released Lumen ${version} · SHA-256 ${sha256}`);
}

/** What installed copies read to find, check and fetch the new version. */
function manifest(signature) {
  return JSON.stringify(
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
  );
}

/** The bridge release's latest.json, handed on to copies with the old key. */
function bridgeManifest() {
  const dir = join(work, "bridge");
  execFileSync("gh", ["release", "download", `v${BRIDGE}`, "-p", "latest.json", "-D", dir, "-R", REPO], { stdio: "inherit" });
  const text = readFileSync(join(dir, "latest.json"), "utf8");
  if (JSON.parse(text).version !== BRIDGE) throw new Error(`v${BRIDGE}/latest.json isn't the bridge manifest`);
  return text;
}

/** Signs a file for this version with a key file; returns the signature. */
function sign(file, key, password) {
  const env = { ...process.env, TAURI_SIGNING_PRIVATE_KEY_PASSWORD: password };
  delete env.TAURI_SIGNING_PRIVATE_KEY;
  delete env.TAURI_SIGNING_PRIVATE_KEY_PATH;
  try {
    execFileSync(process.execPath, [TAURI_CLI, "signer", "sign", "-f", key, "--app-version", version, file], { env, stdio: "pipe" });
  } catch (e) {
    throw new Error(`не удалось подписать ${file}: ${e.stderr?.toString().trim() || e.message}`);
  }
  return readFileSync(`${file}.sig`, "utf8").trim();
}

/** Fails unless `signature` is a minisign signature of `file` by `pubkey`
 * for this version, checked the way the updater does. */
function check(file, signature, pubkey, what) {
  const fail = (why) => {
    throw new Error(`${what}: ${why}`);
  };
  const lines = (b64) => Buffer.from(b64, "base64").toString("utf8").split("\n").map((l) => l.trim());
  const [, sigLine, comment, globalLine] = lines(signature);
  const pk = Buffer.from(lines(pubkey)[1], "base64"); // "Ed", key id (8), key (32)
  const sig = Buffer.from(sigLine, "base64"); // "ED" or "Ed", key id (8), signature (64)
  if (!sig.subarray(2, 10).equals(pk.subarray(2, 10))) fail("подписан другим ключом");
  const key = createPublicKey({
    key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), pk.subarray(10)]),
    format: "der",
    type: "spki",
  });
  const data = readFileSync(file);
  const message = sig.subarray(0, 2).toString() === "ED" ? createHash("blake2b512").update(data).digest() : data;
  if (!verify(null, message, key, sig.subarray(10))) fail("подпись не сходится");
  const trusted = comment.replace(/^trusted comment: /, "");
  if (!verify(null, Buffer.concat([sig.subarray(10), Buffer.from(trusted)]), key, Buffer.from(globalLine, "base64"))) {
    fail("подпись комментария не сходится");
  }
  const signed = trusted.split("\t").find((f) => f.startsWith("version:"))?.slice("version:".length);
  if (signed !== version) fail(`подписан для версии ${signed ?? "без версии"}, а не ${version}`);
}

/** Reads a line from the terminal without showing it. */
function askHidden(question) {
  const { stdin, stdout } = process;
  if (!stdin.isTTY) throw new Error("no terminal to ask for the password: set TAURI_SIGNING_PRIVATE_KEY_PASSWORD");
  stdout.write(question);
  stdin.setRawMode(true);
  stdin.setEncoding("utf8");
  stdin.resume();
  return new Promise((resolve) => {
    let value = "";
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") {
          stdin.off("data", onData);
          stdin.setRawMode(false);
          stdin.pause();
          stdout.write("\n");
          resolve(value);
          return;
        }
        if (ch === "\u0003") {
          stdin.setRawMode(false);
          stdout.write("\n");
          process.exit(130);
        }
        if (ch === "\b" || ch === "\u007f") value = value.slice(0, -1);
        else value += ch;
      }
    };
    stdin.on("data", onData);
  });
}
