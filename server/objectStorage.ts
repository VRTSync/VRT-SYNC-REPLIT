import {
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl as awsGetSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Response } from "express";
import { randomUUID } from "crypto";
import { s3Client, S3_BUCKET_NAME } from "./s3Config";
import {
  ObjectAclPolicy,
  ObjectPermission,
  canAccessObject,
  getObjectAclPolicy,
  setObjectAclPolicy,
} from "./objectAcl";

// ---------------------------------------------------------------------------
// Re-export client for legacy callers (exportGenerator.ts uses objectStorageClient)
// ---------------------------------------------------------------------------

/** @deprecated Use uploadObject / getSignedUrl / deleteObject helpers instead. */
export const objectStorageClient = s3Client;

// ---------------------------------------------------------------------------
// Custom Errors
// ---------------------------------------------------------------------------

export class ObjectNotFoundError extends Error {
  constructor() {
    super("Object not found");
    this.name = "ObjectNotFoundError";
    Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
  }
}

// ---------------------------------------------------------------------------
// Public API helpers used by routes for contractor photo uploads, etc.
// ---------------------------------------------------------------------------

/**
 * Upload a Buffer to S3.
 * @param key         S3 object key, e.g. "uploads/abc123.jpg"
 * @param buffer      File contents
 * @param contentType MIME type, e.g. "image/jpeg"
 */
export async function uploadObject(
  key: string,
  buffer: Buffer,
  contentType: string,
): Promise<void> {
  try {
    await s3Client.send(
      new PutObjectCommand({
        Bucket: S3_BUCKET_NAME,
        Key: key,
        Body: buffer,
        ContentType: contentType,
      }),
    );
    console.log(`[objectStorage] Uploaded: ${key}`);
  } catch (error) {
    console.error(`[objectStorage] Failed to upload ${key}:`, error);
    throw error;
  }
}

/**
 * Generate a pre-signed GET URL for a private S3 object.
 * @param key    S3 object key
 * @param ttlSec URL expiry in seconds (default 900 = 15 min)
 */
export async function getSignedUrl(
  key: string,
  ttlSec: number = 900,
): Promise<string> {
  try {
    const command = new GetObjectCommand({
      Bucket: S3_BUCKET_NAME,
      Key: key,
    });
    return awsGetSignedUrl(s3Client, command, { expiresIn: ttlSec });
  } catch (error) {
    console.error(`[objectStorage] Failed to sign URL for ${key}:`, error);
    throw error;
  }
}

/**
 * Delete an object from S3 by key.
 */
