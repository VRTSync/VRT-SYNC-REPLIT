import { Request, Response, NextFunction } from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import bcrypt from "bcryptjs";
import { pool } from "./db";
import * as storage from "./storage";
import { insertUserSchema, loginSchema } from "@shared/schema";

const PgSession = connectPgSimple(session);

export function setupSession(app: any) {
  app.use(
    session({
      store: new PgSession({
        pool: pool as any,
        tableName: "user_sessions",
        createTableIfMissing: true,
      }),
      secret: process.env.SESSION_SECRET || "contractor-portal-secret-key",
      resave: false,
      saveUninitialized: false,
      cookie: {
        secure: false,
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
  }
}

export function isHoaRole(role: string): boolean {
  return role === 'hoa_admin' || role === 'hoa_member';
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

export function registerAuthRoutes(app: any) {
  app.post("/api/auth/register", async (req: Request, res: Response) => {
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
      const { password: _, ...safeUser } = user;
      res.status(201).json(safeUser);
    } catch (error) {
      console.error("Register error:", error);
      res.status(500).json({ message: "Registration failed" });
    }
  });

  app.post("/api/auth/login", async (req: Request, res: Response) => {
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
      const { password: _, ...safeUser } = user;
      res.json(safeUser);
    } catch (error) {
      console.error("Login error:", error);
      res.status(500).json({ message: "Login failed" });
    }
  });

  app.post("/api/auth/logout", (req: Request, res: Response) => {
    req.session.destroy((err) => {
      if (err) {
        return res.status(500).json({ message: "Logout failed" });
      }
      res.json({ message: "Logged out" });
    });
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
