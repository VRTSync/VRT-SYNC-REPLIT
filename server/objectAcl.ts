import { s3Client, S3_BUCKET_NAME } from "./s3Config";
import {
  HeadObjectCommand,
  CopyObjectCommand,
} from "@aws-sdk/client-s3";

// We store ACL policy as a custom S3 object metadata field
const ACL_POLICY_METADATA_KEY = "x-amz-meta-aclpolicy";

export enum ObjectAccessGroupType {}

export interface ObjectAccessGroup {
  type: ObjectAccessGroupType;
  id: string;
}

export enum ObjectPermission {
  READ = "read",
  WRITE = "write",
}

export interface ObjectAclRule {
  group: ObjectAccessGroup;
  permission: ObjectPermission;
}

export interface ObjectAclPolicy {
  owner: string;
  visibility: "public" | "private";
  aclRules?: Array<ObjectAclRule>;
}

function isPermissionAllowed(
  requested: ObjectPermission,
  granted: ObjectPermission,
): boolean {
  if (requested === ObjectPermission.READ) {
    return [ObjectPermission.READ, ObjectPermission.WRITE].includes(granted);
  }
  return granted === ObjectPermission.WRITE;
}

abstract class BaseObjectAccessGroup implements ObjectAccessGroup {
  constructor(
    public readonly type: ObjectAccessGroupType,
    public readonly id: string,
  ) {}
  public abstract hasMember(userId: string): Promise<boolean>;
}

function createObjectAccessGroup(
  group: ObjectAccessGroup,
): BaseObjectAccessGroup {
  switch (group.type) {
    default:
      throw new Error(`Unknown access group type: ${group.type}`);
  }
}

// ---------------------------------------------------------------------------
// S3-backed ACL helpers (objectFile is an S3 key string)
// ---------------------------------------------------------------------------

/** Read ACL policy from S3 object metadata. */
export async function getObjectAclPolicy(
  objectFile: string,
): Promise<ObjectAclPolicy | null> {
  try {
    const res = await s3Client.send(
      new HeadObjectCommand({ Bucket: S3_BUCKET_NAME, Key: objectFile }),
    );
    const raw = res.Metadata?.[ACL_POLICY_METADATA_KEY];
    if (!raw) return null;
    return JSON.parse(decodeURIComponent(raw));
  } catch {
    return null;
  }
}

/**
 * Persist ACL policy as user-defined metadata on the S3 object.
 * S3 does not support in-place metadata updates, so we do a server-side copy.
 */
export async function setObjectAclPolicy(
  objectFile: string,
  aclPolicy: ObjectAclPolicy,
): Promise<void> {
  // Fetch existing metadata first so we don't lose it
  const head = await s3Client.send(
    new HeadObjectCommand({ Bucket: S3_BUCKET_NAME, Key: objectFile }),
  );

  const existingMeta = head.Metadata ?? {};
  const newMeta = {
    ...existingMeta,
    [ACL_POLICY_METADATA_KEY]: encodeURIComponent(JSON.stringify(aclPolicy)),
  };

  // Server-side copy with MetadataDirective=REPLACE to update metadata in place
  await s3Client.send(
    new CopyObjectCommand({
      Bucket: S3_BUCKET_NAME,
      CopySource: `${S3_BUCKET_NAME}/${objectFile}`,
      Key: objectFile,
      Metadata: newMeta,
      MetadataDirective: "REPLACE",
      ContentType: head.ContentType,
    }),
  );
}

export async function canAccessObject({
  userId,
  objectFile,
  requestedPermission,
}: {
  userId?: string;
  objectFile: string;
  requestedPermission: ObjectPermission;
}): Promise<boolean> {
  const aclPolicy = await getObjectAclPolicy(objectFile);
  if (!aclPolicy) {
    return false;
  }
  if (
    aclPolicy.visibility === "public" &&
    requestedPermission === ObjectPermission.READ
  ) {
    return true;
  }
  if (!userId) {
    return false;
  }
  if (aclPolicy.owner === userId) {
    return true;
  }
  for (const rule of aclPolicy.aclRules || []) {
    const accessGroup = createObjectAccessGroup(rule.group);
    if (
      (await accessGroup.hasMember(userId)) &&
      isPermissionAllowed(requestedPermission, rule.permission)
    ) {
      return true;
    }
  }
  return false;
}
