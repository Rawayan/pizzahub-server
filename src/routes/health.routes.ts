
import { Router } from "express";

const router = Router();

router.get("/", (_req, res) => {
  res.status(200).json({
    success: true,
    message: "PizzaHub API is healthy",
    service: "PizzaHub Server",
    timestamp: new Date().toISOString(),
  });
});

export default router;
