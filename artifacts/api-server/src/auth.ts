import { Request, Response, NextFunction } from "express";
import rateLimit from "express-rate-limit";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { pool, db } from "./db";
import * as storage from "./storage";
import { insertUserSchema, loginSchema, users } from "@workspace/db";
import { ObjectStorageService } from "./objectStorage";

const PgSession = connectPgSimple(session);

export function setupSession(app: any) {
  const sessionSecret = process.env.SESSION_SECRET;
  if (!sessionSecret) {
    console.error("SESSION_SECRET environment variable is required");
    process.exit(1);
  }
  app.use(
    session({
      store: new PgSession({
        pool: pool as any,
        tableName: "user_sessions",
        createTableIfMissing: true,
      }),
      secret: sessionSecret,
      resave: false,
      saveUninitialized: false,
      cookie: {
        secure: process.env.NODE_ENV === "production",
        httpOnly: true,
        maxAge: 30 * 24 * 60 * 60 * 1000,
        sameSite: "lax",
      },
    })
  );
}

declare module "express-session" {
  interface SessionData {
    userId: string;
    hoaCommunityId?: string;
    organizationId?: string;
  }
}

export function isHoaRole(role: string): boolean {
  return role === 'hoa_admin' || role === 'hoa_member';
}

export function isMapCreatorRole(role: string): boolean {
  return role === 'map_creator';
}

export function isClientRole(role: string): boolean {
  return role === 'client_admin';
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session.userId) {
    return res.status(401).json({ message: "Not authenticated" });
  }
  next();
}

export function enforceHoaScoping(req: Request, res: Response, next: NextFunction) {
  if (!req.session.userId) {
    return res.status(401).json({ message: "Not authenticated" });
  }
  const hoaCommunityId = req.session.hoaCommunityId;
  if (!hoaCommunityId) {
    return next();
  }
  const communityId =
    req.params.id || req.params.communityId ||
    req.query.communityId ||
    req.body?.communityId;
  if (communityId && communityId !== hoaCommunityId) {
    return res.status(403).json({ message: "Access denied: HOA users can only access their assigned community" });
  }
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.session.userId) {
    return res.status(401).json({ message: "Not authenticated" });
  }
  storage.getUserById(req.session.userId).then((user) => {
    if (!user || user.role !== "admin") {
      return res.status(403).json({ message: "Admin access required" });
    }
    next();
  }).catch(() => {
    res.status(500).json({ message: "Internal error" });
  });
}

export async function requireClient(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!req.session.userId) {
    res.status(401).json({ message: "Not authenticated" });
    return;
  }
  try {
    const user = await storage.getUserById(req.session.userId);
    if (!user || !isClientRole(user.role)) {
      res.status(403).json({ message: "Client access required" });
      return;
    }
    (req as any).currentUser = user;
    next();
  } catch {
    res.status(500).json({ message: "Internal error" });
  }
}

export async function enforceOrgScoping(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!req.session.userId) {
    // Unauthenticated requests are handled downstream; don't block here
    next();
    return;
  }
  try {
    const user = await storage.getUserById(req.session.userId);
    if (!user || !isClientRole(user.role)) {
      // Non-client roles are not org-scoped; pass through
      next();
      return;
    }
    const userOrgId = user.organizationId;
    if (!userOrgId) {
      res.status(403).json({ message: "Access denied: client user has no organization" });
      return;
    }
    // Check if a specific organizationId appears in params/query/body
    const targetOrgId = (req.params as any).organizationId ?? (req.query as any).organizationId ?? req.body?.organizationId;
    if (targetOrgId && targetOrgId !== userOrgId) {
      res.status(403).json({ message: "Access denied: cross-organization access is not allowed" });
      return;
    }
    // Check if a specific community is targeted — enforce it belongs to the same org
    const communityId = req.params.id || (req.params as any).communityId || req.query.communityId || req.body?.communityId;
    if (communityId) {
      const community = await storage.getCommunityById(communityId as string);
      if (!community) {
        res.status(404).json({ message: "Community not found" });
        return;
      }
      if (community.organizationId !== userOrgId) {
        res.status(403).json({ message: "Access denied: community belongs to a different organization" });
        return;
      }
    }
    next();
  } catch {
    res.status(500).json({ message: "Internal error" });
  }
}

