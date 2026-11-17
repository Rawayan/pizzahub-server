
import { Router, Request, Response } from "express";
import { getDatabase } from "../config/database";

const router = Router();

router.get("/health", async (_req: Request, res: Response) => {
  try {
    await getDatabase().command({ ping: 1 });

    return res.status(200).json({
      success: true,
      message: "MongoDB connection is healthy",
      database: process.env.DB_NAME || "pizzahub",
    });
  } catch (error) {
    console.error("Database health check failed:", error);

    return res.status(503).json({
      success: false,
      message: "Database connection is unavailable",
    });
  }
});

export default router;
