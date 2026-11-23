import type { Express, Request, Response } from "express";
import { requireAuth } from "../auth";
import * as storage from "../storage";
import { route } from "./handler";

export function registerNotificationRoutes(app: Express): void {
  app.get("/api/notification-preferences", requireAuth, route(async (req: Request, res: Response) => {
    try {
      const prefs = await storage.getUserNotificationPreferences(req.session.userId!);
      res.json(prefs);
    } catch (error) {
      console.error("Get notification preferences error:", error);
      res.status(500).json({ error: "Failed to fetch notification preferences" });
    }
  }));

  app.put("/api/notification-preferences", requireAuth, route(async (req: Request, res: Response) => {
    try {
      const { taskAssigned, dueReminders, syncFailure, taskCompleted, requestSubmitted, requestCompleted, requestStatusUpdates } = req.body;
      const prefs = {
        taskAssigned: typeof taskAssigned === 'boolean' ? taskAssigned : true,
        dueReminders: typeof dueReminders === 'boolean' ? dueReminders : true,
        syncFailure: typeof syncFailure === 'boolean' ? syncFailure : true,
        taskCompleted: typeof taskCompleted === 'boolean' ? taskCompleted : true,
        requestSubmitted: typeof requestSubmitted === 'boolean' ? requestSubmitted : true,
        requestCompleted: typeof requestCompleted === 'boolean' ? requestCompleted : true,
        requestStatusUpdates: typeof requestStatusUpdates === 'boolean' ? requestStatusUpdates : true,
      };
      await storage.setUserNotificationPreferences(req.session.userId!, prefs);
      res.json(prefs);
    } catch (error) {
      console.error("Set notification preferences error:", error);
      res.status(500).json({ error: "Failed to save notification preferences" });
    }
  }));

  app.get("/api/notifications", requireAuth, route(async (req: Request, res: Response) => {
    try {
      const user = await storage.getUserById(req.session.userId!);
      if (!user) return void res.status(401).json({ error: "Not authenticated" });

      const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
      const offset = parseInt(req.query.offset as string) || 0;
      const notifs = await storage.getNotificationsForUser(user.id, limit, offset);
      res.json(notifs);
    } catch (error) {
      console.error("Get notifications error:", error);
      res.status(500).json({ error: "Failed to fetch notifications" });
    }
  }));

  app.get("/api/notifications/unread-count", requireAuth, route(async (req: Request, res: Response) => {
    try {
      const user = await storage.getUserById(req.session.userId!);
      if (!user) return void res.status(401).json({ error: "Not authenticated" });

      const count = await storage.getUnreadNotificationCount(user.id);
      res.json({ count });
    } catch (error) {
      console.error("Get unread count error:", error);
      res.status(500).json({ error: "Failed to get unread count" });
    }
  }));

  app.put("/api/notifications/read-all", requireAuth, route(async (req: Request, res: Response) => {
    try {
      await storage.markAllNotificationsRead(req.session.userId!);
      res.json({ success: true });
    } catch (error) {
      console.error("Mark all read error:", error);
      res.status(500).json({ error: "Failed to mark all read" });
    }
  }));

  app.put("/api/notifications/:id/read", requireAuth, route(async (req: Request, res: Response) => {
    try {
      const notif = await storage.markNotificationRead((req.params.id as string), req.session.userId!);
      if (!notif) return void res.status(404).json({ error: "Notification not found" });
      res.json(notif);
    } catch (error) {
      console.error("Mark read error:", error);
      res.status(500).json({ error: "Failed to mark notification read" });
    }
  }));
}
