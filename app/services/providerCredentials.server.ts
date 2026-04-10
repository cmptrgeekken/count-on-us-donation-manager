import crypto from "node:crypto";

function getProviderCredentialsSecret() {
  return (
    process.env.PROVIDER_CREDENTIALS_SECRET ||
    (process.env.NODE_ENV === "production" ? undefined : "dev-only-provider-credentials-secret")
  );
}

function getKey() {
  const secret = getProviderCredentialsSecret();
  if (!secret) {
    throw new Error("PROVIDER_CREDENTIALS_SECRET is required to store provider credentials.");
  }

  return crypto.createHash("sha256").update(secret).digest();
}

export function encryptProviderCredential(plaintext: string) {
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [iv.toString("base64"), tag.toString("base64"), ciphertext.toString("base64")].join(".");
}

export function decryptProviderCredential(payload: string) {
  const key = getKey();
  const [ivPart, tagPart, ciphertextPart] = payload.split(".");
  if (!ivPart || !tagPart || !ciphertextPart) {
    throw new Error("Invalid provider credential payload.");
  }

  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivPart, "base64"));
  decipher.setAuthTag(Buffer.from(tagPart, "base64"));

  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextPart, "base64")),
    decipher.final(),
  ]);

  return plaintext.toString("utf8");
}
