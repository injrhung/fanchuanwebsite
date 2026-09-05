#!/usr/bin/env node
// 僅供建置階段於本機執行的工具：讀取統一編號與匯款資料，
// 以 PBKDF2 + AES-GCM 加密後寫入 remittance-data.js（只包含密文）。
// 輸入內容不會被記錄、快取或傳送到任何地方。
import { webcrypto } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const { subtle } = webcrypto;
const ITERATIONS = 250000;
const OUTPUT_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "remittance-data.js");

function toBase64(bytes) {
  return Buffer.from(bytes).toString("base64");
}

async function deriveKey(password, salt) {
  const enc = new TextEncoder();
  const keyMaterial = await subtle.importKey("raw", enc.encode(password), { name: "PBKDF2" }, false, ["deriveKey"]);
  return subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: ITERATIONS, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"]
  );
}

async function main() {
  const rl = createInterface({ input: stdin, output: stdout, terminal: Boolean(stdin.isTTY) });
  const lines = rl[Symbol.asyncIterator]();

  async function ask(question, { validate, hint } = {}) {
    for (;;) {
      stdout.write(question);
      const { value: raw, done } = await lines.next();
      if (done) throw new Error("輸入已提前結束。");
      const value = raw.trim();
      if (value && (!validate || validate(value))) return value;
      console.log(hint || "輸入格式不正確，請再試一次。");
    }
  }

  console.log("此工具僅在本機建置環境執行，輸入內容只用於產生加密檔案，不會被記錄或上傳。");
  console.log("產生後請勿將明文（統一編號、銀行資料）提交到程式碼版本庫，只需提交產生的 remittance-data.js。\n");
  try {
    const taxId = await ask("請輸入店家統一編號（8 碼數字）：", {
      validate: (v) => /^[0-9]{8}$/.test(v),
      hint: "統一編號需為 8 碼數字。"
    });
    const bankName = await ask("銀行名稱：");
    const bankCode = await ask("銀行代碼（3-4 碼數字）：", {
      validate: (v) => /^[0-9]{3,4}$/.test(v),
      hint: "銀行代碼需為 3-4 碼數字。"
    });
    const branchName = await ask("分行名稱：");
    const accountName = await ask("戶名：");
    const accountNumber = await ask("匯款帳號（6-16 碼數字）：", {
      validate: (v) => /^[0-9]{6,16}$/.test(v),
      hint: "帳號需為 6-16 碼數字。"
    });

    const record = { bankName, bankCode, branchName, accountName, accountNumber };
    const salt = webcrypto.getRandomValues(new Uint8Array(16));
    const iv = webcrypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(taxId, salt);
    const plaintext = new TextEncoder().encode(JSON.stringify(record));
    const cipherBuf = await subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);

    const payload = {
      v: 1,
      iterations: ITERATIONS,
      salt: toBase64(salt),
      iv: toBase64(iv),
      cipher: toBase64(new Uint8Array(cipherBuf))
    };

    const fileContent =
      "// 此檔案由 tools/encrypt-remittance.mjs 產生，僅包含加密後的密文。\n" +
      "// 請勿手動填入明文統一編號或銀行資料；如需更新，請重新執行該工具。\n" +
      "window.FC_REMIT_CIPHER = " + JSON.stringify(payload, null, 2) + ";\n";

    await writeFile(OUTPUT_PATH, fileContent, "utf8");
    console.log("\n已產生 remittance-data.js（僅含密文），可提交至版本庫。");
    console.log("請務必用剛輸入的統一編號在網站上測試「查看匯款帳號」功能可正確解鎖。");
  } finally {
    rl.close();
  }
}

main().catch((err) => {
  console.error("發生錯誤：", err.message);
  process.exitCode = 1;
});
