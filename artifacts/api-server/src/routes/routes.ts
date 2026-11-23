import type { Express, Request, Response } from "express";
import { createServer, type Server } from "node:http";
import { registerTaskRoutes } from "./tasks";
import { registerAssetRoutes } from "./assets";
import { registerMapLayerRoutes } from "./mapLayers";
import { registerAssetTypeRoutes } from "./assetTypes";
import { registerOfflinePackRoutes } from "./offlinePacks";
import { registerHoaRoutes } from "./hoa";
import { registerPortfolioRoutes } from "./portfolio";
import { registerPortfolioWorkOrderRoutes } from "./portfolioWorkOrders";
import { registerInvoiceRoutes } from "./invoices";
import { registerReportRoutes } from "./reports";
import { registerContractRoutes } from "./contracts";
import { registerObjectRoutes } from "./objects";
import { registerDriveRoutes } from "./drive";
import { registerContactRoutes } from "./contacts";
import { registerCommunityRoutes } from "./communities";
import { registerDashboardRoutes } from "./dashboard";
import { registerSearchRoutes } from "./search";
import { registerCompanyRoutes } from "./companies";
import { registerUserRoutes } from "./users";
import { registerServiceScheduleRoutes } from "./serviceSchedules";
import { registerNotificationRoutes } from "./notifications";
import { registerPushRoutes } from "./push";
import { registerAdminOverviewRoutes } from "./adminOverview";
import { registerXeriscapeRoutes } from "./xeriscape";
import { registerTaskTemplateRoutes } from "./taskTemplates";
import { registerTaskScheduleRoutes } from "./taskSchedules";
import { registerExportRoutes } from "./exports";
import { registerImportRoutes } from "./imports";
import { registerOrganizationRoutes } from "./organizations";
import { enforceOrgScoping, registerAuthRoutes, enforceHoaScoping } from "../auth";

export { PUSH_TOKEN_RATE_LIMIT_MS, pushTokenLastReg } from "./push";

export async function registerRoutes(app: Express): Promise<Server> {
  registerAuthRoutes(app);

  app.use("/api", enforceHoaScoping);
  app.use("/api", enforceOrgScoping);

  registerObjectRoutes(app);

  registerCommunityRoutes(app);
  registerDashboardRoutes(app);

  registerTaskRoutes(app);

  registerAdminOverviewRoutes(app);

  registerXeriscapeRoutes(app);

  registerCompanyRoutes(app);
  registerUserRoutes(app);

  app.get("/api/ping", (_req: Request, res: Response) => {
    res.json({ ok: true, ts: Date.now() });
  });

  registerPushRoutes(app);

  registerAssetRoutes(app);

  registerMapLayerRoutes(app);

  registerSearchRoutes(app);

  // ── Asset Types catalogue (data-driven) ──────────────────────────────────

  registerAssetTypeRoutes(app);
  registerOfflinePackRoutes(app);

  registerTaskTemplateRoutes(app);

  registerTaskScheduleRoutes(app);

  registerExportRoutes(app);

  registerServiceScheduleRoutes(app);

  registerImportRoutes(app);

  registerHoaRoutes(app);

  registerNotificationRoutes(app);

  registerInvoiceRoutes(app);
  registerReportRoutes(app);
  registerContractRoutes(app);

  registerDriveRoutes(app);
  registerContactRoutes(app);

  registerPortfolioRoutes(app);
  registerPortfolioWorkOrderRoutes(app);

  registerOrganizationRoutes(app);

  const httpServer = createServer(app);
  return httpServer;
}
