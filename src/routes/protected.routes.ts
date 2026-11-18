
import { Router, Request, Response } from "express";

import { authenticate } from "../middlewares/auth.middleware";
import { authorizeRoles } from "../middlewares/authorization.middleware";

const router = Router();

// Any authenticated and active user.
router.get(
  "/me",
  authenticate,
  (req: Request, res: Response) => {
    return res.status(200).json({
      success: true,
      message: "Authentication successful.",
      user: req.authUser,
    });
  }
);

// Customer-only endpoint.
router.get(
  "/customer",
  authenticate,
  authorizeRoles("customer"),
  (_req: Request, res: Response) => {
    return res.status(200).json({
      success: true,
      message: "Customer access granted.",
    });
  }
);

// Vendor-only endpoint.
router.get(
  "/vendor",
  authenticate,
  authorizeRoles("vendor"),
  (_req: Request, res: Response) => {
    return res.status(200).json({
      success: true,
      message: "Vendor access granted.",
    });
  }
);

// Admin-only endpoint.
router.get(
  "/admin",
  authenticate,
  authorizeRoles("admin"),
  (_req: Request, res: Response) => {
    return res.status(200).json({
      success: true,
      message: "Admin access granted.",
    });
  }
);

export default router;
