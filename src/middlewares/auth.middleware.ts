
import { RequestHandler } from "express";
import { Document } from "mongodb";
import {
  createRemoteJWKSet,
  jwtVerify,
} from "jose";

import { getDatabase } from "../config/database";
import { AppRole } from "../types/auth.types";

// Better Auth user documents use a string `id`.
// MongoDB's default `_id` type is ObjectId.
interface BetterAuthUserDocument extends Document {
  id: string;
  email?: string;
  name?: string;
  role?: unknown;
  isBlocked?: boolean;
}

const BETTER_AUTH_URL =
  process.env.BETTER_AUTH_URL || "http://localhost:3000";

const JWKS_URL = new URL(
  `${BETTER_AUTH_URL}/api/auth/jwks`
);

// jose caches the remote signing keys and refreshes when needed.
const JWKS = createRemoteJWKSet(JWKS_URL);

const isAppRole = (role: unknown): role is AppRole => {
  return (
    role === "customer" ||
    role === "vendor" ||
    role === "admin"
  );
};

export const authenticate: RequestHandler = async (
  req,
  res,
  next
) => {
  const authorization = req.headers.authorization;

  if (!authorization?.startsWith("Bearer ")) {
    res.status(401).json({
      success: false,
      message: "Authentication required. Bearer token missing.",
    });
    return;
  }

  const token = authorization.slice(7).trim();

  if (!token) {
    res.status(401).json({
      success: false,
      message: "Authentication token is empty.",
    });
    return;
  }

  let payload;

  try {
    const verified = await jwtVerify(token, JWKS, {
      issuer: BETTER_AUTH_URL,
      audience: BETTER_AUTH_URL,
    });

    payload = verified.payload;
  } catch (error) {
    console.warn("JWT verification failed:", error);

    res.status(401).json({
      success: false,
      message: "Invalid or expired authentication token.",
    });
    return;
  }

  const userId = payload.sub;

  if (typeof userId !== "string" || !userId) {
    res.status(401).json({
      success: false,
      message: "Invalid authentication token subject.",
    });
    return;
  }

  try {
    // Look up the Better Auth user by its string ID.
    // Do not compare a string JWT subject against MongoDB's ObjectId _id.
    const user = await getDatabase()
      .collection<BetterAuthUserDocument>("users")
      .findOne({ id: userId });

    if (!user) {
      res.status(401).json({
        success: false,
        message: "User account no longer exists.",
      });
      return;
    }

    // Check the current account status on every protected request.
    if (user.isBlocked === true) {
      res.status(403).json({
        success: false,
        message: "Your account has been blocked.",
      });
      return;
    }

    if (!isAppRole(user.role)) {
      res.status(403).json({
        success: false,
        message: "Your account has an invalid role.",
      });
      return;
    }

    req.authUser = {
      id: userId,
      email:
        typeof user.email === "string"
          ? user.email
          : typeof payload.email === "string"
            ? payload.email
            : "",
      name:
        typeof user.name === "string"
          ? user.name
          : undefined,
      role: user.role,
      isBlocked: false,
    };

    next();
  } catch (error) {
    // Database errors reach the central Express error handler.
    next(error);
  }
};
