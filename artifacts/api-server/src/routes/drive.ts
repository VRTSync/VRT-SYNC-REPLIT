import type { Express, Request, Response } from "express";
import { insertDriveFolderSchema, updateDriveFolderSchema, insertDriveFileSchema, updateDriveFileSchema } from "@workspace/db";
import { requireAuth } from "../auth";
import { ObjectStorageService, ObjectNotFoundError } from "../objectStorage";
import * as storage from "../storage";
import * as policy from "../policy";
import { route } from "./handler";

export function registerDriveRoutes(app: Express): void {
  async function requireDriveAccess(req: Request, res: Response, canAccess: typeof policy.canReadDrive): Promise<ReturnType<typeof storage.getUserById> | null> {
    const user = await storage.getUserById(req.session.userId!);
    if (!user || !canAccess(policy.actorFromUser(user))) {
      res.status(403).json({ error: "Access denied" });
      return null;
    }
    return user;
  }

  async function checkCommunityAccess(user: NonNullable<Awaited<ReturnType<typeof storage.getUserById>>>, communityId: string, res: Response): Promise<boolean> {
    if (!(await policy.canUseCommunityDrive(policy.actorFromUser(user), communityId))) {
      res.status(403).json({ error: "Access denied" });
      return false;
    }
    return true;
  }

  app.get("/api/drive", requireAuth, route(async (req: Request, res: Response) => {
    try {
      const user = await requireDriveAccess(req, res, policy.canReadDrive);
      if (!user) return;
      const communityId = req.query.communityId as string;
      if (!communityId) return void res.status(400).json({ error: "communityId is required" });
      if (!(await checkCommunityAccess(user, communityId, res))) return;
      const folderId = (req.query.folderId as string) || null;
      const [folders, files] = await Promise.all([
        storage.getDriveFolders(communityId, folderId),
        storage.getDriveFiles(communityId, folderId),
      ]);
      res.json({ folders, files });
    } catch (error) {
      console.error("Drive list error:", error);
      res.status(500).json({ error: "Failed to list drive contents" });
    }
  }));

  app.post("/api/drive/folders", requireAuth, route(async (req: Request, res: Response) => {
    try {
      const user = await requireDriveAccess(req, res, policy.canChangeDrive);
      if (!user) return;
      const parsed = insertDriveFolderSchema.safeParse(req.body);
      if (!parsed.success) return void res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid data" });
      if (!(await checkCommunityAccess(user, parsed.data.communityId, res))) return;
      if (parsed.data.parentId) {
        const parentFolder = await storage.getDriveFolder(parsed.data.parentId);
        if (!parentFolder || parentFolder.communityId !== parsed.data.communityId) {
          return void res.status(400).json({ error: "Parent folder not found or belongs to a different community" });
        }
      }
      const folder = await storage.createDriveFolder({ ...parsed.data, createdBy: user.id });
      res.status(201).json(folder);
    } catch (error) {
      console.error("Create drive folder error:", error);
      res.status(500).json({ error: "Failed to create folder" });
    }
  }));

  app.patch("/api/drive/folders/:id", requireAuth, route(async (req: Request, res: Response) => {
    try {
      const user = await requireDriveAccess(req, res, policy.canChangeDrive);
      if (!user) return;
      const folder = await storage.getDriveFolder((req.params.id as string));
      if (!folder) return void res.status(404).json({ error: "Folder not found" });
      if (!(await checkCommunityAccess(user, folder.communityId, res))) return;
      const parsed = updateDriveFolderSchema.safeParse(req.body);
      if (!parsed.success) return void res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid data" });
      const updated = await storage.updateDriveFolder((req.params.id as string), parsed.data);
      res.json(updated);
    } catch (error) {
      console.error("Update drive folder error:", error);
      res.status(500).json({ error: "Failed to update folder" });
    }
  }));

  app.delete("/api/drive/folders/:id", requireAuth, route(async (req: Request, res: Response) => {
    try {
      const user = await requireDriveAccess(req, res, policy.canChangeDrive);
      if (!user) return;
      const folder = await storage.getDriveFolder((req.params.id as string));
      if (!folder) return void res.status(404).json({ error: "Folder not found" });
      if (!(await checkCommunityAccess(user, folder.communityId, res))) return;
      await storage.deleteDriveFolder((req.params.id as string));
      res.status(204).send();
    } catch (error) {
      if (error instanceof Error && error.message === "FOLDER_NOT_EMPTY") {
        return void res.status(409).json({ error: "Cannot delete a folder that contains files or subfolders. Please remove its contents first." });
      }
      console.error("Delete drive folder error:", error);
      res.status(500).json({ error: "Failed to delete folder" });
    }
  }));

  app.post("/api/drive/files", requireAuth, route(async (req: Request, res: Response) => {
    try {
      const user = await requireDriveAccess(req, res, policy.canChangeDrive);
      if (!user) return;
      const parsed = insertDriveFileSchema.safeParse(req.body);
      if (!parsed.success) return void res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid data" });
      if (!parsed.data.fileRef.startsWith('/objects/')) {
        return void res.status(400).json({ error: "Invalid file reference" });
      }
      if (parsed.data.folderId) {
        const parentFolder = await storage.getDriveFolder(parsed.data.folderId);
        if (!parentFolder || parentFolder.communityId !== parsed.data.communityId) {
          return void res.status(400).json({ error: "Folder not found or belongs to a different community" });
        }
      }
      if (!(await checkCommunityAccess(user, parsed.data.communityId, res))) return;
      const file = await storage.createDriveFile({ ...parsed.data, uploadedBy: user.id });
      res.status(201).json(file);
    } catch (error) {
      console.error("Create drive file error:", error);
      res.status(500).json({ error: "Failed to create file record" });
    }
  }));

  app.patch("/api/drive/files/:id", requireAuth, route(async (req: Request, res: Response) => {
    try {
      const user = await requireDriveAccess(req, res, policy.canChangeDrive);
      if (!user) return;
      const file = await storage.getDriveFile((req.params.id as string));
      if (!file) return void res.status(404).json({ error: "File not found" });
      if (!(await checkCommunityAccess(user, file.communityId, res))) return;
      const parsed = updateDriveFileSchema.safeParse(req.body);
      if (!parsed.success) return void res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid data" });
      const updated = await storage.updateDriveFile((req.params.id as string), parsed.data);
      res.json(updated);
    } catch (error) {
      console.error("Update drive file error:", error);
      res.status(500).json({ error: "Failed to update file" });
    }
  }));

  app.delete("/api/drive/files/:id", requireAuth, route(async (req: Request, res: Response) => {
    try {
      const user = await requireDriveAccess(req, res, policy.canChangeDrive);
      if (!user) return;
      const file = await storage.getDriveFile((req.params.id as string));
      if (!file) return void res.status(404).json({ error: "File not found" });
      if (!(await checkCommunityAccess(user, file.communityId, res))) return;
      const objectStorageService = new ObjectStorageService();
      await objectStorageService.deleteObject(file.fileRef);
      await storage.deleteDriveFile((req.params.id as string));
      res.status(204).send();
    } catch (error) {
      console.error("Delete drive file error:", error);
      res.status(500).json({ error: "Failed to delete file" });
    }
  }));

  app.get("/api/drive/files/:id/download", requireAuth, route(async (req: Request, res: Response) => {
    try {
      const user = await requireDriveAccess(req, res, policy.canReadDrive);
      if (!user) return;
      const file = await storage.getDriveFile((req.params.id as string));
      if (!file) return void res.status(404).json({ error: "File not found" });
      if (!(await checkCommunityAccess(user, file.communityId, res))) return;
      const objectStorageService = new ObjectStorageService();
      const objectFile = await objectStorageService.getObjectEntityFile(file.fileRef);
      res.set("Content-Disposition", `attachment; filename="${encodeURIComponent(file.name)}"`);
      await objectStorageService.downloadObject(objectFile, res);
    } catch (error) {
      if (error instanceof ObjectNotFoundError) {
        return void res.status(404).json({ error: "File not found in storage" });
      }
      console.error("Drive file download error:", error);
      res.status(500).json({ error: "Failed to download file" });
    }
  }));
}
