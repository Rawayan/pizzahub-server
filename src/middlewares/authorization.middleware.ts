
import { RequestHandler } from "express";
import { AppRole } from "../types/auth.types";

export const authorizeRoles = (
  ...allowedRoles: AppRole[]
): RequestHandler => {
  return (req, res, next) => {
    if (!req.authUser) {
      res.status(401).json({
        success: false,
        message: "Authentication required.",
      });
      return;
    }

    if (!allowedRoles.includes(req.authUser.role)) {
      res.status(403).json({
        success: false,
        message: "You do not have permission to access this resource.",
      });
      return;
    }

    next();
  };
};
