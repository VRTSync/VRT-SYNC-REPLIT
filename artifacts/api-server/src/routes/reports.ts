import type { Express, Request, Response } from "express";
import { requireAuth } from "../auth";
import * as storage from "../storage";
import { pool } from "../db";
import * as policy from "../policy";
import { route } from "./handler";

export function registerReportRoutes(app: Express): void {
  /* ─── Reports ────────────────────────────────────────────────────────── */

  app.get("/api/reports/water-usage", requireAuth, route(async (req: Request, res: Response) => {
    try {
      const user = await storage.getUserById(req.session.userId!);
      if (!user || !policy.canReadReports(policy.actorFromUser(user))) return void res.status(403).json({ error: "Access denied" });
      const scope = await policy.reportCommunity(policy.actorFromUser(user), req.query.communityId as string | undefined);
      if (scope === "community_required") return void res.status(400).json({ error: "communityId is required" });
      if (scope === "not_member") return void res.status(403).json({ error: "Access denied" });
      const { communityId } = scope;

      const rows = await pool.query(
        `SELECT month, year, usage_amount, unit, notes FROM water_usage WHERE community_id = $1 ORDER BY year DESC, month DESC`,
        [communityId]
      );
      res.json(rows.rows);
    } catch (error) {
      console.error("Water usage report error:", error);
      res.status(500).json({ error: "Failed to fetch water usage report" });
    }
  }));

  app.get("/api/reports/tree-inventory", requireAuth, route(async (req: Request, res: Response) => {
    try {
      const user = await storage.getUserById(req.session.userId!);
      if (!user || !policy.canReadReports(policy.actorFromUser(user))) return void res.status(403).json({ error: "Access denied" });
      const scope = await policy.reportCommunity(policy.actorFromUser(user), req.query.communityId as string | undefined);
      if (scope === "community_required") return void res.status(400).json({ error: "communityId is required" });
      if (scope === "not_member") return void res.status(403).json({ error: "Access denied" });
      const { communityId } = scope;

      const rows = await pool.query(
        `SELECT ap.value AS species, COUNT(a.id)::int AS count
         FROM assets a
         LEFT JOIN asset_properties ap ON ap.asset_id = a.id AND ap.key = 'species'
         WHERE a.community_id = $1 AND a.asset_type = 'tree' AND a.is_archived = false
         GROUP BY ap.value
         ORDER BY count DESC, ap.value ASC NULLS LAST`,
        [communityId]
      );
      const totalRows = await pool.query(
        `SELECT COUNT(a.id)::int AS total FROM assets a WHERE a.community_id = $1 AND a.asset_type = 'tree' AND a.is_archived = false`,
        [communityId]
      );
      res.json({ groups: rows.rows, total: totalRows.rows[0]?.total || 0 });
    } catch (error) {
      console.error("Tree inventory report error:", error);
      res.status(500).json({ error: "Failed to fetch tree inventory report" });
    }
  }));

  app.get("/api/reports/invoices/monthly", requireAuth, route(async (req: Request, res: Response) => {
    try {
      const user = await storage.getUserById(req.session.userId!);
      if (!user || !policy.canReadReports(policy.actorFromUser(user))) return void res.status(403).json({ error: "Access denied" });
      const scope = await policy.reportCommunity(policy.actorFromUser(user), req.query.communityId as string | undefined);
      if (scope === "community_required") return void res.status(400).json({ error: "communityId is required" });
      if (scope === "not_member") return void res.status(403).json({ error: "Access denied" });
      const { communityId } = scope;

      const month = parseInt(req.query.month as string, 10);
      const year = parseInt(req.query.year as string, 10);
      if (!month || !year || month < 1 || month > 12) {
        return void res.status(400).json({ error: "Valid month (1-12) and year are required" });
      }

      const rows = await pool.query(
        `SELECT id, contractor, completion_date, service_type, cost, notes, pdf_object_key, attachment_label
         FROM invoices
         WHERE community_id = $1
           AND EXTRACT(MONTH FROM completion_date::date) = $2
           AND EXTRACT(YEAR FROM completion_date::date) = $3
         ORDER BY completion_date DESC`,
        [communityId, month, year]
      );

      const grouped: Record<string, { serviceType: string; invoices: any[]; subtotal: number }> = {};
      let total = 0;
      for (const inv of rows.rows) {
        const key = inv.service_type || 'Other';
        if (!grouped[key]) grouped[key] = { serviceType: key, invoices: [], subtotal: 0 };
        grouped[key].invoices.push({
          id: inv.id,
          contractor: inv.contractor,
          completionDate: inv.completion_date,
          serviceType: inv.service_type,
          cost: inv.cost,
          notes: inv.notes,
          pdfObjectKey: inv.pdf_object_key,
          attachmentLabel: inv.attachment_label,
        });
        grouped[key].subtotal += Number(inv.cost || 0);
        total += Number(inv.cost || 0);
      }

      res.json({ groups: Object.values(grouped), total });
    } catch (error) {
      console.error("Monthly invoices report error:", error);
      res.status(500).json({ error: "Failed to fetch monthly invoice report" });
    }
  }));
}
