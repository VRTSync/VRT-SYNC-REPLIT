import type { Express, Request, Response } from "express";
import { requireAuth } from "../auth";
import { ObjectStorageService, ObjectNotFoundError, ObjectForbiddenError } from "../objectStorage";
import { ObjectPermission, buildCommunityAclPolicy, getObjectAclPolicy } from "../objectAcl";
import * as storage from "../storage";
import * as policy from "../policy";
import { route } from "./handler";

export function registerObjectRoutes(app: Express): void {
  app.get("/public-objects/{*filePath}", route(async (req: Request, res: Response) => {
    const filePath = (req.params as any).filePath as string;
    const objectStorageService = new ObjectStorageService();
    try {
      const file = await objectStorageService.searchPublicObject(filePath);
      if (!file) {
        return void res.status(404).json({ error: "File not found" });
      }
      objectStorageService.downloadObject(file, res);
    } catch (error) {
      console.error("Error searching for public object:", error);
      return void res.status(500).json({ error: "Internal server error" });
    }
  }));

  app.get("/objects/{*objectPath}", requireAuth, route(async (req: Request, res: Response) => {
    const userId = req.session.userId;
    const objectStorageService = new ObjectStorageService();
    try {
      if (policy.needsManagerTaskObjectCheck(policy.actorFromUser(req.currentUser!)) &&
          !await storage.canManagerReadTaskObject(req.currentUser!.id, req.path)) {
        return void res.status(403).json({ error: "You do not have access to this task attachment" });
      }
      const objectFile = await objectStorageService.getObjectEntityFile(req.path);
      const canAccess = await objectStorageService.canAccessObjectEntity({
        objectFile,
        userId,
        requestedPermission: ObjectPermission.READ,
      });
      if (!canAccess) {
        return void res.sendStatus(401);
      }
      objectStorageService.downloadObject(objectFile, res);
    } catch (error) {
      if (error instanceof ObjectNotFoundError) {
        return void res.sendStatus(404);
      }
      return void res.sendStatus(500);
    }
  }));

  app.post("/api/objects/upload", requireAuth, route(async (_req: Request, res: Response) => {
    const objectStorageService = new ObjectStorageService();
    try {
      const uploadURL = await objectStorageService.getObjectEntityUploadURL();
      res.json({ uploadURL });
    } catch (error) {
      console.error("Upload URL error:", error);
      res.status(500).json({ error: "Failed to generate upload URL" });
    }
  }));

  // Bulk-delete private objects owned by the calling user.
  // Only objects whose ACL owner is the caller and that have no access groups
  // (i.e. have not yet been transferred to a community) are eligible.
  // Intended for client-side cleanup of confirmed-but-unattached upload objects
  // when a subsequent PATCH or attach call fails.
  app.delete("/api/objects", requireAuth, route(async (req: Request, res: Response) => {
    try {
      const { objectPaths } = req.body as { objectPaths?: unknown };
      if (!Array.isArray(objectPaths) || objectPaths.length === 0) {
        return void res.status(400).json({ error: "objectPaths[] is required" });
      }
      if (objectPaths.length > 20) {
        return void res.status(400).json({ error: "Too many objectPaths; max 20 per call" });
      }
      const objectStorageService = new ObjectStorageService();
      const results: Array<{ key: string; deleted: boolean }> = [];
      for (const key of objectPaths) {
        if (typeof key !== "string" || !key.startsWith("/objects/")) {
          results.push({ key: String(key), deleted: false });
          continue;
        }
        try {
          const objectFile = await objectStorageService.getObjectEntityFile(key);
          const aclPolicy = await getObjectAclPolicy(objectFile);
          // Only allow deletion of private objects owned by the caller that
          // have not yet been shared with any community (no ACL rules).
          if (
            !aclPolicy ||
            aclPolicy.owner !== req.session.userId! ||
            (aclPolicy.aclRules && aclPolicy.aclRules.length > 0)
          ) {
            results.push({ key, deleted: false });
            continue;
          }
          await objectStorageService.deleteObject(key);
          results.push({ key, deleted: true });
        } catch (e: any) {
          if (e?.name === "ObjectNotFoundError") {
            results.push({ key, deleted: true }); // already gone — treat as success
          } else {
            results.push({ key, deleted: false });
          }
        }
      }
      return void res.json({ results });
    } catch (error) {
      req.log.error({ error }, "Delete objects error");
      return void res.status(500).json({ error: "Failed to delete objects" });
    }
  }));

  app.post("/api/objects/confirm", requireAuth, route(async (req: Request, res: Response) => {
    const { uploadURL, communityId } = req.body;
    if (!uploadURL) {
      return void res.status(400).json({ error: "uploadURL is required" });
    }
    try {
      const objectStorageService = new ObjectStorageService();
      if (communityId) {
        const user = await storage.getUserById(req.session.userId!);
        const canAccess = user && await policy.canAttachFileToCommunity(policy.actorFromUser(user), communityId);
        if (!canAccess) {
          return void res.status(403).json({ error: "You are not a member of this community" });
        }
      }
      const aclPolicy = communityId
        ? buildCommunityAclPolicy(req.session.userId!, communityId as string)
        : { owner: req.session.userId!, visibility: "private" as const };
      const objectPath = await objectStorageService.claimObjectForCaller(uploadURL, req.session.userId!, aclPolicy);
      res.json({ objectPath });
    } catch (error) {
      if (error instanceof ObjectForbiddenError) {
        return void res.status(403).json({ error: "You do not own this file" });
      }
      console.error("Confirm upload error:", error);
      res.status(500).json({ error: "Failed to confirm upload" });
    }
  }));
}
