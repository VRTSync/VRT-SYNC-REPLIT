import type { Express, Request, Response } from "express";
import { insertContactSchema, updateContactSchema } from "@workspace/db";
import { requireAuth } from "../auth";
import * as storage from "../storage";
import * as policy from "../policy";
import { route } from "./handler";

export function registerContactRoutes(app: Express): void {
  /* ─── Contacts ──────────────────────────────────────────────────────────── */

  app.get("/api/contacts", requireAuth, route(async (req: Request, res: Response) => {
    try {
      const user = await storage.getUserById(req.session.userId!);
      if (!user) return void res.status(401).json({ error: "User not found" });

      const plan = await policy.contactListPlan(policy.actorFromUser(user), req.query.communityId as string | undefined);
      if (plan === "not_member") return void res.status(403).json({ error: "Not a member of this community" });
      if (plan === "denied") return void res.status(403).json({ error: "Access denied" });
      if (plan.kind === "all" || plan.kind === "community") {
        const results = await storage.getContacts(plan.communityId);
        return void res.json(results);
      }

      // No communityId filter: return contacts for all PM's authorized communities
      const pmCommunities = await storage.getUserCommunitiesList(user.id);
      const pmCommunityIds = pmCommunities.map(c => c.id);
      if (pmCommunityIds.length === 0) return void res.json([]);
      const results = await storage.getContactsForCommunities(pmCommunityIds);
      return void res.json(results);
    } catch (err) {
      console.error("Get contacts error:", err);
      res.status(500).json({ error: "Failed to fetch contacts" });
    }
  }));

  app.post("/api/contacts", requireAuth, route(async (req: Request, res: Response) => {
    try {
      const user = await storage.getUserById(req.session.userId!);
      if (!user) return void res.status(401).json({ error: "User not found" });
      const actor = policy.actorFromUser(user);
      if (!policy.canWriteContacts(actor)) return void res.status(403).json({ error: "Access denied" });

      const parsed = insertContactSchema.safeParse(req.body);
      if (!parsed.success) return void res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });

      const { communityId } = parsed.data;

      const access = await policy.contactCreateAccess(actor, communityId);
      if (access === "not_member") return void res.status(403).json({ error: "Not a member of this community" });
      if (access === "other_community") {
        return void res.status(403).json({ error: "Cannot create contacts for other communities" });
      }

      const contact = await storage.createContact({
        communityId,
        name: parsed.data.name,
        title: parsed.data.title ?? null,
        company: parsed.data.company ?? null,
        phone: parsed.data.phone ?? null,
        email: parsed.data.email ?? null,
        contactType: parsed.data.contactType,
        notes: parsed.data.notes ?? null,
      });
      res.status(201).json(contact);
    } catch (err) {
      console.error("Create contact error:", err);
      res.status(500).json({ error: "Failed to create contact" });
    }
  }));

  app.put("/api/contacts/:id", requireAuth, route(async (req: Request, res: Response) => {
    try {
      const user = await storage.getUserById(req.session.userId!);
      if (!user) return void res.status(401).json({ error: "User not found" });
      const actor = policy.actorFromUser(user);
      if (!policy.canWriteContacts(actor)) return void res.status(403).json({ error: "Access denied" });

      const contact = await storage.getContactById((req.params.id as string));
      if (!contact) return void res.status(404).json({ error: "Contact not found" });

      const access = await policy.contactChangeAccess(actor, contact);
      if (access === "not_member") return void res.status(403).json({ error: "Not a member of this community" });
      if (access === "denied") {
        return void res.status(403).json({ error: "Access denied" });
      }

      const parsed = updateContactSchema.safeParse(req.body);
      if (!parsed.success) return void res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });

      // Validate communityId changes are authorized
      if (parsed.data.communityId && parsed.data.communityId !== contact.communityId) {
        const moveAccess = await policy.contactMoveAccess(actor, parsed.data.communityId);
        if (moveAccess === "hoa_cannot_move") {
          return void res.status(403).json({ error: "Cannot move contacts to another community" });
        }
        if (moveAccess === "not_member_target") {
          return void res.status(403).json({ error: "Not a member of the target community" });
        }
        // admin: unrestricted
      }

      const updated = await storage.updateContact((req.params.id as string), parsed.data);
      if (!updated) return void res.status(404).json({ error: "Contact not found" });
      res.json(updated);
    } catch (err) {
      console.error("Update contact error:", err);
      res.status(500).json({ error: "Failed to update contact" });
    }
  }));

  app.delete("/api/contacts/:id", requireAuth, route(async (req: Request, res: Response) => {
    try {
      const user = await storage.getUserById(req.session.userId!);
      if (!user) return void res.status(401).json({ error: "User not found" });
      const actor = policy.actorFromUser(user);
      if (!policy.canWriteContacts(actor)) return void res.status(403).json({ error: "Access denied" });

      const contact = await storage.getContactById((req.params.id as string));
      if (!contact) return void res.status(404).json({ error: "Contact not found" });

      const access = await policy.contactChangeAccess(actor, contact);
      if (access === "not_member") return void res.status(403).json({ error: "Not a member of this community" });
      if (access === "denied") {
        return void res.status(403).json({ error: "Access denied" });
      }

      await storage.deleteContact((req.params.id as string));
      res.status(204).send();
    } catch (err) {
      console.error("Delete contact error:", err);
      res.status(500).json({ error: "Failed to delete contact" });
    }
  }));
}
