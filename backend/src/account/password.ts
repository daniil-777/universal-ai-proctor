import crypto from "node:crypto";

const PARAMETERS = Object.freeze({ N: 131072, r: 8, p: 1, maxmem: 192 * 1024 * 1024 });
const KEY_BYTES = 64;
let activeHashes = 0;

// Never block the event loop with password work, or allow unbounded 128 MB jobs.
async function derive(password: string, salt: Buffer): Promise<Buffer> {
  if (activeHashes >= 2)
    throw Object.assign(new Error("Sign-in is temporarily busy. Please try again."), { statusCode: 429 });
  activeHashes++;
  try {
    return await new Promise<Buffer>((resolve, reject) => {
      crypto.scrypt(password, salt, KEY_BYTES, PARAMETERS, (error, key) => error ? reject(error) : resolve(key));
    });
  } finally { activeHashes--; }
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const key = await derive(password, salt);
  return `scrypt$${PARAMETERS.N}$${PARAMETERS.r}$${PARAMETERS.p}$${salt.toString("hex")}$${key.toString("hex")}`;
}

// Unknown accounts perform the same expensive derivation as known accounts.
const DUMMY_HASH = `scrypt$${PARAMETERS.N}$${PARAMETERS.r}$${PARAMETERS.p}$${"00".repeat(16)}$${"00".repeat(KEY_BYTES)}`;
export async function verifyPassword(password: string, encoded?: string): Promise<boolean> {
  const fields = (encoded || DUMMY_HASH).split("$");
  const valid = fields.length === 6 && fields[0] === "scrypt" && fields[1] === String(PARAMETERS.N) &&
    fields[2] === String(PARAMETERS.r) && fields[3] === String(PARAMETERS.p) && /^[a-f0-9]{32}$/.test(fields[4] || "") && /^[a-f0-9]{128}$/.test(fields[5] || "");
  const usable = valid ? fields : DUMMY_HASH.split("$");
  const actual = await derive(password, Buffer.from(usable[4]!, "hex"));
  const expected = Buffer.from(usable[5]!, "hex");
  return !!encoded && valid && crypto.timingSafeEqual(actual, expected);
}
