import crypto from "node:crypto";

type JwtHeader = {
  alg: "HS256";
  typ: "JWT";
};

export type JwtPayload = {
  sub: string;
  role: string;
  iat: number;
  exp: number;
};

function base64UrlEncode(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input, "utf8") : input;
  return buf
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function base64UrlDecodeToBuffer(input: string): Buffer {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padLen = (4 - (normalized.length % 4)) % 4;
  return Buffer.from(normalized + "=".repeat(padLen), "base64");
}

function jsonToB64Url(obj: unknown): string {
  return base64UrlEncode(Buffer.from(JSON.stringify(obj), "utf8"));
}

function hmacSha256(secret: string, data: string): Buffer {
  return crypto.createHmac("sha256", secret).update(data).digest();
}

export function signJwt(payload: JwtPayload, secret: string): string {
  const header: JwtHeader = { alg: "HS256", typ: "JWT" };
  const encodedHeader = jsonToB64Url(header);
  const encodedPayload = jsonToB64Url(payload);
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = base64UrlEncode(hmacSha256(secret, signingInput));
  return `${signingInput}.${signature}`;
}

export function verifyJwt(token: string, secret: string): JwtPayload {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new Error("Invalid JWT format");
  }

  const [encodedHeader, encodedPayload, encodedSig] = parts;
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  const expectedSig = hmacSha256(secret, signingInput);
  const actualSig = base64UrlDecodeToBuffer(encodedSig);

  // constant-time compare to avoid timing attacks
  if (
    actualSig.length !== expectedSig.length ||
    !crypto.timingSafeEqual(actualSig, expectedSig)
  ) {
    throw new Error("Invalid JWT signature");
  }

  const payloadJson = base64UrlDecodeToBuffer(encodedPayload).toString("utf8");
  const payload = JSON.parse(payloadJson) as JwtPayload;

  if (!payload?.sub || !payload?.exp || !payload?.iat) {
    throw new Error("Invalid JWT payload");
  }

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp <= now) {
    throw new Error("JWT expired");
  }

  return payload;
}

