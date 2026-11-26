import type { Express, Request, Response } from "express";
import { z } from "zod";
import { requireAuth, requireAdmin, requireAdminOrMapCreator } from "../auth";
import * as storage from "../storage";
import * as policy from "../policy";
import { insertAssetSchema, updateAssetSchema, upsertAssetPropertiesSchema, insertAssetNoteSchema } from "@workspace/db";
import { getMissingRequiredKeys } from "../assetSync";
import { getAssetTypeCache } from "../assetTypeCache";
import { getDefaultLayerColor, CONTROLLER_COLORS } from "@workspace/layer-colors";
import { ObjectStorageService, ObjectNotFoundError, ObjectForbiddenError, parseUploadURL } from "../objectStorage";
import { buildCommunityAclPolicy } from "../objectAcl";
import { route } from "./handler";

export function registerAssetRoutes(app: Express): void {
  app.get("/api/communities/:communityId/assets", requireAuth, route(async (req: Request, res: Response) => {
    try {
      const communityId = req.params.communityId as string;
      const user = await storage.getUserById(req.session.userId!);
      if (!user) return void res.status(401).json({ error: "User not found" });
      const actor = policy.actorFromUser(user);
      if (!await policy.canUseCommunityAssets(actor, communityId)) {
        return void res.status(403).json({ error: "You are not a member of this community" });
      }
      const type = req.query.type as string | undefined;
      const includeArchived = req.query.includeArchived === "true";
      const assetList = await storage.getAssetsByCommunitySorted(communityId, type, includeArchived);
      res.json(assetList);
    } catch (error) {
      console.error("Get assets error:", error);
      res.status(500).json({ error: "Failed to fetch assets" });
    }
  }));

  app.get("/api/assets/by-feature", requireAuth, route(async (req: Request, res: Response) => {
    try {
      const communityId = req.query.communityId as string;
      const featureRef = req.query.featureRef as string;
      if (!communityId || !featureRef) return void res.status(400).json({ error: "communityId and featureRef are required" });
      const user = await storage.getUserById(req.session.userId!);
      if (!user) return void res.status(401).json({ error: "User not found" });
      const actor = policy.actorFromUser(user);
      if (!await policy.canUseCommunityAssets(actor, communityId)) {
        return void res.status(403).json({ error: "Not a member of this community" });
      }
      const asset = await storage.getAssetByFeatureRef(communityId, featureRef);
      if (!asset) {
        console.warn(`[by-feature] No asset found for communityId=${communityId} featureRef=${featureRef}`);
      }
      res.json(asset);
    } catch (error) {
      console.error("Get asset by feature error:", error);
      res.status(500).json({ error: "Failed to fetch asset" });
    }
  }));

  app.post("/api/assets/bulk/properties", requireAdmin, route(async (req: Request, res: Response) => {
    try {
      const { assetIds, key, value, mode } = req.body;
      if (!Array.isArray(assetIds) || assetIds.length === 0) {
        return void res.status(400).json({ error: "assetIds must be a non-empty array" });
      }
      if (!key || typeof key !== "string" || !value || typeof value !== "string") {
        return void res.status(400).json({ error: "key and value are required strings" });
      }
      const validMode = mode === "overwrite" ? "overwrite" : "set_if_missing";
      const result = await storage.bulkUpsertAssetProperty(assetIds, key.trim(), value.trim(), validMode);
      res.json(result);
    } catch (error) {
      console.error("Bulk upsert properties error:", error);
      res.status(500).json({ error: "Failed to bulk upsert properties" });
    }
  }));

  app.get("/api/assets/:id", requireAuth, route(async (req: Request, res: Response) => {
    try {
      const asset = await storage.getAssetById(req.params.id as string);
      if (!asset) return void res.status(404).json({ error: "Asset not found" });
      const user = await storage.getUserById(req.session.userId!);
      if (!user) return void res.status(401).json({ error: "User not found" });
      const actor = policy.actorFromUser(user);
      if (!await policy.canUseCommunityAssets(actor, asset.communityId)) {
        return void res.status(403).json({ error: "You do not have access to this asset" });
      }
      const properties = await storage.getAssetProperties(asset.id);
      const missingRequiredKeys = await getMissingRequiredKeys(asset.assetType, properties);
      let createdByName: string | null = null;
      let updatedByName: string | null = null;
      if (asset.createdBy) {
        const cbUser = await storage.getUserById(asset.createdBy);
        createdByName = cbUser?.displayName ?? null;
      }
      if (asset.updatedBy) {
        const ubUser = await storage.getUserById(asset.updatedBy);
        updatedByName = ubUser?.displayName ?? null;
      }
      res.json({ ...asset, properties, missingRequiredKeys, createdByName, updatedByName, workHistorySummary: { totalTasks: 0, completedTasks: 0 } });
    } catch (error) {
      console.error("Get asset error:", error);
      res.status(500).json({ error: "Failed to fetch asset" });
    }
  }));

  app.get("/api/assets/:id/history", requireAuth, route(async (req: Request, res: Response) => {
    try {
      const asset = await storage.getAssetById(req.params.id as string);
      if (!asset) return void res.status(404).json({ error: "Asset not found" });
      const user = await storage.getUserById(req.session.userId!);
      if (!user) return void res.status(401).json({ error: "User not found" });
      const actor = policy.actorFromUser(user);
      if (!await policy.canUseCommunityAssets(actor, asset.communityId)) {
        return void res.status(403).json({ error: "You do not have access to this asset's history" });
      }
      const history = await storage.getAssetWorkHistory(asset.id, policy.assetHistoryCompanyScope(policy.actorFromUser(req.currentUser!)));
      res.json(history);
    } catch (error) {
      console.error("Get asset history error:", error);
      res.status(500).json({ error: "Failed to fetch asset history" });
    }
  }));

  app.get("/api/assets/:id/notes", requireAuth, route(async (req: Request, res: Response) => {
    try {
      const asset = await storage.getAssetById(req.params.id as string);
      if (!asset) return void res.status(404).json({ error: "Asset not found" });
      const user = await storage.getUserById(req.session.userId!);
      if (!user) return void res.status(401).json({ error: "User not found" });
      const actor = policy.actorFromUser(user);
      if (!await policy.canUseCommunityAssets(actor, asset.communityId)) {
        return void res.status(403).json({ error: "Access denied" });
      }
      const notes = await storage.getAssetNotes(asset.id);
      res.json(notes);
    } catch (error) {
      console.error("Get asset notes error:", error);
      res.status(500).json({ error: "Failed to fetch asset notes" });
    }
  }));

  app.post("/api/assets/:id/notes", requireAuth, route(async (req: Request, res: Response) => {
    try {
      const parsed = insertAssetNoteSchema.safeParse(req.body);
      if (!parsed.success) {
        return void res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
      }
      const asset = await storage.getAssetById(req.params.id as string);
      if (!asset) return void res.status(404).json({ error: "Asset not found" });
      const user = await storage.getUserById(req.session.userId!);
      if (!user) return void res.status(401).json({ error: "User not found" });
      const actor = policy.actorFromUser(user);
      if (!await policy.canUseCommunityAssets(actor, asset.communityId)) {
        return void res.status(403).json({ error: "Access denied" });
      }
      const note = await storage.createAssetNote({
        assetId: asset.id,
        communityId: asset.communityId,
        createdBy: req.session.userId!,
        noteText: parsed.data.noteText,
        idempotencyKey: parsed.data.idempotencyKey,
      });
      res.status(201).json(note);
    } catch (error) {
      console.error("Create asset note error:", error);
      res.status(500).json({ error: "Failed to create asset note" });
    }
  }));

  app.delete("/api/assets/:assetId/notes/:noteId", requireAuth, route(async (req: Request, res: Response) => {
    try {
      const { assetId, noteId } = req.params as { assetId: string; noteId: string };
      const note = await storage.getAssetNoteById(noteId);
      if (!note) return void res.status(404).json({ error: "Note not found" });
      if (note.assetId !== assetId) return void res.status(404).json({ error: "Note not found" });
      const user = await storage.getUserById(req.session.userId!);
      if (!user) return void res.status(401).json({ error: "User not found" });
      const asset = await storage.getAssetById(assetId);
      if (!asset) return void res.status(404).json({ error: "Asset not found" });
      if (!await policy.canDeleteAssetNote(policy.actorFromUser(user), note, asset.communityId)) {
        return void res.status(403).json({ error: "Access denied" });
      }
      await storage.deleteAssetNote(noteId);
      res.json({ success: true });
    } catch (error) {
      console.error("Delete asset note error:", error);
      res.status(500).json({ error: "Failed to delete note" });
    }
  }));

  app.patch("/api/communities/:id/map-creator-lock", requireAdminOrMapCreator, route(async (req: Request, res: Response) => {
    try {
      const { locked } = req.body;
      if (typeof locked !== "boolean") {
        return void res.status(400).json({ error: "locked (boolean) is required" });
      }
      const currentUser = (req as any).currentUser;
      const communityId = req.params.id as string;

      const actor = policy.actorFromUser(currentUser);
      const access = await policy.mapCreatorLockAccess(actor, communityId, locked);
      if (access === "unlock_admin_only") {
        return void res.status(403).json({ error: "Only admins can unlock a community." });
      }
      if (access === "not_member") {
        return void res.status(403).json({ error: "You are not a member of this community" });
      }

      const community = await storage.getCommunityById(communityId);
      if (!community) return void res.status(404).json({ error: "Community not found" });

      const updated = locked
        ? await storage.lockCommunityForMapCreator(communityId, currentUser.id)
        : await storage.unlockCommunityForMapCreator(communityId);

      if (!updated) return void res.status(404).json({ error: "Community not found" });
      res.json({
        id: updated.id,
        name: updated.name,
        description: updated.description,
        isMapCreatorLocked: updated.isMapCreatorLocked,
        mapCreatorLockedAt: updated.mapCreatorLockedAt,
        mapCreatorLockedBy: updated.mapCreatorLockedBy,
        createdAt: updated.createdAt,
      });
    } catch (error) {
      req.log.error({ error }, "Map creator lock error");
      res.status(500).json({ error: "Failed to update lock state" });
    }
  }));

  app.get("/api/assets", requireAdminOrMapCreator, route(async (req: Request, res: Response) => {
    try {
      const reqUser = await storage.getUserById(req.session.userId!);
      if (!reqUser) return void res.status(401).json({ error: "User not found" });

      const communityId = req.query.communityId as string | undefined;
      const sortRaw = req.query.sort as string | undefined;
      const sort = (sortRaw === 'accuracy_asc' || sortRaw === 'accuracy_desc') ? sortRaw : undefined;
      const hasAccuracyRaw = req.query.hasAccuracy as string | undefined;
      const hasAccuracy = hasAccuracyRaw === 'true' ? true : hasAccuracyRaw === 'false' ? false : undefined;
      const underCanopyRaw = req.query.underCanopy as string | undefined;
      const underCanopy = underCanopyRaw === 'true' ? true : underCanopyRaw === 'false' ? false : undefined;
      const minAccuracyMRaw = req.query.minAccuracyM as string | undefined;
      const minAccuracyM = minAccuracyMRaw != null ? parseFloat(minAccuracyMRaw) : undefined;

      const rows = await storage.getAssetsForQuality({
        communityId, userId: reqUser.id, role: reqUser.role,
        hasAccuracy, underCanopy, minAccuracyM, sort,
      });

      return void res.json(rows);
    } catch (error) {
      req.log.error({ error }, "GET /api/assets error");
      return void res.status(500).json({ error: "Failed to fetch assets" });
    }
  }));

  app.post("/api/assets", requireAdminOrMapCreator, route(async (req: Request, res: Response) => {
    try {
      const reqUser = await storage.getUserById(req.session.userId!);
      if (!reqUser) return void res.status(401).json({ error: "User not found" });

      const actor = policy.actorFromUser(reqUser);
      // Map creator GPS-pin path: communityId + assetType + lat/lng (label optional)
      if (policy.usesMapCreatorPinPath(actor)) {
        // Authz: communityId required → membership → lock check
        const communityIdForPin = req.body?.communityId as string | undefined;
        if (!communityIdForPin) return void res.status(400).json({ error: "communityId is required" });
        const pinMembership = await policy.assetWriteAccess(actor, { id: communityIdForPin });
        if (pinMembership === "not_member") return void res.status(403).json({ error: "You are not a member of this community" });
        const communityForPin = await storage.getCommunityById(communityIdForPin);
        if (await policy.assetWriteAccess(actor, { id: communityIdForPin, isMapCreatorLocked: communityForPin?.isMapCreatorLocked }) === "locked") {
          return void res.status(423).json({ error: "This customer is marked complete by the map creator. Ask an admin to unlock." });
        }

        const pinSchema = z.object({
          communityId:          z.string().min(1),
          assetType:            z.string().min(1),
          latitude:             z.number(),
          longitude:            z.number(),
          label:                z.string().optional(),
          capturedAccuracyM:    z.number().nullable().optional(),
          capturedSampleCount:  z.number().int().nullable().optional(),
          capturedAt:           z.string().nullable().optional(),
          capturedDeviceModel:  z.string().nullable().optional(),
          capturedUnderCanopy:  z.boolean().optional(),
        });

        const parsed = pinSchema.safeParse(req.body);
        if (!parsed.success) {
          return void res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
        }

        const {
          communityId, assetType, latitude, longitude, label,
          capturedAccuracyM, capturedSampleCount, capturedAt,
          capturedDeviceModel, capturedUnderCanopy,
        } = parsed.data;

        // Validate assetType against the live catalogue
        const catalogueTypes = await getAssetTypeCache();
        const typeDef = catalogueTypes.find(t => t.isActive && t.key === assetType);
        if (!typeDef) {
          const allowed = catalogueTypes.filter(t => t.isActive).map(t => t.key).join(", ");
          return void res.status(400).json({ error: `Unknown asset type "${assetType}". Allowed: ${allowed}` });
        }

        if (!await policy.canUseCommunityAssets(actor, communityId)) return void res.status(403).json({ error: "You are not authorized to create assets in this community" });

        const layerDef = {
          layerKey: typeDef.layerKey,
          subLayerKey: typeDef.subLayerKey,
          displayName: typeDef.label,
        };
        const featureRef = `pin-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const pinLabel = label || `${layerDef.displayName.replace(/s$/, "")} ${featureRef.slice(-4).toUpperCase()}`;

        const allLayers = await storage.getMapLayersByCommunity(communityId, layerDef.layerKey);
        let layer = allLayers.find((l) => l.subLayerKey === layerDef.subLayerKey) ?? null;
        let isNewLayer = false;

        const newFeature = {
          type: "Feature",
          id: featureRef,
          geometry: { type: "Point", coordinates: [longitude, latitude] },
          properties: { id: featureRef, label: pinLabel },
        };

        if (!layer) {
          isNewLayer = true;
          const color = getDefaultLayerColor(layerDef.subLayerKey, allLayers.length);
          layer = await storage.createMapLayer({
            communityId,
            layerKey: layerDef.layerKey,
            subLayerKey: layerDef.subLayerKey,
            displayName: layerDef.displayName,
            geojsonData: JSON.stringify({ type: "FeatureCollection", features: [newFeature] }),
            color,
          }, 1);
        } else {
          let collection: { type: string; features: any[] } = { type: "FeatureCollection", features: [] };
          if (layer.geojsonData) {
            try { collection = JSON.parse(layer.geojsonData); } catch {}
          }
          collection.features = [...(collection.features || []), newFeature];
          await storage.updateMapLayer(layer.id, layer.version, { geojsonData: JSON.stringify(collection) }, collection.features.length);
          layer = (await storage.getMapLayerById(layer.id)) ?? layer;
        }

        let asset;
        try {
          asset = await storage.createAsset({
            communityId,
            assetType,
            label: pinLabel,
            featureRef,
            mapLayerId: layer.id,
            geometryType: "point",
            latitude,
            longitude,
            createdBy: reqUser.id,
            updatedBy: reqUser.id,
            capturedAccuracyM: capturedAccuracyM ?? null,
            capturedSampleCount: capturedSampleCount ?? null,
            capturedAt: capturedAt ? new Date(capturedAt) : null,
            capturedDeviceModel: capturedDeviceModel ?? null,
            capturedUnderCanopy: capturedUnderCanopy ?? false,
          });
        } catch (createErr: any) {
          if (createErr?.code === '23505' || createErr?.message?.includes('duplicate') || createErr?.message?.includes('unique')) {
            return void res.status(409).json({ error: "A pin with this reference already exists in this community/layer." });
          }
          throw createErr;
        }

        const { geojsonData: _geo, ...layerMeta } = layer;
        return void res.status(201).json({ asset, layerId: layer.id, feature: newFeature, isNewLayer, layer: layerMeta });
      }

      // Admin path: full insertAssetSchema validation
      if (!policy.canCreateAdminAsset(actor)) {
        return void res.status(403).json({ error: "Forbidden" });
      }
      const parsed = insertAssetSchema.safeParse(req.body);
      if (!parsed.success) {
        return void res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
      }

      const bodyProps: Record<string, string> = {};
      const rawProps = req.body.properties;
      if (rawProps && typeof rawProps === "object") {
        for (const [k, v] of Object.entries(rawProps)) {
          if (typeof v === "string") bodyProps[k] = v;
        }
      }

      let asset;
      try {
        if (
          parsed.data.assetType === "controller" &&
          policy.usesMapCreatorPinPath(actor) &&
          (!bodyProps.controllerKey || !bodyProps.controllerColor)
        ) {
          const { asset: newAsset } = await storage.createControllerAssetAtomic({
            communityId: parsed.data.communityId,
            label: parsed.data.label,
            featureRef: parsed.data.featureRef,
            mapLayerId: parsed.data.mapLayerId,
            latitude: parsed.data.latitude,
            longitude: parsed.data.longitude,
            createdBy: reqUser.id,
            bodyProps,
            controllerColors: CONTROLLER_COLORS,
          });
          asset = newAsset;
        } else {
          asset = await storage.createAsset({
            ...parsed.data,
            createdBy: reqUser.id,
            updatedBy: reqUser.id,
          } as any);
          const properties = Object.entries(bodyProps).map(([key, value]) => ({ key, value }));
          if (properties.length > 0) {
            await storage.upsertAssetProperties(asset.id, properties);
          }
        }
      } catch (err: any) {
        if (err?.code === "23505") {
          return void res.status(409).json({ error: "A pin with this ID already exists. Please try again.", code: "DUPLICATE_FEATURE_REF" });
        }
        throw err;
      }

      res.status(201).json(asset);
    } catch (error) {
      req.log.error({ error }, "Create asset error");
      res.status(500).json({ error: "Failed to create asset" });
    }
  }));

  app.post("/api/assets/:id/attachments", requireAdminOrMapCreator, route(async (req: Request, res: Response) => {
    try {
      const assetId = req.params.id as string;
      const asset = await storage.getAssetById(assetId);
      if (!asset) return void res.status(404).json({ error: "Asset not found" });

      const reqUser = await storage.getUserById(req.session.userId!);
      if (!reqUser) return void res.status(401).json({ error: "User not found" });
      const actor = policy.actorFromUser(reqUser);
      if (!await policy.canUseCommunityAssets(actor, asset.communityId)) {
        return void res.status(403).json({ error: "Access denied" });
      }

      const { uploadURL, idempotencyKey, capturedAt } = req.body;
      if (!uploadURL || !idempotencyKey) {
        return void res.status(400).json({ error: "uploadURL and idempotencyKey are required" });
      }

      const strictValidation = process.env.STRICT_UPLOAD_URL_VALIDATION !== "false";
      if (strictValidation) {
        const parsed = parseUploadURL(uploadURL);
        if (!parsed.valid) {
          return void res.status(400).json({ error: parsed.reason, code: "INVALID_UPLOAD_URL" });
        }
      }

      const existing = await storage.getAssetAttachmentByIdempotencyKey(assetId, idempotencyKey);
      if (existing) {
        return void res.status(200).json(existing);
      }

      const aclPolicy = buildCommunityAclPolicy(req.session.userId!, asset.communityId);
      const objectStorageService = new ObjectStorageService();
      let objectPath: string;
      try {
        objectPath = await objectStorageService.claimObjectForCaller(uploadURL, req.session.userId!, aclPolicy);
      } catch (error) {
        if (strictValidation && error instanceof ObjectNotFoundError) {
          return void res.status(422).json({ error: "Upload not received", code: "UPLOAD_NOT_RECEIVED" });
        }
        throw error;
      }

      const attachment = await storage.addAssetAttachment({
        assetId,
        communityId: asset.communityId,
        fileRef: objectPath,
        url: objectPath,
        uploadedBy: req.session.userId!,
        idempotencyKey,
        capturedAt: capturedAt ? new Date(capturedAt) : undefined,
      });

      res.status(201).json(attachment);
    } catch (error) {
      if (error instanceof ObjectForbiddenError) {
        return void res.status(403).json({ error: "You do not own this file" });
      }
      req.log.error({ error }, "Create asset attachment error");
      res.status(500).json({ error: "Failed to create asset attachment" });
    }
  }));

  app.get("/api/assets/:id/attachments", requireAdminOrMapCreator, route(async (req: Request, res: Response) => {
    try {
      const assetId = req.params.id as string;
      const asset = await storage.getAssetById(assetId);
      if (!asset) return void res.status(404).json({ error: "Asset not found" });

      const reqUser = await storage.getUserById(req.session.userId!);
      if (!reqUser) return void res.status(401).json({ error: "User not found" });
      const actor = policy.actorFromUser(reqUser);
      if (!await policy.canUseCommunityAssets(actor, asset.communityId)) {
        return void res.status(403).json({ error: "Access denied" });
      }

      const assetAttachmentsList = await storage.getAssetAttachments(assetId);
      res.json(assetAttachmentsList);
    } catch (error) {
      req.log.error({ error }, "Get asset attachments error");
      res.status(500).json({ error: "Failed to fetch asset attachments" });
    }
  }));

  app.delete("/api/assets/:id/attachments/:attachmentId", requireAdminOrMapCreator, route(async (req: Request, res: Response) => {
    try {
      const assetId = req.params.id as string;
      const attachmentId = req.params.attachmentId as string;

      const asset = await storage.getAssetById(assetId);
      if (!asset) return void res.status(404).json({ error: "Asset not found" });

      const reqUser = await storage.getUserById(req.session.userId!);
      if (!reqUser) return void res.status(401).json({ error: "User not found" });
      const actor = policy.actorFromUser(reqUser);
      if (!await policy.canUseCommunityAssets(actor, asset.communityId)) {
        return void res.status(403).json({ error: "Access denied" });
      }

      const deleted = await storage.deleteAssetAttachment(assetId, attachmentId);
      if (!deleted) return void res.status(404).json({ error: "Attachment not found" });
      res.status(204).send();
    } catch (error) {
      req.log.error({ error }, "Delete asset attachment error");
      res.status(500).json({ error: "Failed to delete asset attachment" });
    }
  }));

  app.patch("/api/assets/:id", requireAdminOrMapCreator, route(async (req: Request, res: Response) => {
    try {
      const parsed = updateAssetSchema.safeParse(req.body);
      if (!parsed.success) {
        return void res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
      }

      const currentUser = (req as any).currentUser;
      const actor = policy.actorFromUser(currentUser);
      if (!policy.canCreateAdminAsset(actor)) {
        const asset = await storage.getAssetById(req.params.id as string);
        if (!asset) return void res.status(404).json({ error: "Asset not found" });
        if (await policy.assetWriteAccess(actor, { id: asset.communityId }) === "not_member") {
          return void res.status(403).json({ error: "You are not a member of this community" });
        }
        if (policy.usesMapCreatorPinPath(actor)) {
          const community = await storage.getCommunityById(asset.communityId);
          if (await policy.assetWriteAccess(actor, { id: asset.communityId, isMapCreatorLocked: community?.isMapCreatorLocked }) === "locked") {
            return void res.status(423).json({ error: "This customer is marked complete by the map creator. Ask an admin to unlock." });
          }
        }
      }


      const { version, capturedAt: capturedAtRaw, ...data } = parsed.data;
      const updated = await storage.updateAsset(req.params.id as string, version, {
        ...data,
        ...(capturedAtRaw !== undefined ? { capturedAt: capturedAtRaw ? new Date(capturedAtRaw) : null } : {}),
        updatedBy: req.session.userId!,
      });
      if (!updated) {
        const latest = await storage.getAssetById(req.params.id as string);
        if (!latest) return void res.status(404).json({ error: "Asset not found" });
        return void res.status(409).json({
          error: "Conflict: asset was modified. Please refresh and try again.",
          code: "VERSION_CONFLICT",
          latestAsset: latest,
        });
      }
      res.json(updated);
    } catch (error) {
      req.log.error({ error }, "Update asset error");
      res.status(500).json({ error: "Failed to update asset" });
    }
  }));

  app.put("/api/assets/:id/properties", requireAdminOrMapCreator, route(async (req: Request, res: Response) => {
    try {
      const parsed = upsertAssetPropertiesSchema.safeParse(req.body);
      if (!parsed.success) {
        return void res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
      }
      const asset = await storage.getAssetById(req.params.id as string);
      if (!asset) return void res.status(404).json({ error: "Asset not found" });

      const currentUser = (req as any).currentUser;
      const actor = policy.actorFromUser(currentUser);
      if (await policy.assetWriteAccess(actor, { id: asset.communityId }) === "not_member") {
        return void res.status(403).json({ error: "You are not a member of this community" });
      }
      if (policy.usesMapCreatorPinPath(actor)) {
        if (!await policy.canUseCommunityAssets(actor, asset.communityId)) return void res.status(403).json({ error: "You are not a member of this community" });
        const community = await storage.getCommunityById(asset.communityId);
        if (await policy.assetWriteAccess(actor, { id: asset.communityId, isMapCreatorLocked: community?.isMapCreatorLocked }) === "locked") {
          return void res.status(423).json({ error: "This customer is marked complete by the map creator. Ask an admin to unlock." });
        }
      }


      const properties = await storage.upsertAssetProperties(asset.id, parsed.data.properties);
      res.json(properties);
    } catch (error) {
      req.log.error({ error }, "Upsert properties error");
      res.status(500).json({ error: "Failed to update properties" });
    }
  }));
}
