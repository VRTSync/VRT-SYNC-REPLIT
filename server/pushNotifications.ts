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
        const ticketEntries: { ticketId: string; token: string }[] = [];
        for (let i = 0; i < data.length; i++) {
          if (data[i].status === "error" && data[i].details?.error === "DeviceNotRegistered") {
            await storage.pruneInvalidToken(tokens[i].token);
          } else if (data[i].status === "ok" && data[i].id) {
            ticketEntries.push({ ticketId: data[i].id, token: tokens[i].token });
          }
        }
        if (ticketEntries.length > 0) {
          await storage.insertPushTickets(ticketEntries).catch((err) =>
            console.error("Failed to persist push tickets:", err)
          );
        }
      }
    }
  } catch (error) {
    console.error("Push notification send error:", error);
  }
}

export async function processReceiptsForPendingTickets(): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - 15 * 60 * 1000);
    const pendingTickets = await storage.getPendingPushTicketsOlderThan(cutoff);
    if (pendingTickets.length === 0) return;

    const BATCH_SIZE = 300;
    for (let i = 0; i < pendingTickets.length; i += BATCH_SIZE) {
      const batch = pendingTickets.slice(i, i + BATCH_SIZE);
      const ticketIdToToken = new Map(batch.map((t) => [t.ticketId, t.token]));

      try {
        const response = await fetch("https://exp.host/--/api/v2/push/getReceipts", {
          method: "POST",
          headers: {
            "Accept": "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ ids: Array.from(ticketIdToToken.keys()) }),
        });

        if (response.ok) {
          const result = await response.json();
          const receipts = result.data as Record<string, { status: string; details?: { error?: string } }>;
          for (const [ticketId, receipt] of Object.entries(receipts)) {
            if (receipt.status === "error" && receipt.details?.error === "DeviceNotRegistered") {
              const token = ticketIdToToken.get(ticketId);
              if (token) {
                await storage.pruneInvalidToken(token);
              }
            }
          }
        }
      } catch (err) {
        console.error("Error fetching push receipts batch:", err);
      }

      await storage.deletePushTicketsByIds(batch.map((t) => t.id));
    }
  } catch (error) {
    console.error("processReceiptsForPendingTickets error:", error);
  }
}

export async function notifyTaskAssigned(taskId: string, taskTitle: string, communityName: string, assignedToUserId: string): Promise<void> {
  try {
    const task = await storage.getTaskById(taskId);
    if (!task) return;

    const prefs = await storage.getUserNotificationPreferences(assignedToUserId);
    if (!prefs.taskAssigned) return;

    const title = "New task assigned";
    const body = `${taskTitle} – ${communityName}`;

    await storage.createNotification({
      communityId: task.communityId,
      recipientUserId: assignedToUserId,
      type: "TASK_ASSIGNED",
      title,
      body,
      relatedTaskId: taskId,
    });

    await sendPushToUser(assignedToUserId, {
      title,
      body,
      data: { type: "task_assigned", taskId },
    });
  } catch (error) {
    console.error("notifyTaskAssigned error:", error);
  }
}

export async function notifyRequestAcknowledged(taskId: string): Promise<void> {
  try {
    const task = await storage.getTaskById(taskId);
    if (!task || !task.createdBy) return;

    const title = "Request Acknowledged";
    const body = task.title;

    await storage.createNotification({
      communityId: task.communityId,
      recipientUserId: task.createdBy,
      type: "HOA_REQUEST_ACKNOWLEDGED",
      title,
      body,
      relatedTaskId: taskId,
    });

    await sendPushToUser(task.createdBy, {
      title,
      body,
      data: { type: "HOA_REQUEST_ACKNOWLEDGED", taskId },
    });
  } catch (error) {
    console.error("notifyRequestAcknowledged error:", error);
  }
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
    const prefs = await storage.getUserNotificationPreferences(userId);
    if (!prefs.dueReminders) continue;

    const title = "Tasks due today";
    const body = `You have ${info.count} task${info.count > 1 ? 's' : ''} due today`;

    await storage.createNotification({
      communityId: info.communityId,
      recipientUserId: userId,
      type: "TASK_DUE_REMINDER",
      title,
      body,
    });

    await sendPushToUser(userId, {
      title,
      body,
      data: { type: "task_due", communityId: info.communityId },
    });
  }
}

export async function notifyTaskCompleted(task: Task): Promise<void> {
  try {
    const isHoaRequest = task.origin === "HOA";
    const type = isHoaRequest ? "HOA_REQUEST_COMPLETED" : "TASK_COMPLETED";
    const title = isHoaRequest ? "Request completed" : "Task completed";
    const body = task.title;

    const [hoaAdmins, propertyManagers] = await Promise.all([
      storage.getHoaAdminsForCommunity(task.communityId),
      storage.getPropertyManagersForCommunity(task.communityId),
    ]);

    const recipients = [...hoaAdmins, ...propertyManagers];

    await Promise.all(recipients.map(async (recipient) => {
      await storage.createNotification({
        communityId: task.communityId,
        recipientUserId: recipient.id,
        type,
        title,
        body,
        relatedTaskId: task.id,
      });
      await sendPushToUser(recipient.id, {
        title,
        body,
        data: { type, taskId: task.id },
      });
    }));
  } catch (error) {
    console.error("notifyTaskCompleted error:", error);
  }
}

export async function notifyHoaRequestSubmitted(task: Task): Promise<void> {
  try {
    const title = "New HOA request";
    const body = task.title;

    const [hoaAdmins, propertyManagers] = await Promise.all([
      storage.getHoaAdminsForCommunity(task.communityId),
      storage.getPropertyManagersForCommunity(task.communityId),
    ]);

    const assignedRecipient = task.assignedTo
      ? [{ id: task.assignedTo }]
      : [];

    const hoaAndPmRecipients = [...hoaAdmins, ...propertyManagers]
      .filter(u => u.id !== task.assignedTo);

    const allRecipients = [...assignedRecipient, ...hoaAndPmRecipients];

    await Promise.all(allRecipients.map(async (recipient) => {
      await storage.createNotification({
        communityId: task.communityId,
        recipientUserId: recipient.id,
        type: "HOA_REQUEST_SUBMITTED",
        title,
        body,
        relatedTaskId: task.id,
      });
      await sendPushToUser(recipient.id, {
        title,
        body,
        data: { type: "HOA_REQUEST_SUBMITTED", taskId: task.id },
      });
    }));
  } catch (error) {
    console.error("notifyHoaRequestSubmitted error:", error);
  }
}
