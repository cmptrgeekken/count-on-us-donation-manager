import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

type PublicIconStorageDriver = "s3" | "local" | "memory";
type PublicIconOwnerType = "artist" | "cause";

type PutInput = {
  key: string;
  body: Uint8Array;
  contentType: string;
};

export type PublicIconReadResult = {
  body: Uint8Array;
  contentType: string;
  size: number;
};

export class PublicIconUploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PublicIconUploadError";
  }
}

interface PublicIconStorage {
  put(input: PutInput): Promise<{ key: string }>;
  read(input: { key: string }): Promise<PublicIconReadResult>;
  delete(input: { key: string }): Promise<void>;
}

const DEFAULT_LOCAL_STORAGE_DIR = ".storage/public-icons";
const MAX_ICON_BYTES = 5 * 1024 * 1024;
const allowedIconTypes = new Map([
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
  ["image/webp", "webp"],
]);

function getDriver(): PublicIconStorageDriver {
  const raw = (
    process.env.PUBLIC_ICON_STORAGE_DRIVER ??
    process.env.ARTIST_SUBMISSION_STORAGE_DRIVER ??
    process.env.RECEIPT_STORAGE_DRIVER ??
    "local"
  ).trim().toLowerCase();
  if (raw === "s3" || raw === "local" || raw === "memory") return raw;
  throw new Error(`Unsupported public icon storage driver: ${raw}`);
}

function getS3Client(): { client: S3Client; bucket: string } {
  const bucket =
    process.env.PUBLIC_ICON_STORAGE_BUCKET?.trim() ||
    process.env.ARTIST_SUBMISSION_STORAGE_BUCKET?.trim() ||
    process.env.RECEIPT_STORAGE_BUCKET?.trim();
  if (!bucket) {
    throw new Error("PUBLIC_ICON_STORAGE_BUCKET is required for S3 public icon storage.");
  }

  return {
    bucket,
    client: new S3Client({
      region:
        process.env.PUBLIC_ICON_STORAGE_REGION ||
        process.env.ARTIST_SUBMISSION_STORAGE_REGION ||
        process.env.RECEIPT_STORAGE_REGION ||
        "us-east-1",
      endpoint:
        process.env.PUBLIC_ICON_STORAGE_ENDPOINT ||
        process.env.ARTIST_SUBMISSION_STORAGE_ENDPOINT ||
        process.env.RECEIPT_STORAGE_ENDPOINT ||
        undefined,
      forcePathStyle:
        (process.env.PUBLIC_ICON_STORAGE_FORCE_PATH_STYLE ||
          process.env.ARTIST_SUBMISSION_STORAGE_FORCE_PATH_STYLE ||
          process.env.RECEIPT_STORAGE_FORCE_PATH_STYLE) === "true",
      credentials:
        (process.env.PUBLIC_ICON_STORAGE_ACCESS_KEY_ID ||
          process.env.ARTIST_SUBMISSION_STORAGE_ACCESS_KEY_ID ||
          process.env.RECEIPT_STORAGE_ACCESS_KEY_ID) &&
        (process.env.PUBLIC_ICON_STORAGE_SECRET_ACCESS_KEY ||
          process.env.ARTIST_SUBMISSION_STORAGE_SECRET_ACCESS_KEY ||
          process.env.RECEIPT_STORAGE_SECRET_ACCESS_KEY)
          ? {
              accessKeyId:
                process.env.PUBLIC_ICON_STORAGE_ACCESS_KEY_ID ||
                process.env.ARTIST_SUBMISSION_STORAGE_ACCESS_KEY_ID ||
                process.env.RECEIPT_STORAGE_ACCESS_KEY_ID ||
                "",
              secretAccessKey:
                process.env.PUBLIC_ICON_STORAGE_SECRET_ACCESS_KEY ||
                process.env.ARTIST_SUBMISSION_STORAGE_SECRET_ACCESS_KEY ||
                process.env.RECEIPT_STORAGE_SECRET_ACCESS_KEY ||
                "",
            }
          : undefined,
    }),
  };
}

function assertSafeStorageKey(key: string) {
  if (!key || key.includes("..") || path.isAbsolute(key)) {
    throw new Error("Invalid public icon storage key.");
  }
}

