
import { Router, Request, Response, NextFunction } from "express";
import { Document, ObjectId } from "mongodb";
import { authenticate } from "../middlewares/auth.middleware";
import { getDatabase } from "../config/database";

const router = Router();

interface ProfileUpdateBody {
  name?: string;
  image?: string;
  businessName?: string;
}

interface UserProfile extends Document {
  _id: ObjectId;
  name?: string;
  email?: string;
  image?: string;
  role?: string;
  isBlocked?: boolean;
  businessName?: string;
  subscriptionPlan?: string;
  subscriptionExpiresAt?: Date | null;
}

const getUsersCollection = () =>
  getDatabase().collection<UserProfile>("users");

const isValidImageUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
};

const getSafeProfile = (user: UserProfile) => ({
  id: user._id.toString(),
  name: user.name ?? "",
  email: user.email ?? "",
  image: user.image ?? "",
  role: user.role ?? "",
  businessName: user.businessName ?? "",
  subscriptionPlan: user.subscriptionPlan ?? "free",
  subscriptionExpiresAt: user.subscriptionExpiresAt ?? null,
});

router.use(authenticate);

/**
 * GET /api/users/me
 * Return the authenticated user's profile.
 */
router.get(
  "/me",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.authUser?.id;

      if (!userId || !ObjectId.isValid(userId)) {
        res.status(401).json({
          success: false,
          message: "Invalid authenticated user.",
        });
        return;
      }

      const user = await getUsersCollection().findOne({
        _id: new ObjectId(userId),
      });

      if (!user) {
        res.status(404).json({
          success: false,
          message: "User profile not found.",
        });
        return;
      }

      res.status(200).json({
        success: true,
        message: "Profile retrieved successfully.",
        data: getSafeProfile(user),
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * PATCH /api/users/me
 * Update only fields the authenticated user is allowed to edit.
 */
router.patch(
  "/me",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.authUser?.id;

      if (!userId || !ObjectId.isValid(userId)) {
        res.status(401).json({
          success: false,
          message: "Invalid authenticated user.",
        });
        return;
      }

      if (
        !req.body ||
        typeof req.body !== "object" ||
        Array.isArray(req.body)
      ) {
        res.status(400).json({
          success: false,
          message: "Invalid profile data.",
        });
        return;
      }

      const body = req.body as Record<string, unknown>;

      const protectedFields = [
        "role",
        "isBlocked",
        "subscriptionPlan",
        "subscriptionExpiresAt",
        "_id",
        "id",
        "email",
      ];

      const attemptedProtectedField = protectedFields.find(
        (field) => Object.prototype.hasOwnProperty.call(body, field)
      );

      if (attemptedProtectedField) {
        res.status(403).json({
          success: false,
          message: `You cannot update ${attemptedProtectedField}.`,
        });
        return;
      }

      const allowedFields = ["name", "image", "businessName"];
      const unknownFields = Object.keys(body).filter(
        (field) => !allowedFields.includes(field)
      );

      if (unknownFields.length > 0) {
        res.status(400).json({
          success: false,
          message: `Unsupported profile field: ${unknownFields[0]}.`,
        });
        return;
      }

      const user = await getUsersCollection().findOne({
        _id: new ObjectId(userId),
      });

      if (!user) {
        res.status(404).json({
          success: false,
          message: "User profile not found.",
        });
        return;
      }

      if (
        Object.prototype.hasOwnProperty.call(body, "businessName") &&
        user.role !== "vendor"
      ) {
        res.status(403).json({
          success: false,
          message: "Only vendors can update a business name.",
        });
        return;
      }

      const updates: Record<string, string> = {};
      const unset: Record<string, ""> = {};

      if (Object.prototype.hasOwnProperty.call(body, "name")) {
        if (typeof body.name !== "string") {
          res.status(400).json({
            success: false,
            message: "Name must be a string.",
          });
          return;
        }

        const name = body.name.trim();

        if (name.length < 2 || name.length > 60) {
          res.status(400).json({
            success: false,
            message: "Name must contain between 2 and 60 characters.",
          });
          return;
        }

        updates.name = name;
      }

      if (Object.prototype.hasOwnProperty.call(body, "image")) {
        if (typeof body.image !== "string") {
          res.status(400).json({
            success: false,
            message: "Profile image must be a URL string.",
          });
          return;
        }

        const image = body.image.trim();

        if (image.length === 0) {
          unset.image = "";
        } else {
          if (image.length > 2048 || !isValidImageUrl(image)) {
            res.status(400).json({
              success: false,
              message: "Please provide a valid HTTP or HTTPS image URL.",
            });
            return;
          }

          updates.image = image;
        }
      }

      if (Object.prototype.hasOwnProperty.call(body, "businessName")) {
        if (typeof body.businessName !== "string") {
          res.status(400).json({
            success: false,
            message: "Business name must be a string.",
          });
          return;
        }

        const businessName = body.businessName.trim();

        if (businessName.length < 2 || businessName.length > 100) {
          res.status(400).json({
            success: false,
            message: "Business name must contain between 2 and 100 characters.",
          });
          return;
        }

        updates.businessName = businessName;
      }

      if (
        Object.keys(updates).length === 0 &&
        Object.keys(unset).length === 0
      ) {
        res.status(400).json({
          success: false,
          message: "No valid profile changes were provided.",
        });
        return;
      }

      const updateOperation: {
        $set?: Record<string, string>;
        $unset?: Record<string, "">;
      } = {};

      if (Object.keys(updates).length > 0) {
        updateOperation.$set = updates;
      }

      if (Object.keys(unset).length > 0) {
        updateOperation.$unset = unset;
      }

      await getUsersCollection().updateOne(
        { _id: new ObjectId(userId) },
        updateOperation
      );

      const updatedUser = await getUsersCollection().findOne({
        _id: new ObjectId(userId),
      });

      if (!updatedUser) {
        res.status(404).json({
          success: false,
          message: "Updated profile could not be found.",
        });
        return;
      }

      res.status(200).json({
        success: true,
        message: "Your profile has been updated successfully.",
        data: getSafeProfile(updatedUser),
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
