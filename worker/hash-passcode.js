// Prints the SHA-256 hash of the family passcode, for `npx wrangler secret put PASSCODE_HASH`.
import { createHash } from "node:crypto";
import { createInterface } from "node:readline/promises";

const rl = createInterface({ input: process.stdin, output: process.stdout });
const passcode = (await rl.question("Family passcode: ")).trim();
rl.close();
if (passcode.length < 8) {
  console.error("Use at least 8 characters; a short phrase like 'grandmas-sunday-sauce' works well.");
  process.exit(1);
}
console.log(createHash("sha256").update(passcode).digest("hex"));
