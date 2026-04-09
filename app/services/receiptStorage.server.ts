import { createHmac, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { PutObjectCommand, DeleteObjectCommand, GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { DEV_RECEIPT_ROUTE_PATH } from "../utils/receipt-routes";

export type ReceiptStorageDriver = "s3" | "local" | "memory";

export type ReceiptStoragePutInput = {
  key: string;
  body: Uint8Array;
  contentType: string;
};

export type ReceiptStorageGetUrlInput = {
  key: string;
  expiresInSeconds: number;
};

export interface ReceiptStorage {
  put(input: ReceiptStoragePutInput): Promise<{ key: string }>;
  getSignedReadUrl(input: ReceiptStorageGetUrlInput): Promise<string>;
  delete(input: { key: string }): Promise<void>;
}

type LocalReceiptMetadata = {
  contentType: string;
};

const DEFAULT_LOCAL_STORAGE_DIR = ".storage/receipts";
const DEFAULT_SIGNED_URL_TTL_SECONDS = 60 * 60;

function getReceiptStorageDriver(): ReceiptStorageDriver {
  const raw = (process.env.RECEIPT_STORAGE_DRIVER ?? "local").trim().toLowerCase();
  if (raw === "s3" || raw === "local" || raw === "memory") return raw;
  throw new Error(`Unsupported receipt storage driver: ${raw}`);
}

function getAppBaseUrl() {
  const value = process.env.SHOPIFY_APP_URL || process.env.HOST || "http://localhost:3000";
  return value.replace(/\/+$/, "");
}

function getReceiptSigningSecret() {
  return (
    process.env.RECEIPT_STORAGE_SIGNING_SECRET ||
    process.env.SHOPIFY_API_SECRET ||
    process.env.SHOPIFY_API_KEY ||
    "dev-only-receipt-storage-secret"
  );
}

function createReceiptSignature(key: string, expires: number) {
  return createHmac("sha256", getReceiptSigningSecret())
    .update(`${key}:${expires}`)
    .digest("hex");
}

export function verifyReceiptSignature(key: string, expires: number, signature: string) {
  const expected = createReceiptSignature(key, expires);
  const a = Buffer.from(signature, "hex");
  const b = Buffer.from(expected, "hex");

  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function getLocalStorageRoot() {
  return path.resolve(process.cwd(), process.env.RECEIPT_STORAGE_LOCAL_DIR ?? DEFAULT_LOCAL_STORAGE_DIR);
}

function assertSafeStorageKey(key: string) {
  if (!key || key.includes("..") || path.isAbsolute(key)) {
    throw new Error("Invalid receipt storage key.");
  }
}

function getLocalReceiptFilePath(key: string) {
  assertSafeStorageKey(key);
  return path.join(getLocalStorageRoot(), key);
}

function getLocalReceiptMetadataPath(key: string) {
  return `${getLocalReceiptFilePath(key)}.meta.json`;
}

async function ensureParentDir(filePath: string) {
  await mkdir(path.dirname(filePath), { recursive: true });
}

async function writeLocalReceiptFile(input: ReceiptStoragePutInput) {
  const filePath = getLocalReceiptFilePath(input.key);
  const metadataPath = getLocalReceiptMetadataPath(input.key);
  await ensureParentDir(filePath);
  await writeFile(filePath, input.body);
  await writeFile(
    metadataPath,
    JSON.stringify({ contentType: input.contentType } satisfies LocalReceiptMetadata),
    "utf8",
  );
  return { key: input.key };
}

async function readLocalReceiptMetadata(key: string): Promise<LocalReceiptMetadata> {
  const metadataPath = getLocalReceiptMetadataPath(key);
  const raw = await readFile(metadataPath, "utf8");
  const parsed = JSON.parse(raw) as LocalReceiptMetadata;
  return {
    contentType: parsed.contentType || "application/octet-stream",
  };
}

async function deleteLocalReceiptFile(key: string) {
  await rm(getLocalReceiptFilePath(key), { force: true });
  await rm(getLocalReceiptMetadataPath(key), { force: true });
}

export async function readLocalReceiptFile(key: string) {
  const filePath = getLocalReceiptFilePath(key);
  const [buffer, metadata, fileStat] = await Promise.all([
    readFile(filePath),
    readLocalReceiptMetadata(key),
    stat(filePath),
  ]);

  return {
    body: buffer,
    contentType: metadata.contentType,
    size: fileStat.size,
  };
}

class LocalReceiptStorage implements ReceiptStorage {
  async put(input: ReceiptStoragePutInput) {
    return writeLocalReceiptFile(input);
  }

  async getSignedReadUrl(input: ReceiptStorageGetUrlInput) {
    const expires = Math.floor(Date.now() / 1000) + (input.expiresInSeconds || DEFAULT_SIGNED_URL_TTL_SECONDS);
    const signature = createReceiptSignature(input.key, expires);
    const params = new URLSearchParams({
      key: input.key,
      expires: String(expires),
      signature,
    });
    return `${getAppBaseUrl()}${DEV_RECEIPT_ROUTE_PATH}?${params.toString()}`;
  }

  async delete(input: { key: string }) {
    await deleteLocalReceiptFile(input.key);
  }
}

class MemoryReceiptStorage implements ReceiptStorage {
  private store = new Map<string, { body: Uint8Array; contentType: string }>();

  async put(input: ReceiptStoragePutInput) {
    this.store.set(input.key, { body: input.body, contentType: input.contentType });
    return { key: input.key };
  }

  async getSignedReadUrl(input: ReceiptStorageGetUrlInput) {
    return `memory://receipt/${encodeURIComponent(input.key)}?ttl=${input.expiresInSeconds}`;
  }

  async delete(input: { key: string }) {
    this.store.delete(input.key);
  }
}

class S3ReceiptStorage implements ReceiptStorage {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor() {
    const bucket = process.env.RECEIPT_STORAGE_BUCKET?.trim();
    if (!bucket) {
      throw new Error("RECEIPT_STORAGE_BUCKET is required for S3 receipt storage.");
    }

    this.bucket = bucket;
    this.client = new S3Client({
      region: process.env.RECEIPT_STORAGE_REGION || "us-east-1",
      endpoint: process.env.RECEIPT_STORAGE_ENDPOINT || undefined,
      forcePathStyle: process.env.RECEIPT_STORAGE_FORCE_PATH_STYLE === "true",
      credentials:
        process.env.RECEIPT_STORAGE_ACCESS_KEY_ID && process.env.RECEIPT_STORAGE_SECRET_ACCESS_KEY
          ? {
              accessKeyId: process.env.RECEIPT_STORAGE_ACCESS_KEY_ID,
              secretAccessKey: process.env.RECEIPT_STORAGE_SECRET_ACCESS_KEY,
            }
          : undefined,
    });
  }

  async put(input: ReceiptStoragePutInput) {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: input.key,
        Body: input.body,
        ContentType: input.contentType,
      }),
    );

    return { key: input.key };
  }

  async getSignedReadUrl(input: ReceiptStorageGetUrlInput) {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: input.key,
      }),
      { expiresIn: input.expiresInSeconds || DEFAULT_SIGNED_URL_TTL_SECONDS },
    );
  }

  async delete(input: { key: string }) {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: input.key,
      }),
    );
  }
}

let memoryReceiptStorageSingleton: MemoryReceiptStorage | undefined;

export function createReceiptStorage(): ReceiptStorage {
  const driver = getReceiptStorageDriver();
  if (driver === "s3") return new S3ReceiptStorage();
  if (driver === "memory") {
    memoryReceiptStorageSingleton ??= new MemoryReceiptStorage();
    return memoryReceiptStorageSingleton;
  }
  return new LocalReceiptStorage();
}

export function buildDisbursementReceiptKey(input: {
  shopId: string;
  periodId: string;
  disbursementId: string;
  filename: string;
}) {
  const safeFilename = input.filename
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/\.{2,}/g, "-")
    .replace(/^\.+/, "")
    .replace(/^[-_]+/, "")
    .replace(/[-_]+\./g, ".")
    .slice(0, 120) || "receipt";
  return [
    input.shopId.replace(/[^a-zA-Z0-9._-]/g, "-"),
    "disbursements",
    input.periodId.replace(/[^a-zA-Z0-9._-]/g, "-"),
    input.disbursementId,
    safeFilename,
  ].join("/");
}
