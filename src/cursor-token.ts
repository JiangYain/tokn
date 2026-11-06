import { execFileSync } from "node:child_process";
import { createDecipheriv } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const ENCRYPTED_TOKEN_PREFIX = "cursor-safe-storage:v1:";
let cachedProfileKey: { encryptedKey: string; key: Buffer } | null = null;

export function decodeCursorAccessToken(stored: string, cursorAppDir: string): string {
  if (!stored.startsWith("cursor-safe-storage:")) return stored;

  try {
    if (process.platform !== "win32" || !stored.startsWith(ENCRYPTED_TOKEN_PREFIX)) {
      throw new Error("Unsupported encrypted login format");
    }
    const ciphertext = Buffer.from(stored.slice(ENCRYPTED_TOKEN_PREFIX.length), "base64");
    if (ciphertext.length <= 31 || ciphertext.subarray(0, 3).toString("ascii") !== "v10") {
      throw new Error("Unsupported ciphertext format");
    }

    // Chromium encryption keys belong to each app profile. Tokn's own
    // safeStorage key cannot decrypt credentials stored by Cursor.
    const localState = JSON.parse(fs.readFileSync(path.join(cursorAppDir, "Local State"), "utf8")) as {
      os_crypt?: { encrypted_key?: string };
    };
    const encryptedKey = localState.os_crypt?.encrypted_key;
    if (!encryptedKey) throw new Error("Missing Cursor profile key");
    const key = readWindowsProfileKey(encryptedKey);
    const decipher = createDecipheriv("aes-256-gcm", key, ciphertext.subarray(3, 15));
    decipher.setAuthTag(ciphertext.subarray(-16));
    return Buffer.concat([decipher.update(ciphertext.subarray(15, -16)), decipher.final()]).toString("utf8");
  } catch {
    throw new Error("Could not decrypt Cursor login state. Open Cursor and check your sign-in, then refresh Tokn.");
  }
}

function readWindowsProfileKey(encryptedKey: string): Buffer {
  if (cachedProfileKey?.encryptedKey === encryptedKey) return cachedProfileKey.key;
  const protectedKey = Buffer.from(encryptedKey, "base64");
  if (protectedKey.subarray(0, 5).toString("ascii") !== "DPAPI") {
    throw new Error("Unsupported Cursor profile key");
  }
  const powershell = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const encodedKey = execFileSync(powershell, ["-NoProfile", "-NonInteractive", "-Command", [
    "Add-Type -AssemblyName System.Security",
    "$encrypted = [Convert]::FromBase64String([Console]::In.ReadToEnd())",
    "$clear = [System.Security.Cryptography.ProtectedData]::Unprotect($encrypted, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)",
    "[Console]::Out.Write([Convert]::ToBase64String($clear))",
  ].join("; ")], {
    input: protectedKey.subarray(5).toString("base64"),
    encoding: "utf8",
    windowsHide: true,
    timeout: 10_000,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const key = Buffer.from(encodedKey.trim(), "base64");
  if (key.length !== 32) throw new Error("Invalid Cursor profile key");
  cachedProfileKey = { encryptedKey, key };
  return key;
}