function getLocalStorageRoot() {
  return path.resolve(process.cwd(), process.env.PUBLIC_ICON_STORAGE_LOCAL_DIR ?? DEFAULT_LOCAL_STORAGE_DIR);
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

class LocalPublicIconStorage implements PublicIconStorage {
  async put(input: PutInput) {
    const filePath = getLocalFilePath(input.key);
    await ensureParentDir(filePath);
    await writeFile(filePath, input.body);
    await writeFile(getLocalMetadataPath(input.key), JSON.stringify({ contentType: input.contentType }), "utf8");
    return { key: input.key };
  }

  async read(input: { key: string }) {
    const filePath = getLocalFilePath(input.key);
    const [body, metadata, fileStat] = await Promise.all([
      readFile(filePath),
      readFile(getLocalMetadataPath(input.key), "utf8").then((raw) => JSON.parse(raw) as { contentType?: string }),
      stat(filePath),
    ]);
    return {
      body,
      contentType: metadata.contentType || "application/octet-stream",
      size: fileStat.size,
    };
  }

  async delete(input: { key: string }) {
    await rm(getLocalFilePath(input.key), { force: true });
    await rm(getLocalMetadataPath(input.key), { force: true });
  }
}

class MemoryPublicIconStorage implements PublicIconStorage {
  private store = new Map<string, { body: Uint8Array; contentType: string }>();

  async put(input: PutInput) {
    this.store.set(input.key, { body: input.body, contentType: input.contentType });
    return { key: input.key };
  }

  async read(input: { key: string }) {
    const item = this.store.get(input.key);
    if (!item) throw new Response("Icon not found.", { status: 404 });
    return {
      body: item.body,
      contentType: item.contentType,
      size: item.body.byteLength,
    };
  }

  async delete(input: { key: string }) {
    this.store.delete(input.key);
  }
}

type TransformableBody = {
  transformToByteArray: () => Promise<Uint8Array>;
};

function hasTransformableBody(value: unknown): value is TransformableBody {
  return (
    typeof value === "object" &&
    value !== null &&
    "transformToByteArray" in value &&
    typeof (value as { transformToByteArray?: unknown }).transformToByteArray === "function"
  );
}

class S3PublicIconStorage implements PublicIconStorage {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor() {
    const config = getS3Client();
    this.client = config.client;
    this.bucket = config.bucket;
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

  async read(input: { key: string }) {
    const response = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: input.key,
      }),
    );
    if (!response.Body || !hasTransformableBody(response.Body)) {
      throw new Response("Icon is unavailable.", { status: 404 });
    }
    const body = await response.Body.transformToByteArray();
    return {
      body,
      contentType: response.ContentType || "application/octet-stream",
      size: Number(response.ContentLength ?? body.byteLength),
    };
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

let memoryStorage: MemoryPublicIconStorage | undefined;

function createPublicIconStorage(): PublicIconStorage {
  const driver = getDriver();
  if (driver === "s3") return new S3PublicIconStorage();
  if (driver === "memory") {
    memoryStorage ??= new MemoryPublicIconStorage();
    return memoryStorage;
  }
  return new LocalPublicIconStorage();
}

function safeStoragePart(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, "-").replace(/^-+|-+$/g, "") || "asset";
}

function buildPublicIconKey(input: {
  shopId: string;
  ownerType: PublicIconOwnerType;
  ownerId: string;
  extension: string;
}) {
  return [
    safeStoragePart(input.shopId),
    "public-icons",
    input.ownerType,
    safeStoragePart(input.ownerId),
    `${randomUUID()}.${input.extension}`,
  ].join("/");
}

export function getPublicIconUrl(input: {
  type: PublicIconOwnerType;
  id: string;
  proxyBase?: string;
  shopDomain?: string;
  version?: string | null;
}) {
  const params = new URLSearchParams({ type: input.type, id: input.id });
  if (input.version) params.set("v", input.version);
  const proxyBase = input.proxyBase ?? "/apps/count-on-us";
  const path = `${proxyBase}/icons?${params.toString()}`;
  return input.shopDomain ? `https://${input.shopDomain}${path}` : path;
}

export function getUploadedIconFile(formData: FormData, fieldName = "iconFile"): File | null {
  const value = formData.get(fieldName);
  if (
    value &&
    typeof value === "object" &&
    "arrayBuffer" in value &&
    "name" in value &&
    "type" in value &&
    "size" in value
  ) {
    const file = value as File;
    return file.size > 0 ? file : null;
  }
  return null;
}

export async function uploadPublicIcon(input: {
  shopId: string;
  ownerType: PublicIconOwnerType;
  ownerId: string;
  file: File;
}) {
  const contentType = (input.file.type || "application/octet-stream").toLowerCase();
  const extension = allowedIconTypes.get(contentType);
  if (!extension) {
    throw new PublicIconUploadError("Icon must be a PNG, JPEG, or WebP image.");
  }
  if (input.file.size > MAX_ICON_BYTES) {
    throw new PublicIconUploadError("Icon must be 5 MB or smaller.");
  }

  const storage = createPublicIconStorage();
  const key = buildPublicIconKey({
    shopId: input.shopId,
    ownerType: input.ownerType,
    ownerId: input.ownerId,
    extension,
  });
  await storage.put({
    key,
    body: new Uint8Array(await input.file.arrayBuffer()),
    contentType,
  });
  return { key };
}

export async function readPublicIcon(key: string) {
  const storage = createPublicIconStorage();
  return storage.read({ key });
}

export async function deletePublicIcon(key: string | null | undefined) {
  if (!key) return;
  const storage = createPublicIconStorage();
  await storage.delete({ key });
}
