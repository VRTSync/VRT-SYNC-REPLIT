import * as storage from "./storage";
import type { Task } from "@shared/schema";

type PushPayload = {
  title: string;
  body: string;
  data?: Record<string, string>;
};

export async function sendPushToUser(userId: string, payload: PushPayload): Promise<void> {
  const tokens = await storage.getTokensForUser(userId);
  if (tokens.length === 0) return;

  const messages = tokens.map((t) => ({
    to: t.token,
    sound: "default" as const,
    title: payload.title,
    body: payload.body,
    data: payload.data || {},
  }));

  try {
    const response = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(messages),
    });

    if (response.ok) {
      const result = await response.json();
      const data = result.data;
      if (Array.isArray(data)) {
        for (let i = 0; i < data.length; i++) {
          if (data[i].status === "error" && data[i].details?.error === "DeviceNotRegistered") {
            await storage.pruneInvalidToken(tokens[i].token);
          }
        }
      }
    }
  } catch (error) {
    console.error("Push notification send error:", error);
  }
}

export async function notifyTaskAssigned(taskId: string, taskTitle: string, communityName: string, assignedToUserId: string): Promise<void> {
  await sendPushToUser(assignedToUserId, {
    title: "New task assigned",
    body: `${taskTitle} – ${communityName}`,
    data: { type: "task_assigned", taskId },
  });
}

export async function sendDueReminders(): Promise<void> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const dueTasks = await storage.getTasksDueInRange(today, tomorrow);

  const byUser = new Map<string, { count: number; communityId: string }>();
  for (const task of dueTasks) {
    if (!task.assignedTo) continue;
    const existing = byUser.get(task.assignedTo);
    if (existing) {
      existing.count++;
    } else {
      byUser.set(task.assignedTo, { count: 1, communityId: task.communityId });
    }
  }

  for (const [userId, info] of byUser) {
    await sendPushToUser(userId, {
      title: "Tasks due today",
      body: `You have ${info.count} task${info.count > 1 ? 's' : ''} due today`,
      data: { type: "task_due", communityId: info.communityId },
    });
  }
}

export async function notifyTaskCompleted(task: Task): Promise<void> {
  try {
    const hoaAdmin = await storage.getHoaAdminForCommunity(task.communityId);
    if (!hoaAdmin) return;

    const isHoaRequest = task.origin === "HOA";
    const type = isHoaRequest ? "HOA_REQUEST_COMPLETED" : "TASK_COMPLETED";
    const title = isHoaRequest ? "Request completed" : "Task completed";
    const body = task.title;

    await storage.createNotification({
      communityId: task.communityId,
      recipientUserId: hoaAdmin.id,
      type,
      title,
      body,
      relatedTaskId: task.id,
    });

    await sendPushToUser(hoaAdmin.id, {
      title,
      body,
      data: { type, taskId: task.id },
    });
  } catch (error) {
    console.error("notifyTaskCompleted error:", error);
  }
}

export async function notifyHoaRequestSubmitted(task: Task): Promise<void> {
  try {
    const contractors = await storage.getContractorsForCommunity(task.communityId);
    if (contractors.length === 0) return;

    const title = "New HOA request";
    const body = task.title;

    for (const contractor of contractors) {
      await storage.createNotification({
        communityId: task.communityId,
        recipientUserId: contractor.id,
        type: "HOA_REQUEST_SUBMITTED",
        title,
        body,
        relatedTaskId: task.id,
      });

      await sendPushToUser(contractor.id, {
        title,
        body,
        data: { type: "HOA_REQUEST_SUBMITTED", taskId: task.id },
      });
    }
  } catch (error) {
    console.error("notifyHoaRequestSubmitted error:", error);
  }
}
