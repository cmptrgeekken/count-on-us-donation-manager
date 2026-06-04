import { createHmac, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { DEV_ARTIST_SUBMISSION_FILE_ROUTE_PATH } from "../utils/artist-submission-routes";

type ArtistSubmissionStorageDriver = "s3" | "local" | "memory";

type PutInput = {
  key: string;
  body: Uint8Array;
  contentType: string;
};

type ReadResult = {
  body: Buffer;
  contentType: string;
  size: number;
};

export interface ArtistSubmissionStorage {
  put(input: PutInput): Promise<{ key: string }>;
  getSignedReadUrl(input: { key: string; expiresInSeconds: number }): Promise<string>;
  delete(input: { key: string }): Promise<void>;
}

const DEFAULT_LOCAL_STORAGE_DIR = ".storage/artist-submissions";
const DEFAULT_SIGNED_URL_TTL_SECONDS = 15 * 60;

function getDriver(): ArtistSubmissionStorageDriver {
  const raw = (process.env.ARTIST_SUBMISSION_STORAGE_DRIVER ?? process.env.RECEIPT_STORAGE_DRIVER ?? "local").trim().toLowerCase();
  if (raw === "s3" || raw === "local" || raw === "memory") return raw;
  throw new Error(`Unsupported artist submission storage driver: ${raw}`);
}

function getAppBaseUrl() {
  const value = process.env.SHOPIFY_APP_URL || process.env.HOST || "http://localhost:3000";
  return value.replace(/\/+$/, "");
}

function getSigningSecret() {
  return (
    process.env.ARTIST_SUBMISSION_STORAGE_SIGNING_SECRET ||
    process.env.RECEIPT_STORAGE_SIGNING_SECRET ||
    process.env.SHOPIFY_API_SECRET ||
    process.env.SHOPIFY_API_KEY ||
    "dev-only-artist-submission-storage-secret"
  );
}

function createSignature(key: string, expires: number) {
  return createHmac("sha256", getSigningSecret()).update(`${key}:${expires}`).digest("hex");
}

export function verifyArtistSubmissionFileSignature(key: string, expires: number, signature: string) {
  const expected = createSignature(key, expires);
  const a = Buffer.from(signature, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function assertSafeStorageKey(key: string) {
  if (!key || key.includes("..") || path.isAbsolute(key)) {
    throw new Error("Invalid artist submission storage key.");
  }
}

function getLocalStorageRoot() {
  return path.resolve(process.cwd(), process.env.ARTIST_SUBMISSION_STORAGE_LOCAL_DIR ?? DEFAULT_LOCAL_STORAGE_DIR);
}

function getLocalFilePath(key: string) {
  assertSafeStorageKey(key);
  return path.join(getLocalStorageRoot(), key);
}

function getLocalMetadataPath(key: string) {
  return `${getLocalFilePath(key)}.meta.json`;
}

async function ensureParentDir(filePath: string) {
  await mkdir(path.dirname(filePath), { recursive: true });
}

async function readLocalArtistSubmissionFile(key: string): Promise<ReadResult> {
  const filePath = getLocalFilePath(key);
  const [body, metadata, fileStat] = await Promise.all([
    readFile(filePath),
    readFile(getLocalMetadataPath(key), "utf8").then((raw) => JSON.parse(raw) as { contentType?: string }),
    stat(filePath),
  ]);

  return {
    body,
    contentType: metadata.contentType || "application/octet-stream",
    size: fileStat.size,
  };
}

class LocalArtistSubmissionStorage implements ArtistSubmissionStorage {
  async put(input: PutInput) {
    const filePath = getLocalFilePath(input.key);
    await ensureParentDir(filePath);
    await writeFile(filePath, input.body);
    await writeFile(getLocalMetadataPath(input.key), JSON.stringify({ contentType: input.contentType }), "utf8");
    return { key: input.key };
  }

  async getSignedReadUrl(input: { key: string; expiresInSeconds: number }) {
    const expires = Math.floor(Date.now() / 1000) + (input.expiresInSeconds || DEFAULT_SIGNED_URL_TTL_SECONDS);
    const signature = createSignature(input.key, expires);
    const params = new URLSearchParams({
      key: input.key,
      expires: String(expires),
      signature,
    });
    return `${getAppBaseUrl()}${DEV_ARTIST_SUBMISSION_FILE_ROUTE_PATH}?${params.toString()}`;
  }

  async delete(input: { key: string }) {
    await rm(getLocalFilePath(input.key), { force: true });
    await rm(getLocalMetadataPath(input.key), { force: true });
  }
}

class MemoryArtistSubmissionStorage implements ArtistSubmissionStorage {
  private store = new Map<string, { body: Uint8Array; contentType: string }>();

  async put(input: PutInput) {
    this.store.set(input.key, { body: input.body, contentType: input.contentType });
    return { key: input.key };
  }

  async getSignedReadUrl(input: { key: string; expiresInSeconds: number }) {
    return `memory://artist-submission/${encodeURIComponent(input.key)}?ttl=${input.expiresInSeconds}`;
  }

  async delete(input: { key: string }) {
    this.store.delete(input.key);
  }
}

class S3ArtistSubmissionStorage implements ArtistSubmissionStorage {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor() {
    const bucket = process.env.ARTIST_SUBMISSION_STORAGE_BUCKET?.trim() || process.env.RECEIPT_STORAGE_BUCKET?.trim();
    if (!bucket) {
      throw new Error("ARTIST_SUBMISSION_STORAGE_BUCKET is required for S3 artist submission storage.");
    }

    this.bucket = bucket;
    this.client = new S3Client({
      region: process.env.ARTIST_SUBMISSION_STORAGE_REGION || process.env.RECEIPT_STORAGE_REGION || "us-east-1",
      endpoint: process.env.ARTIST_SUBMISSION_STORAGE_ENDPOINT || process.env.RECEIPT_STORAGE_ENDPOINT || undefined,
      forcePathStyle: (process.env.ARTIST_SUBMISSION_STORAGE_FORCE_PATH_STYLE || process.env.RECEIPT_STORAGE_FORCE_PATH_STYLE) === "true",
      credentials:
        (process.env.ARTIST_SUBMISSION_STORAGE_ACCESS_KEY_ID || process.env.RECEIPT_STORAGE_ACCESS_KEY_ID) &&
        (process.env.ARTIST_SUBMISSION_STORAGE_SECRET_ACCESS_KEY || process.env.RECEIPT_STORAGE_SECRET_ACCESS_KEY)
          ? {
              accessKeyId: process.env.ARTIST_SUBMISSION_STORAGE_ACCESS_KEY_ID || process.env.RECEIPT_STORAGE_ACCESS_KEY_ID || "",
              secretAccessKey: process.env.ARTIST_SUBMISSION_STORAGE_SECRET_ACCESS_KEY || process.env.RECEIPT_STORAGE_SECRET_ACCESS_KEY || "",
            }
          : undefined,
    });
  }

  async put(input: PutInput) {
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

  async getSignedReadUrl(input: { key: string; expiresInSeconds: number }) {
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

let memoryStorage: MemoryArtistSubmissionStorage | undefined;

export function createArtistSubmissionStorage(): ArtistSubmissionStorage {
  const driver = getDriver();
  if (driver === "s3") return new S3ArtistSubmissionStorage();
  if (driver === "memory") {
    memoryStorage ??= new MemoryArtistSubmissionStorage();
    return memoryStorage;
  }
  return new LocalArtistSubmissionStorage();
}

export async function readSignedLocalArtistSubmissionFile(input: {
  key: string;
  expires: number;
  signature: string;
}) {
  if (input.expires < Math.floor(Date.now() / 1000)) {
    throw new Response("Link expired.", { status: 410 });
  }

  if (!verifyArtistSubmissionFileSignature(input.key, input.expires, input.signature)) {
    throw new Response("Invalid file signature.", { status: 403 });
  }

  return readLocalArtistSubmissionFile(input.key);
}