export function requireAdminOrMapCreator(req: Request, res: Response, next: NextFunction) {
  if (!req.session.userId) {
    return res.status(401).json({ message: "Not authenticated" });
  }
  storage.getUserById(req.session.userId).then((user) => {
    if (!user || (user.role !== "admin" && !isMapCreatorRole(user.role))) {
      return res.status(403).json({ message: "Admin or map creator access required" });
    }
    (req as any).currentUser = user;
    next();
  }).catch(() => {
    res.status(500).json({ message: "Internal error" });
  });
}

/**
 * requireClientOrAdmin — passes for admin OR client_admin roles.
 * Sets req.currentUser in both cases. Do not modify requireClient or enforceOrgScoping.
 */
export async function requireClientOrAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!req.session.userId) {
    res.status(401).json({ message: "Not authenticated" });
    return;
  }
  try {
    const user = await storage.getUserById(req.session.userId);
    if (!user || (user.role !== "admin" && !isClientRole(user.role))) {
      res.status(403).json({ message: "Client admin or admin access required" });
      return;
    }
    (req as any).currentUser = user;
    next();
  } catch {
    res.status(500).json({ message: "Internal error" });
  }
}

// Rate limiters for auth endpoints
// Verification: send 11 rapid POSTs to /api/auth/login — the 11th returns 429.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many login attempts. Try again later." },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many requests. Try again later." },
});

