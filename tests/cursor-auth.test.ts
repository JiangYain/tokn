import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createCipheriv, randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test, { type TestContext } from "node:test";
import { resolveCursorAuth } from "../src/cursor.js";

const jwt = [
  Buffer.from(JSON.stringify({ alg: "HS256" })).toString("base64url"),
  Buffer.from(JSON.stringify({ sub: "auth0|user_test123", exp: 2_000_000_000 })).toString("base64url"),
  "test-signature",
].join(".");

async function createFixture(t: TestContext, token: string, localState?: unknown) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "tokn-cursor-test-"));
  t.after(async () => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    await fs.rm(root, { recursive: true, force: true });
  });
  const cursorAppDir = path.join(root, "Cursor");
  const storageDir = path.join(cursorAppDir, "User", "globalStorage");
  await fs.mkdir(storageDir, { recursive: true });
  const db = new DatabaseSync(path.join(storageDir, "state.vscdb"));
  try {
    db.exec("CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value TEXT)");
    db.prepare("INSERT INTO ItemTable VALUES (?, ?)").run("cursorAuth/accessToken", token);
  } finally {
    db.close();
  }
  const cursorCliConfigPath = path.join(root, "cli-config.json");
  await fs.writeFile(cursorCliConfigPath, JSON.stringify({ authInfo: { authId: "auth0|user_test123" } }));
  if (localState) await fs.writeFile(path.join(cursorAppDir, "Local State"), JSON.stringify(localState));
  return { cursorAppDir, cursorCliConfigPath, timezone: "Asia/Shanghai", from: "2026-11-06", to: "2026-11-06" };
}

test("plaintext Cursor login storage still produces the dashboard cookie", async (t) => {
  const options = await createFixture(t, jwt);
  const auth = resolveCursorAuth(options);
  assert.equal(auth.cookieHeader, `WorkosCursorSessionToken=user_test123%3A%3A${jwt}`);
});

test("encrypted Cursor login storage is decrypted with its own Windows profile key", {
  skip: process.platform !== "win32",
}, async (t) => {
  const key = randomBytes(32);
  const protectedKey = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
    "Add-Type -AssemblyName System.Security; $plain = [Convert]::FromBase64String([Console]::In.ReadToEnd()); $sealed = [System.Security.Cryptography.ProtectedData]::Protect($plain, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($sealed))",
  ], { input: key.toString("base64"), encoding: "utf8", windowsHide: true }).trim();
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const encrypted = Buffer.concat([cipher.update(jwt, "utf8"), cipher.final()]);
  const stored = "cursor-safe-storage:v1:" + Buffer.concat([
    Buffer.from("v10"), nonce, encrypted, cipher.getAuthTag(),
  ]).toString("base64");
  const options = await createFixture(t, stored, {
    os_crypt: { encrypted_key: Buffer.concat([Buffer.from("DPAPI"), Buffer.from(protectedKey, "base64")]).toString("base64") },
  });

  const auth = resolveCursorAuth(options);
  assert.equal(auth.cookieHeader, `WorkosCursorSessionToken=user_test123%3A%3A${jwt}`);
  assert.equal(auth.expiresAtIso, new Date(2_000_000_000 * 1000).toISOString());
});

test("an unreadable encrypted login is reported instead of sending ciphertext", async (t) => {
  const options = await createFixture(t, "cursor-safe-storage:v1:invalid-ciphertext");
  assert.throws(() => resolveCursorAuth(options), /Could not decrypt Cursor login state/);
});