export async function deleteObject(key: string): Promise<void> {
  try {
    await s3Client.send(
      new DeleteObjectCommand({ Bucket: S3_BUCKET_NAME, Key: key }),
    );
    console.log(`[objectStorage] Deleted: ${key}`);
  } catch (error) {
    console.error(`[objectStorage] Failed to delete ${key}:`, error);
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Convert a legacy "/bucket/path/to/object" style path to an S3 key.
 * The bucket-name segment is stripped; the actual bucket is S3_BUCKET_NAME.
 */
function objectPathToKey(path: string): string {
  if (!path.startsWith("/")) path = `/${path}`;
  const parts = path.split("/");
  if (parts.length < 3) {
    throw new Error("Invalid object path: must contain at least a bucket name");
  }
  return parts.slice(2).join("/");
}

async function s3ObjectExists(key: string): Promise<boolean> {
  try {
    await s3Client.send(
      new HeadObjectCommand({ Bucket: S3_BUCKET_NAME, Key: key }),
    );
    return true;
  } catch {
    return false;
  }
}

async function s3GetObjectMetadata(key: string): Promise<{
  contentType?: string;
  contentLength?: number;
}> {
  const res = await s3Client.send(
    new HeadObjectCommand({ Bucket: S3_BUCKET_NAME, Key: key }),
  );
  return {
    contentType: res.ContentType,
    contentLength: res.ContentLength,
  };
}

async function s3DownloadObjectStream(
  key: string,
): Promise<NodeJS.ReadableStream> {
  const res = await s3Client.send(
    new GetObjectCommand({ Bucket: S3_BUCKET_NAME, Key: key }),
  );
  if (!res.Body) throw new Error("Empty response body from S3");
  return res.Body as unknown as NodeJS.ReadableStream;
}

async function signPutUrl(key: string, ttlSec: number): Promise<string> {
  const command = new PutObjectCommand({ Bucket: S3_BUCKET_NAME, Key: key });
  return awsGetSignedUrl(s3Client, command, { expiresIn: ttlSec });
}

// ---------------------------------------------------------------------------
// ObjectStorageService — same API surface as the legacy Replit/GCS version
// ---------------------------------------------------------------------------

export class ObjectStorageService {
  constructor() {}

  getPublicObjectSearchPaths(): Array<string> {
    const pathsStr = process.env.PUBLIC_OBJECT_SEARCH_PATHS || "";
    const paths = Array.from(
      new Set(
        pathsStr
          .split(",")
          .map((p) => p.trim())
          .filter((p) => p.length > 0),
      ),
    );
    if (paths.length === 0) {
      throw new Error(
        "PUBLIC_OBJECT_SEARCH_PATHS not set. Set this env var to a comma-separated " +
          "list of S3 key prefixes (e.g. 'public/assets,public/cdn').",
      );
    }
    return paths;
  }

  getPrivateObjectDir(): string {
    const dir = process.env.PRIVATE_OBJECT_DIR || "";
    if (!dir) {
      throw new Error(
        "PRIVATE_OBJECT_DIR not set. Set this env var to the S3 key prefix for " +
          "private objects (e.g. 'private').",
      );
    }
    return dir;
  }

  /**
   * Search public S3 key prefixes for a file.
   * Returns an S3 key string on success, or null if not found.
   */
  async searchPublicObject(filePath: string): Promise<string | null> {
    for (const searchPath of this.getPublicObjectSearchPaths()) {
      let prefix: string;
      if (searchPath.startsWith("/")) {
        // Legacy GCS-style path like "/bucket-name/prefix"
        prefix = `${objectPathToKey(searchPath)}/${filePath}`;
      } else {
        prefix = `${searchPath}/${filePath}`;
      }
      if (await s3ObjectExists(prefix)) return prefix;
    }
    return null;
  }

  /**
   * Stream an S3 object to an Express response.
   * `fileRef` is an S3 key string.
   */
  async downloadObject(
    fileRef: string,
    res: Response,
    cacheTtlSec: number = 3600,
  ): Promise<void> {
    try {
      const meta = await s3GetObjectMetadata(fileRef);
      const aclPolicy = await getObjectAclPolicy(fileRef);
      const isPublic = aclPolicy?.visibility === "public";

      res.set({
        "Content-Type": meta.contentType || "application/octet-stream",
        ...(meta.contentLength !== undefined
          ? { "Content-Length": String(meta.contentLength) }
          : {}),
        "Cache-Control": `${isPublic ? "public" : "private"}, max-age=${cacheTtlSec}`,
      });

      const stream = await s3DownloadObjectStream(fileRef);
      stream.on("error", (err) => {
        console.error("[objectStorage] Stream error:", err);
        if (!res.headersSent) {
          res.status(500).json({ error: "Error streaming file" });
        }
      });
      (stream as any).pipe(res);
    } catch (error) {
      console.error("[objectStorage] Error downloading file:", error);
      if (!res.headersSent) {
        res.status(500).json({ error: "Error downloading file" });
      }
    }
  }

  /**
   * Generate a pre-signed PUT URL for a new upload.
   */
  async getObjectEntityUploadURL(): Promise<string> {
    const privateObjectDir = this.getPrivateObjectDir();
    const objectId = randomUUID();
    const key = `${privateObjectDir}/uploads/${objectId}`;
    return signPutUrl(key, 900);
  }

  /**
   * Resolve an internal /objects/<id> path to an S3 key.
   * Throws ObjectNotFoundError if the object does not exist.
   */
  async getObjectEntityFile(objectPath: string): Promise<string> {
    if (!objectPath.startsWith("/objects/")) {
      throw new ObjectNotFoundError();
    }
    const entityId = objectPath.slice("/objects/".length);
    if (!entityId) throw new ObjectNotFoundError();

    let entityDir = this.getPrivateObjectDir();
    if (!entityDir.endsWith("/")) entityDir = `${entityDir}/`;
    const key = `${entityDir}${entityId}`;

    if (!(await s3ObjectExists(key))) throw new ObjectNotFoundError();
    return key;
  }

  /**
   * Normalise a raw URL or internal path to /objects/<id>.
   */
  normalizeObjectEntityPath(rawPath: string): string {
    // Legacy GCS URL
    if (rawPath.startsWith("https://storage.googleapis.com/")) {
      try {
        const url = new URL(rawPath);
        const rawObjectPath = url.pathname;
        let objectEntityDir = this.getPrivateObjectDir();
        if (!objectEntityDir.endsWith("/"))
          objectEntityDir = `${objectEntityDir}/`;
        if (!rawObjectPath.startsWith(objectEntityDir)) return rawObjectPath;
        const entityId = rawObjectPath.slice(objectEntityDir.length);
        return `/objects/${entityId}`;
      } catch {
        return rawPath;
      }
    }
    // S3 presigned URL
    try {
      const url = new URL(rawPath);
      if (
        url.hostname.includes("amazonaws.com") ||
        url.hostname.includes("s3.")
      ) {
        let key = url.pathname.startsWith("/")
          ? url.pathname.slice(1)
          : url.pathname;
        if (key.startsWith(`${S3_BUCKET_NAME}/`))
          key = key.slice(S3_BUCKET_NAME.length + 1);
        let entityDir = this.getPrivateObjectDir();
        if (!entityDir.endsWith("/")) entityDir = `${entityDir}/`;
        if (!key.startsWith(entityDir)) return key;
        const entityId = key.slice(entityDir.length);
        return `/objects/${entityId}`;
      }
    } catch {
      // not a URL
    }
    return rawPath;
  }

  async trySetObjectEntityAclPolicy(
    rawPath: string,
    aclPolicy: ObjectAclPolicy,
  ): Promise<string> {
    const normalizedPath = this.normalizeObjectEntityPath(rawPath);
    if (!normalizedPath.startsWith("/")) {
      return normalizedPath;
    }
    const key = await this.getObjectEntityFile(normalizedPath);
    await setObjectAclPolicy(key, aclPolicy);
    return normalizedPath;
  }

  async deleteObject(fileRef: string): Promise<void> {
    try {
      const key = await this.getObjectEntityFile(fileRef);
      await deleteObject(key);
    } catch (error) {
      if (error instanceof ObjectNotFoundError) {
        return;
      }
      throw error;
    }
  }

  async canAccessObjectEntity({
    userId,
    objectFile,
    requestedPermission,
  }: {
    userId?: string;
    objectFile: string;
    requestedPermission?: ObjectPermission;
  }): Promise<boolean> {
    return canAccessObject({
      userId,
      objectFile,
      requestedPermission: requestedPermission ?? ObjectPermission.READ,
    });
  }
}
