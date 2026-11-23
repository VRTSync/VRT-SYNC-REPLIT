import type { Express, Request, Response } from "express";
import { z } from "zod";
import { requireAuth, requireAdmin } from "../auth";
import * as storage from "../storage";
import * as policy from "../policy";
import { db } from "../db";
import { assetTypes as assetTypesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getAssetTypeCache, invalidateAssetTypeCache } from "../assetTypeCache";
import { route } from "./handler";

export function registerAssetTypeRoutes(app: Express): void {
  app.get("/api/asset-types", requireAuth, route(async (req: Request, res: Response) => {
    try {
      const types = await getAssetTypeCache();
      // Admins can request all types (including inactive) via ?all=true
      if (req.query.all === "true") {
        const user = await storage.getUserById(req.session.userId!);
        if (user && policy.canSeeInactiveAssetTypes(policy.actorFromUser(user))) return void res.json(types);
      }
      res.json(types.filter(t => t.isActive));
    } catch (error) {
      console.error("Get asset types error:", error);
      res.status(500).json({ error: "Failed to fetch asset types" });
    }
  }));

  const createAssetTypeSchema = z.object({
    key:             z.string().regex(/^[a-z][a-z0-9_]*$/, "key must be lowercase letters, digits, underscores (e.g. parking_sweep)"),
    label:           z.string().min(1).max(120),
    layerKey:        z.string().regex(/^[a-z][a-z0-9_]*$/, "layerKey must be lowercase letters, digits, underscores"),
    subLayerKey:     z.string().regex(/^[a-z][a-z0-9_]*$/, "subLayerKey must be lowercase letters, digits, underscores"),
    allowedGeometry: z.array(z.string()).nullable().optional(),
    requiredKeys:    z.array(z.string()).optional(),
    optionalKeys:    z.array(z.string()).optional(),
    sortOrder:       z.number().int().min(0).optional(),
  });

  const patchAssetTypeSchema = z.object({
    label:           z.string().min(1).max(120).optional(),
    layerKey:        z.string().regex(/^[a-z][a-z0-9_]*$/).optional(),
    subLayerKey:     z.string().regex(/^[a-z][a-z0-9_]*$/).optional(),
    allowedGeometry: z.array(z.string()).nullable().optional(),
    requiredKeys:    z.array(z.string()).optional(),
    optionalKeys:    z.array(z.string()).optional(),
    sortOrder:       z.number().int().min(0).optional(),
    isActive:        z.boolean().optional(),
  });

  app.post("/api/asset-types", requireAdmin, route(async (req: Request, res: Response) => {
    try {
      const parsed = createAssetTypeSchema.safeParse(req.body);
      if (!parsed.success) {
        return void res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
      }
      const { key, label, layerKey, subLayerKey, allowedGeometry, requiredKeys, optionalKeys, sortOrder } = parsed.data;
      const [row] = await db.insert(assetTypesTable).values({
        key, label, layerKey, subLayerKey,
        allowedGeometry: allowedGeometry ?? null,
        requiredKeys: requiredKeys ?? [],
        optionalKeys: optionalKeys ?? [],
        sortOrder: sortOrder ?? 0,
        isActive: true,
      }).returning();
      invalidateAssetTypeCache();
      res.status(201).json(row);
    } catch (error: any) {
      const pgCode = error?.code ?? error?.cause?.code;
      if (pgCode === "23505") {
        return void res.status(409).json({ error: "An asset type with that key or layer/sub-layer combination already exists" });
      }
      console.error("Create asset type error:", error);
      res.status(500).json({ error: "Failed to create asset type" });
    }
  }));

  app.patch("/api/asset-types/:key", requireAdmin, route(async (req: Request, res: Response) => {
    try {
      const key = req.params.key as string;
      const parsed = patchAssetTypeSchema.safeParse(req.body);
      if (!parsed.success) {
        return void res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
      }
      const { label, layerKey, subLayerKey, allowedGeometry, requiredKeys, optionalKeys, sortOrder, isActive } = parsed.data;
      const updates: Record<string, any> = { updatedAt: new Date() };
      if (label !== undefined) updates.label = label;
      if (layerKey !== undefined) updates.layerKey = layerKey;
      if (subLayerKey !== undefined) updates.subLayerKey = subLayerKey;
      if (allowedGeometry !== undefined) updates.allowedGeometry = allowedGeometry;
      if (requiredKeys !== undefined) updates.requiredKeys = requiredKeys;
      if (optionalKeys !== undefined) updates.optionalKeys = optionalKeys;
      if (sortOrder !== undefined) updates.sortOrder = sortOrder;
      if (isActive !== undefined) updates.isActive = isActive;
      const [row] = await db.update(assetTypesTable).set(updates).where(eq(assetTypesTable.key, key)).returning();
      if (!row) return void res.status(404).json({ error: "Asset type not found" });
      invalidateAssetTypeCache();
      res.json(row);
    } catch (error: any) {
      const pgCode = error?.code ?? error?.cause?.code;
      if (pgCode === "23505") {
        return void res.status(409).json({ error: "That layer/sub-layer combination is already used by another active type" });
      }
      console.error("Update asset type error:", error);
      res.status(500).json({ error: "Failed to update asset type" });
    }
  }));

  app.delete("/api/asset-types/:key", requireAdmin, route(async (req: Request, res: Response) => {
    try {
      const key = req.params.key as string;
      // Deactivate instead of hard-delete to avoid FK violations on existing assets
      const [row] = await db.update(assetTypesTable)
        .set({ isActive: false, updatedAt: new Date() })
        .where(eq(assetTypesTable.key, key))
        .returning();
      if (!row) return void res.status(404).json({ error: "Asset type not found" });
      invalidateAssetTypeCache();
      res.json({ message: "Asset type deactivated", key });
    } catch (error) {
      console.error("Deactivate asset type error:", error);
      res.status(500).json({ error: "Failed to deactivate asset type" });
    }
  }));
}
