import crypto from "node:crypto";

const SCRYPT_KEYLEN = 64;
const SALT_BYTES = 16;

type ScryptParams = {
  N: number;
  r: number;
  p: number;
};

const DEFAULT_PARAMS: ScryptParams = {
  N: 16384,
  r: 8,
  p: 1,
};

async function scryptDeriveKey(
  password: string,
  salt: Buffer,
  keylen: number,
  params: ScryptParams,
): Promise<Buffer> {
  return await new Promise<Buffer>((resolve, reject) => {
    crypto.scrypt(
      password,
      salt,
      keylen,
      { N: params.N, r: params.r, p: params.p },
      (err, derivedKey) => {
        if (err) return reject(err);
        resolve(derivedKey as Buffer);
      },
    );
  });
}

// Format: scrypt$N$r$p$saltB64$hashB64
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(SALT_BYTES);
  const derivedKey = await scryptDeriveKey(
    password,
    salt,
    SCRYPT_KEYLEN,
    DEFAULT_PARAMS,
  );

  return [
    "scrypt",
    String(DEFAULT_PARAMS.N),
    String(DEFAULT_PARAMS.r),
    String(DEFAULT_PARAMS.p),
    salt.toString("base64"),
    derivedKey.toString("base64"),
  ].join("$");
}

export async function verifyPassword(
  password: string,
  storedHash: string,
): Promise<boolean> {
  const parts = storedHash.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  const salt = Buffer.from(parts[4], "base64");
  const expected = Buffer.from(parts[5], "base64");

  if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p)) {
    return false;
  }

  const derivedKey = await scryptDeriveKey(password, salt, expected.length, {
    N,
    r,
    p,
  });

  if (derivedKey.length !== expected.length) return false;
  return crypto.timingSafeEqual(derivedKey, expected);
}

