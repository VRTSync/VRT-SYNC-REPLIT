import type { Request, Response, RequestHandler } from "express";
import { ForbiddenError, UnauthenticatedError } from "../policy";
import { WorkAccessError, WorkValidationError } from "../storage";

export function route(fn: (req: Request, res: Response) => Promise<unknown>): RequestHandler {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (error) {
      if (error instanceof UnauthenticatedError) return void res.status(401).json({ message: error.message });
      if (error instanceof ForbiddenError || error instanceof WorkAccessError) return void res.status(403).json({ error: error.message });
      if (error instanceof WorkValidationError) return void res.status(400).json({ error: error.message });
      // Each moved handler retains its historical route-specific 500 body.
      req.log?.error({ err: error }, "Unhandled task route error");
      res.status(500).json({ error: "Internal error" });
    }
  };
}
