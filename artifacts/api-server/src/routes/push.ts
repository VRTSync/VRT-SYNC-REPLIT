import type { Express, Request, Response } from "express";
import { registerPushTokenSchema } from "@workspace/db";
import { requireAuth, requireAdmin } from "../auth";
import * as storage from "../storage";
import { sendDueReminders } from "../pushNotifications";
import { route } from "./handler";

export const PUSH_TOKEN_RATE_LIMIT_MS = 86_400_000; // 24 hours
export const pushTokenLastReg = new Map<string, { ts: number; token: string }>();

export function registerPushRoutes(app: Express): void {
  app.post("/api/push-tokens", requireAuth, route(async (req: Request, res: Response) => {
    try {
      const parsed = registerPushTokenSchema.safeParse(req.body);
      if (!parsed.success) {
        return void res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
      }
      const deviceId = parsed.data.deviceId;
      const newToken = parsed.data.token;
      const now = Date.now();
      const lastReg = pushTokenLastReg.get(deviceId);
      if (lastReg && lastReg.token === newToken && now - lastReg.ts < PUSH_TOKEN_RATE_LIMIT_MS) {
        return void res.status(200).json({ rateLimited: true });
      }
      const pushToken = await storage.registerPushToken(
        req.session.userId!,
        newToken,
        parsed.data.platform,
        deviceId,
      );
      pushTokenLastReg.set(deviceId, { ts: now, token: newToken });
      res.status(201).json(pushToken);
    } catch (error) {
      console.error("Register push token error:", error);
      res.status(500).json({ error: "Failed to register push token" });
    }
  }));

  app.delete("/api/push-tokens", requireAuth, route(async (req: Request, res: Response) => {
    try {
      const { token, deviceId } = req.body;
      if (deviceId) {
        await storage.removePushTokenByDevice(req.session.userId!, deviceId);
        pushTokenLastReg.delete(deviceId);
      } else if (token) {
        await storage.removePushToken(req.session.userId!, token);
        // Clear any Map entry whose stored token matches, so account-switch flows
        // don't leave a stale throttle behind when there is no deviceId to key on.
        for (const [key, entry] of pushTokenLastReg.entries()) {
          if (entry.token === token) {
            pushTokenLastReg.delete(key);
            break;
          }
        }
      } else {
        return void res.status(400).json({ error: "token or deviceId is required" });
      }
      res.json({ message: "Push token removed" });
    } catch (error) {
      console.error("Remove push token error:", error);
      res.status(500).json({ error: "Failed to remove push token" });
    }
  }));

  app.post("/api/push/due-reminders", requireAdmin, route(async (_req: Request, res: Response) => {
    try {
      await sendDueReminders();
      res.json({ message: "Due reminders sent" });
    } catch (error) {
      console.error("Due reminders error:", error);
      res.status(500).json({ error: "Failed to send due reminders" });
    }
  }));
}
