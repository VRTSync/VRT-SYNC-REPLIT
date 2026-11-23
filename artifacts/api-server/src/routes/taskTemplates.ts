import type { Express, Request, Response } from "express";
import { requireAdmin } from "../auth";
import { route } from "./handler";
import * as storage from "../storage";
import { insertTaskTemplateSchema, generateFromTemplateSchema } from "@workspace/db";

export function registerTaskTemplateRoutes(app: Express): void {
  // Task Templates CRUD
  app.get("/api/task-templates", requireAdmin, route(async (req: Request, res: Response) => {
    try {
      const communityType = req.query.communityType as 'hoa' | 'commercial' | undefined;
      const templates = await storage.getTaskTemplates(communityType);
      res.json(templates);
    } catch (error) {
      console.error("Get task templates error:", error);
      res.status(500).json({ error: "Failed to fetch task templates" });
    }
  }));

  app.post("/api/task-templates", requireAdmin, route(async (req: Request, res: Response) => {
    try {
      const parsed = insertTaskTemplateSchema.safeParse(req.body);
      if (!parsed.success) {
        return void res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
      }
      const template = await storage.createTaskTemplate({
        ...parsed.data,
        description: parsed.data.description ?? null,
        dueDaysOffset: parsed.data.dueDaysOffset ?? null,
        targetAssetType: parsed.data.targetAssetType ?? null,
        targetMapLayerId: parsed.data.targetMapLayerId ?? null,
        targetAssetId: parsed.data.targetAssetId ?? null,
        createdBy: req.session.userId!,
      });
      res.status(201).json(template);
    } catch (error) {
      console.error("Create task template error:", error);
      res.status(500).json({ error: "Failed to create task template" });
    }
  }));

  app.patch("/api/task-templates/:id", requireAdmin, route(async (req: Request, res: Response) => {
    try {
      const parsed = insertTaskTemplateSchema.partial().safeParse(req.body);
      if (!parsed.success) {
        return void res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
      }
      const updated = await storage.updateTaskTemplate(req.params.id as string, parsed.data);
      if (!updated) return void res.status(404).json({ error: "Template not found" });
      res.json(updated);
    } catch (error) {
      console.error("Update task template error:", error);
      res.status(500).json({ error: "Failed to update task template" });
    }
  }));

  app.delete("/api/task-templates/:id", requireAdmin, route(async (req: Request, res: Response) => {
    try {
      await storage.deleteTaskTemplate(req.params.id as string);
      res.json({ message: "Template deleted" });
    } catch (error) {
      console.error("Delete task template error:", error);
      res.status(500).json({ error: "Failed to delete task template" });
    }
  }));

  // Template preview — returns count of tasks that would be generated
  app.post("/api/task-templates/:id/preview", requireAdmin, route(async (req: Request, res: Response) => {
    try {
      const template = await storage.getTaskTemplateById(req.params.id as string);
      if (!template) return void res.status(404).json({ error: "Template not found" });

      const parsed = generateFromTemplateSchema.safeParse(req.body);
      if (!parsed.success) return void res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });

      const { communityId, includeArchivedAssets, limit: assetLimit } = parsed.data;

      if (template.targetType === 'none') {
        return void res.json({ taskCount: 1, assets: [] });
      }

      const targetAssets = await storage.getTargetAssets(
        communityId, template.targetType, template.targetAssetType,
        template.targetMapLayerId, template.targetAssetId,
        includeArchivedAssets, assetLimit,
      );

      res.json({
        taskCount: targetAssets.length,
        assets: targetAssets.slice(0, 10).map(a => ({ id: a.id, label: a.label, assetType: a.assetType })),
      });
    } catch (error) {
      console.error("Template preview error:", error);
      res.status(500).json({ error: "Failed to preview template" });
    }
  }));

  // Generate tasks from template
  app.post("/api/task-templates/:id/generate", requireAdmin, route(async (req: Request, res: Response) => {
    try {
      const template = await storage.getTaskTemplateById(req.params.id as string);
      if (!template) return void res.status(404).json({ error: "Template not found" });

      const parsed = generateFromTemplateSchema.safeParse(req.body);
      if (!parsed.success) return void res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });

      const { communityId, dueDate: dueDateStr, assignToUserId, includeArchivedAssets, limit: assetLimit } = parsed.data;

      // Enforce template scope against community type
      if (template.scope !== 'all') {
        const community = await storage.getCommunityById(communityId);
        if (!community) return void res.status(404).json({ error: "Community not found" });
        const communityType = community.organizationId ? 'commercial' : 'hoa';
        if (template.scope !== communityType) {
          return void res.status(400).json({
            error: `This template is scoped to ${template.scope} clients only and cannot be used with this ${communityType} community.`,
          });
        }
      }

      let dueDate: Date | undefined;
      if (dueDateStr) {
        dueDate = new Date(dueDateStr);
      } else if (template.dueDaysOffset != null) {
        dueDate = new Date();
        dueDate.setDate(dueDate.getDate() + template.dueDaysOffset);
      }

      const createdTasks: any[] = [];

      if (template.targetType === 'none') {
        const task = await storage.createTask({
          communityId,
          title: template.title,
          description: template.description || undefined,
          priority: template.priority,
          assignedTo: assignToUserId,
          createdBy: req.session.userId!,
          dueDate,
        });
        createdTasks.push(task);
      } else {
        const targetAssets = await storage.getTargetAssets(
          communityId, template.targetType, template.targetAssetType,
          template.targetMapLayerId, template.targetAssetId,
          includeArchivedAssets, assetLimit,
        );

        for (const asset of targetAssets) {
          const task = await storage.createTask({
            communityId,
            title: `${template.title} — ${asset.label || asset.featureRef || asset.id.substring(0, 8)}`,
            description: template.description || undefined,
            priority: template.priority,
            latitude: asset.latitude ?? undefined,
            longitude: asset.longitude ?? undefined,
            assignedTo: assignToUserId,
            createdBy: req.session.userId!,
            dueDate,
          });

          await storage.setTaskLink(task.id, {
            linkType: 'asset',
            assetId: asset.id,
          });

          createdTasks.push(task);
        }
      }

      const run = await storage.createTemplateRun({
        templateId: template.id,
        communityId,
        createdBy: req.session.userId!,
        taskCountCreated: createdTasks.length,
        assignmentUserId: assignToUserId || null,
      });

      res.status(201).json({
        runId: run.id,
        createdCount: createdTasks.length,
        skippedCount: 0,
        sample: createdTasks.slice(0, 5).map(t => ({ id: t.id, title: t.title, status: t.status })),
      });
    } catch (error) {
      console.error("Generate from template error:", error);
      res.status(500).json({ error: "Failed to generate tasks from template" });
    }
  }));

  // Bulk assign tasks


  // CSV Task Import
}
