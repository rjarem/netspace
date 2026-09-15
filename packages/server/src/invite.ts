// Invite endpoint — issues signed JWTs for room auth
import express, { Router, Request, Response } from "express";
import { signInviteToken } from "./jwt.js";

export function inviteRouter(): Router {
  const r = Router();
  r.use(express.json());

  r.post("/api/invite", async (req: Request, res: Response) => {
    const adminToken = req.headers["x-admin-token"];
    if (adminToken !== (process.env.ADMIN_TOKEN || "dev-admin")) {
      return res.status(401).json({ error: "unauthorized" });
    }
    const { handle, role, hours } = req.body || {};
    if (!handle) return res.status(400).json({ error: "handle required" });
    const validRoles = ["admin", "moderator", "speaker", "attendee", "panelist", "dj"];
    const r2 = validRoles.includes(role) ? role : "attendee";
    const exp = Math.floor(Date.now() / 1000) + (Number(hours) || 24) * 3600;
    const secret = process.env.JWT_SECRET || "dev-secret-change-me";
    const token = await signInviteToken(secret, { handle, role: r2, exp });
    res.json({ token, role: r2, exp });
  });

  return r;
}