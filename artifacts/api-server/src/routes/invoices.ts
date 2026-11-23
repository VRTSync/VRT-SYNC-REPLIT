import type { Express, Request, Response } from "express";
import { insertInvoiceSchema, updateInvoiceSchema } from "@workspace/db";
import { requireAuth } from "../auth";
import * as storage from "../storage";
import * as policy from "../policy";
import { route } from "./handler";

export function registerInvoiceRoutes(app: Express): void {
  app.get("/api/invoices", requireAuth, route(async (req: Request, res: Response) => {
    try {
      const user = await storage.getUserById(req.session.userId!);
      if (!user) return void res.status(401).json({ error: "User not found" });
      const plan = await policy.invoiceListPlan(policy.actorFromUser(user), {
        communityId: req.query.communityId as string | undefined,
        sessionOrganizationId: req.session.organizationId,
      });
      switch (plan.kind) {
        case "denied":
        case "not_member":
          return void res.status(403).json({ error: "Access denied" });
        case "no_organization":
          return void res.status(403).json({ error: "Access denied: no organization" });
        case "community_required":
          return void res.status(400).json({ error: "communityId is required" });
        case "manager":
          return void res.json(await storage.getManagerInvoices(user.id, plan.communityId));
        case "all":
        case "community":
          return void res.json(await storage.getInvoices(plan.communityId));
        case "organization":
          return void res.json(await storage.getInvoicesByOrganization(plan.orgId));
      }
    } catch (error) {
      console.error("Get invoices error:", error);
      res.status(500).json({ error: "Failed to fetch invoices" });
    }
  }));

  app.get("/api/invoices/:id", requireAuth, route(async (req: Request, res: Response) => {
    try {
      const user = await storage.getUserById(req.session.userId!);
      if (!user) return void res.status(401).json({ error: "User not found" });
      const actor = policy.actorFromUser(user);
      if (!policy.canRequestInvoice(actor)) return void res.status(403).json({ error: "Access denied" });

      const invoice = await storage.getInvoiceById((req.params.id as string));
      if (!invoice) return void res.status(404).json({ error: "Invoice not found" });
      const access = await policy.invoiceReadAccess(actor, invoice, { sessionOrganizationId: req.session.organizationId });
      if (access === "no_organization") return void res.status(403).json({ error: "Access denied: no organization" });
      if (access === "denied") return void res.status(403).json({ error: "Access denied" });
      res.json(invoice);
    } catch (error) {
      console.error("Get invoice error:", error);
      res.status(500).json({ error: "Failed to fetch invoice" });
    }
  }));

  app.post("/api/invoices", requireAuth, route(async (req: Request, res: Response) => {
    try {
      const actor = policy.actorFromUser(req.currentUser!);
      if (!policy.canManageInvoices(actor)) return void res.status(403).json({ message: "Admin access required" });
      let input = req.body;
      if (policy.hasFixedInvoiceCompany(actor)) {
        if (!await policy.managerCanCreateInvoice(actor, input.communityId)) {
          return void res.status(403).json({ error: "Access denied" });
        }
        const company = await storage.getCompanyById(actor.companyId!);
        if (!company) return void res.status(403).json({ error: "Access denied" });
        const statusRule = policy.invoiceStatusRule(actor, input.status, "create");
        if (statusRule === "staff_only") return void res.status(403).json({ error: "Only VRTSync staff can approve invoices" });
        if (statusRule === "invalid") {
          return void res.status(400).json({ error: "Account managers can create only draft or submitted invoices" });
        }
        input = { ...input, contractorCompanyId: actor.companyId, contractor: company.name };
      }
      const parsed = insertInvoiceSchema.safeParse(input);
      if (!parsed.success) return void res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
      if (parsed.data.attachmentLayerId) {
        const layer = await storage.getMapLayerById(parsed.data.attachmentLayerId);
        if (!layer || layer.communityId !== parsed.data.communityId) {
          return void res.status(400).json({ error: "Attachment layer does not belong to the selected community" });
        }
      }
      const invoice = await storage.createInvoice(parsed.data);
      res.status(201).json(invoice);
    } catch (error) {
      if (error instanceof storage.WorkValidationError) return void res.status(400).json({ error: error.message });
      console.error("Create invoice error:", error);
      res.status(500).json({ error: "Failed to create invoice" });
    }
  }));

  app.put("/api/invoices/:id", requireAuth, route(async (req: Request, res: Response) => {
    try {
      const actor = policy.actorFromUser(req.currentUser!);
      if (!policy.canManageInvoices(actor)) return void res.status(403).json({ message: "Admin access required" });
      const existing = await storage.getInvoiceById((req.params.id as string));
      if (!existing) return void res.status(404).json({ error: "Invoice not found" });
      if (policy.hasFixedInvoiceCompany(actor)) {
        if (!await policy.managerCanWriteInvoice(actor, existing)) {
          return void res.status(403).json({ error: "Access denied" });
        }
        const statusRule = policy.invoiceStatusRule(actor, req.body.status, "update");
        if (statusRule === "staff_only") return void res.status(403).json({ error: "Only VRTSync staff can approve invoices" });
        if (statusRule === "invalid") {
          return void res.status(400).json({ error: "Invalid invoice status" });
        }
      }
      const parsed = (policy.hasFixedInvoiceCompany(actor)
        ? updateInvoiceSchema.omit({ contractorCompanyId: true }) : updateInvoiceSchema).safeParse(req.body);
      if (!parsed.success) return void res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
      const targetCommunityId = (parsed.data as any).communityId || existing.communityId;
      if (parsed.data.attachmentLayerId) {
        const layer = await storage.getMapLayerById(parsed.data.attachmentLayerId);
        if (!layer || layer.communityId !== targetCommunityId) {
          return void res.status(400).json({ error: "Attachment layer does not belong to the selected community" });
        }
      }
      const updated = await storage.updateInvoice((req.params.id as string), parsed.data);
      res.json(updated);
    } catch (error) {
      if (error instanceof storage.WorkValidationError) return void res.status(400).json({ error: error.message });
      console.error("Update invoice error:", error);
      res.status(500).json({ error: "Failed to update invoice" });
    }
  }));

  app.delete("/api/invoices/:id", requireAuth, route(async (req: Request, res: Response) => {
    try {
      const actor = policy.actorFromUser(req.currentUser!);
      if (!policy.canManageInvoices(actor)) return void res.status(403).json({ message: "Admin access required" });
      const existing = await storage.getInvoiceById((req.params.id as string));
      if (!existing) return void res.status(404).json({ error: "Invoice not found" });
      if (!await policy.canDeleteInvoice(actor, existing)) {
        return void res.status(403).json({ error: "Only your company's draft invoices can be deleted" });
      }
      await storage.deleteInvoice((req.params.id as string));
      res.status(204).send();
    } catch (error) {
      console.error("Delete invoice error:", error);
      res.status(500).json({ error: "Failed to delete invoice" });
    }
  }));
}