export function registerAuthRoutes(app: any) {
  app.post("/api/auth/register", authLimiter, async (req: Request, res: Response) => {
    try {
      const parsed = insertUserSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid input", errors: parsed.error.flatten() });
      }

      const existing = await storage.getUserByUsername(parsed.data.username);
      if (existing) {
        return res.status(409).json({ message: "Username already taken" });
      }

      const hashedPassword = await bcrypt.hash(parsed.data.password, 10);
      const user = await storage.createUser({
        ...parsed.data,
        password: hashedPassword,
      });

      req.session.userId = user.id;
      if (isHoaRole(user.role) && user.hoaCommunityId) {
        req.session.hoaCommunityId = user.hoaCommunityId;
      }
      if (isClientRole(user.role) && user.organizationId) {
        req.session.organizationId = user.organizationId;
      }
      const { password: _, ...safeUser } = user;
      res.status(201).json(safeUser);
    } catch (error) {
      console.error("Register error:", error);
      res.status(500).json({ message: "Registration failed" });
    }
  });

  app.post("/api/auth/login", loginLimiter, async (req: Request, res: Response) => {
    try {
      const parsed = loginSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid input" });
      }

      const user = await storage.getUserByUsername(parsed.data.username);
      if (!user) {
        return res.status(401).json({ message: "Invalid credentials" });
      }

      const valid = await bcrypt.compare(parsed.data.password, user.password);
      if (!valid) {
        return res.status(401).json({ message: "Invalid credentials" });
      }

      req.session.userId = user.id;
      if (isHoaRole(user.role) && user.hoaCommunityId) {
        req.session.hoaCommunityId = user.hoaCommunityId;
      }
      if (isClientRole(user.role) && user.organizationId) {
        req.session.organizationId = user.organizationId;
      }
      const { password: _, ...safeUser } = user;
      await new Promise<void>((resolve, reject) =>
        req.session.save((err) => (err ? reject(err) : resolve()))
      );
      res.json(safeUser);
    } catch (error) {
      console.error("Login error:", error);
      res.status(500).json({ message: "Login failed" });
    }
  });

  app.post("/api/auth/logout", authLimiter, async (req: Request, res: Response) => {
    const userId = req.session?.userId;
    const { deviceId } = req.body ?? {};
    if (userId && deviceId) {
      try {
        await storage.removePushTokenByDevice(userId, deviceId);
      } catch (err) {
        console.error("Failed to remove push token on logout:", err);
      }
    }
    req.session.destroy((err) => {
      if (err) {
        return res.status(500).json({ message: "Logout failed" });
      }
      res.json({ message: "Logged out" });
    });
  });

  app.post("/api/auth/verify-password", authLimiter, requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const { currentPassword } = req.body;
      if (!currentPassword || typeof currentPassword !== "string") {
        return res.status(400).json({ message: "Current password is required" });
      }
      const user = await storage.getUserById(userId);
      if (!user) {
        return res.status(401).json({ message: "User not found" });
      }
      const valid = await bcrypt.compare(currentPassword, user.password);
      if (!valid) {
        return res.status(400).json({ message: "Current password is incorrect" });
      }
      res.json({ verified: true });
    } catch (error) {
      console.error("Verify password error:", error);
      res.status(500).json({ message: "Failed to verify password" });
    }
  });

  app.patch("/api/auth/me", authLimiter, requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const { displayName, currentPassword, newPassword, avatarUrl } = req.body;

      if (displayName !== undefined && (typeof displayName !== "string" || displayName.trim().length === 0)) {
        return res.status(400).json({ message: "Display name cannot be empty" });
      }

      const user = await storage.getUserById(userId);
      if (!user) {
        return res.status(401).json({ message: "User not found" });
      }

      const updates: { displayName?: string; password?: string; avatarUrl?: string | null } = {};

      if (displayName !== undefined) {
        if (!currentPassword || typeof currentPassword !== "string") {
          return res.status(400).json({ message: "Current password is required to update your display name" });
        }
        const valid = await bcrypt.compare(currentPassword, user.password);
        if (!valid) {
          return res.status(400).json({ message: "Current password is incorrect" });
        }
        updates.displayName = displayName.trim();
      }

      if (avatarUrl !== undefined) {
        if (avatarUrl === null || avatarUrl === "") {
          updates.avatarUrl = null;
        } else if (typeof avatarUrl !== "string") {
          return res.status(400).json({ message: "Invalid avatar URL" });
        } else {
          try {
            const objectStorageService = new ObjectStorageService();
            const normalized = await objectStorageService.trySetObjectEntityAclPolicy(avatarUrl, {
              owner: userId,
              visibility: "public",
            });
            if (!normalized.startsWith("/objects/")) {
              return res.status(400).json({ message: "Invalid avatar URL" });
            }
            updates.avatarUrl = normalized;
          } catch (err) {
            console.error("Avatar ACL error:", err);
            return res.status(400).json({ message: "Failed to save avatar" });
          }
        }
      }

      if (newPassword !== undefined) {
        if (!currentPassword) {
          return res.status(400).json({ message: "Current password is required to set a new password" });
        }
        if (typeof newPassword !== "string" || newPassword.length < 6) {
          return res.status(400).json({ message: "New password must be at least 6 characters" });
        }
        const valid = await bcrypt.compare(currentPassword, user.password);
        if (!valid) {
          return res.status(400).json({ message: "Current password is incorrect" });
        }
        updates.password = await bcrypt.hash(newPassword, 10);
      }

      if (Object.keys(updates).length === 0) {
        const { password: _, ...safeUser } = user;
        return res.json(safeUser);
      }

      const [updated] = await db
        .update(users)
        .set(updates)
        .where(eq(users.id, userId))
        .returning();

      if (!updated) {
        return res.status(500).json({ message: "Failed to update user" });
      }

      const { password: _, ...safeUser } = updated;
      res.json(safeUser);
    } catch (error) {
      console.error("Update me error:", error);
      res.status(500).json({ message: "Failed to update account" });
    }
  });

  app.get("/api/auth/me", async (req: Request, res: Response) => {
    if (!req.session.userId) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    const user = await storage.getUserById(req.session.userId);
    if (!user) {
      return res.status(401).json({ message: "User not found" });
    }
    const { password: _, ...safeUser } = user;

    let communities: any[] = [];
    if (user.role === "admin") {
      communities = await storage.getCommunities();
    } else if (isHoaRole(user.role) && user.hoaCommunityId) {
      const community = await storage.getCommunityById(user.hoaCommunityId);
      if (community) {
        communities = [community];
      }
    } else {
      const memberships = await storage.getUserCommunities(user.id);
      communities = memberships.map((m) => m.community);
    }

    const defaultCommunityId = isHoaRole(user.role) && user.hoaCommunityId
      ? user.hoaCommunityId
      : (communities.length > 0 ? communities[0].id : null);

    res.json({
      user: safeUser,
      communities,
      defaultCommunityId,
    });
  });
}
