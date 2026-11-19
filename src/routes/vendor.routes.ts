

import {
  Router,
  Request,
  Response,
  NextFunction,
  RequestHandler,
} from "express";

import { Document, ObjectId } from "mongodb";
import multer from "multer";

import { getDatabase } from "../config/database";
import { getMenuItemsCollection } from "../config/collections";
import { authenticate } from "../middlewares/auth.middleware";
import { authorizeRoles } from "../middlewares/authorization.middleware";
import { MenuItemDocument } from "../types/database.types";

const router = Router();

// ============================================
// Types
// ============================================

interface VendorAccount extends Document {
  _id: ObjectId;
  name?: string;
  email?: string;
  role?: string;
  businessName?: string;
  subscriptionPlan?: "free" | "premium";
  subscriptionExpiresAt?: Date | null;
}

interface ImgBBResponse {
  success: boolean;
  data?: {
    url?: string;
    display_url?: string;
  };
  error?: {
    message?: string;
  };
}

interface MenuPayload {
  itemName: string;
  category: string;
  description: string;
  price: number;
  location: string;
  images: string[];
}

// ============================================
// Constants
// ============================================

const MAX_FREE_ACTIVE_ITEMS = 3;
const MAX_IMAGE_SIZE = 5 * 1024 * 1024;

// ============================================
// Image Upload Configuration
// ============================================

const imageUpload = multer({
  storage: multer.memoryStorage(),

  limits: {
    fileSize: MAX_IMAGE_SIZE,
  },

  fileFilter: (_req, file, callback) => {
    const allowedTypes = [
      "image/jpeg",
      "image/png",
      "image/webp",
    ];

    if (!allowedTypes.includes(file.mimetype)) {
      callback(null, false);
      return;
    }

    callback(null, true);
  },
});

const handleImageUpload: RequestHandler = (req, res, next) => {
  imageUpload.single("image")(
    req,
    res,
    (error: any) => {
      if (error instanceof multer.MulterError) {
        res.status(
          error.code === "LIMIT_FILE_SIZE" ? 413 : 400
        ).json({
          success: false,
          message:
            error.code === "LIMIT_FILE_SIZE"
              ? "Image must be 5 MB or smaller."
              : error.message,
        });

        return;
      }

      if (error) {
        next(error);
        return;
      }

      next();
    }
  );
};

// ============================================
// Vendor Account Helper
// ============================================

const getVendorAccount = async (
  userId: string
): Promise<VendorAccount | null> => {
  // Better Auth user IDs are represented as strings in JWTs.
  // MongoDB stores the corresponding user identifier as ObjectId.
  if (!/^[0-9a-fA-F]{24}$/.test(userId)) {
    return null;
  }

  return getDatabase()
    .collection<VendorAccount>("users")
    .findOne({
      _id: new ObjectId(userId),
      role: "vendor",
    });
};

// ============================================
// Validation Helpers
// ============================================

const isValidObjectId = (id: unknown): id is string => {
  return (
    typeof id === "string" &&
    /^[0-9a-fA-F]{24}$/.test(id)
  );
};

const parseMenuPayload = (
  body: Record<string, unknown>
): MenuPayload | null => {
  const itemName =
    typeof body.itemName === "string"
      ? body.itemName.trim()
      : "";

  const category =
    typeof body.category === "string"
      ? body.category.trim()
      : "";

  const description =
    typeof body.description === "string"
      ? body.description.trim()
      : "";

  const location =
    typeof body.location === "string"
      ? body.location.trim()
      : "";

  const price =
    typeof body.price === "number"
      ? body.price
      : typeof body.price === "string"
        ? Number(body.price)
        : NaN;

  const images = Array.isArray(body.images)
    ? body.images.filter(
        (image): image is string =>
          typeof image === "string" &&
          image.startsWith("https://")
      )
    : [];

  if (
    !itemName ||
    !category ||
    !description ||
    !location ||
    !Number.isFinite(price) ||
    price <= 0 ||
    itemName.length > 100 ||
    category.length > 50 ||
    description.length > 1500 ||
    location.length > 120 ||
    images.length === 0 ||
    images.length > 5
  ) {
    return null;
  }

  return {
    itemName,
    category,
    description,
    price,
    location,
    images,
  };
};

const sendNotFound = (res: Response): void => {
  res.status(404).json({
    success: false,
    message: "Menu item not found.",
  });
};

// ============================================
// Authentication and Authorization
// ============================================

// Every endpoint in this router requires an authenticated vendor.
router.use(authenticate, authorizeRoles("vendor"));

// ============================================
// GET /api/vendor/dashboard
// ============================================

router.get(
  "/dashboard",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const vendor = await getVendorAccount(req.authUser!.id);

      if (!vendor) {
        res.status(404).json({
          success: false,
          message: "Vendor account not found.",
        });
        return;
      }

      const menuItems = getMenuItemsCollection();
      const orders = getDatabase().collection("orders");

      const now = new Date();

      const premiumActive =
        vendor.subscriptionPlan === "premium" &&
        (!vendor.subscriptionExpiresAt ||
          new Date(vendor.subscriptionExpiresAt) > now);

      const currentPlan = premiumActive ? "premium" : "free";

      const [
        totalMenuItems,
        activeMenuItems,
        pendingMenuItems,
        pendingOrders,
        acceptedOrders,
      ] = await Promise.all([
        menuItems.countDocuments({
          vendorId: vendor._id,
        }),

        menuItems.countDocuments({
          vendorId: vendor._id,
          status: "approved",
        }),

        menuItems.countDocuments({
          vendorId: vendor._id,
          status: "pending",
        }),

        orders.countDocuments({
          vendorId: vendor._id,
          status: "pending",
        }),

        orders.countDocuments({
          vendorId: vendor._id,
          status: "accepted",
        }),
      ]);

      res.status(200).json({
        success: true,
        message: "Vendor dashboard loaded successfully.",
        data: {
          vendor: {
            name: vendor.name || "Vendor",
            businessName: vendor.businessName || "My Restaurant",
          },

          statistics: {
            totalMenuItems,
            activeMenuItems,
            pendingMenuItems,
            pendingOrders,
            acceptedOrders,
          },

          subscription: {
            plan: currentPlan,

            activeItemLimit:
              currentPlan === "premium"
                ? null
                : MAX_FREE_ACTIVE_ITEMS,

            remainingActiveSlots:
              currentPlan === "premium"
                ? null
                : Math.max(
                    0,
                    MAX_FREE_ACTIVE_ITEMS - activeMenuItems
                  ),

            expiresAt: vendor.subscriptionExpiresAt || null,
          },
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

// ============================================
// GET /api/vendor/menu-items
// Get the authenticated vendor's menu items
// ============================================

router.get(
  "/menu-items",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const vendor = await getVendorAccount(req.authUser!.id);

      if (!vendor) {
        res.status(404).json({
          success: false,
          message: "Vendor account not found.",
        });
        return;
      }

      const items = await getMenuItemsCollection()
        .find({
          vendorId: vendor._id,
        })
        .sort({
          createdAt: -1,
        })
        .toArray();

      res.status(200).json({
        success: true,
        message: "Your menu items were retrieved successfully.",
        data: {
          items: items.map((item) => ({
            id: item._id?.toString(),
            itemName: item.itemName,
            category: item.category,
            description: item.description,
            price: item.price,
            location: item.location,
            images: item.images || [],
            status: item.status,
            createdAt: item.createdAt,
          })),

          total: items.length,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

// ============================================
// POST /api/vendor/menu-images
// Upload an image to ImgBB
// ============================================

router.post(
  "/menu-images",
  handleImageUpload,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const apiKey = process.env.IMGBB_API_KEY;

      if (!apiKey) {
        res.status(500).json({
          success: false,
          message: "Image upload service is not configured.",
        });
        return;
      }

      if (!req.file) {
        res.status(400).json({
          success: false,
          message:
            "Please select a valid JPG, PNG, or WEBP image (maximum 5 MB).",
        });
        return;
      }

      const formData = new FormData();

      formData.append(
        "image",
        req.file.buffer.toString("base64")
      );

      formData.append(
        "name",
        req.file.originalname.replace(/\.[^/.]+$/, "").slice(0, 100)
      );

      const response = await fetch(
        `https://api.imgbb.com/1/upload?key=${encodeURIComponent(apiKey)}`,
        {
          method: "POST",
          body: formData,
        }
      );

      const result =
        (await response.json()) as ImgBBResponse;

      if (!response.ok || !result.success || !result.data?.url) {
        res.status(502).json({
          success: false,
          message:
            result.error?.message ||
            "Image upload failed. Please try again.",
        });
        return;
      }

      res.status(200).json({
        success: true,
        message: "Image uploaded successfully.",
        data: {
          url: result.data.url,
          displayUrl:
            result.data.display_url || result.data.url,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

// ============================================
// POST /api/vendor/menu-items
// Create a menu item
// New items always start as pending
// ============================================

router.post(
  "/menu-items",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const vendor = await getVendorAccount(req.authUser!.id);

      if (!vendor) {
        res.status(404).json({
          success: false,
          message: "Vendor account not found.",
        });
        return;
      }

      const payload = parseMenuPayload(
        req.body as Record<string, unknown>
      );

      if (!payload) {
        res.status(400).json({
          success: false,
          message:
            "Please provide a valid name, category, description, price, location, and at least one uploaded image.",
        });
        return;
      }

      const item: MenuItemDocument = {
        vendorId: vendor._id,
        ...payload,
        status: "pending",
        createdAt: new Date(),
      };

      const result =
        await getMenuItemsCollection().insertOne(item);

      res.status(201).json({
        success: true,
        message:
          "Menu item submitted successfully. It is waiting for admin approval.",
        data: {
          item: {
            id: result.insertedId.toString(),
            ...payload,
            status: "pending",
            createdAt: item.createdAt,
          },
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

// ============================================
// GET /api/vendor/menu-items/:id
// Get one of the authenticated vendor's items
// ============================================

router.get(
  "/menu-items/:id",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id;

      if (!isValidObjectId(id)) {
        res.status(400).json({
          success: false,
          message: "Invalid menu item ID.",
        });
        return;
      }

      const vendor = await getVendorAccount(req.authUser!.id);

      if (!vendor) {
        res.status(404).json({
          success: false,
          message: "Vendor account not found.",
        });
        return;
      }

      const item = await getMenuItemsCollection().findOne({
        _id: new ObjectId(id),
        vendorId: vendor._id,
      });

      if (!item) {
        sendNotFound(res);
        return;
      }

      res.status(200).json({
        success: true,
        message: "Menu item retrieved successfully.",
        data: {
          item: {
            id: item._id?.toString(),
            itemName: item.itemName,
            category: item.category,
            description: item.description,
            price: item.price,
            location: item.location,
            images: item.images || [],
            status: item.status,
          },
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

// ============================================
// PATCH /api/vendor/menu-items/:id
// Update an owned menu item
// Every edit resets approval status to pending
// ============================================

router.patch(
  "/menu-items/:id",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id;

      if (!isValidObjectId(id)) {
        res.status(400).json({
          success: false,
          message: "Invalid menu item ID.",
        });
        return;
      }

      const vendor = await getVendorAccount(req.authUser!.id);

      if (!vendor) {
        res.status(404).json({
          success: false,
          message: "Vendor account not found.",
        });
        return;
      }

      const collection = getMenuItemsCollection();

      const existingItem = await collection.findOne({
        _id: new ObjectId(id),
        vendorId: vendor._id,
      });

      if (!existingItem) {
        sendNotFound(res);
        return;
      }

      const payload = parseMenuPayload(
        req.body as Record<string, unknown>
      );

      if (!payload) {
        res.status(400).json({
          success: false,
          message:
            "Please provide valid menu item details and at least one image.",
        });
        return;
      }

      await collection.updateOne(
        {
          _id: existingItem._id,
          vendorId: vendor._id,
        },
        {
          $set: {
            ...payload,
            status: "pending",
          },
        }
      );

      res.status(200).json({
        success: true,
        message:
          "Menu item updated successfully. It is now waiting for admin approval.",
        data: {
          item: {
            id,
            ...payload,
            status: "pending",
          },
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

// ============================================
// PATCH /api/vendor/menu-items/:id/availability
// Activate or deactivate an approved item
// ============================================

router.patch(
  "/menu-items/:id/availability",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id;

      if (!isValidObjectId(id)) {
        res.status(400).json({
          success: false,
          message: "Invalid menu item ID.",
        });
        return;
      }

      const { isActive } = req.body as {
        isActive?: unknown;
      };

      if (typeof isActive !== "boolean") {
        res.status(400).json({
          success: false,
          message: "isActive must be true or false.",
        });
        return;
      }

      const vendor = await getVendorAccount(req.authUser!.id);

      if (!vendor) {
        res.status(404).json({
          success: false,
          message: "Vendor account not found.",
        });
        return;
      }

      const collection = getMenuItemsCollection();

      const item = await collection.findOne({
        _id: new ObjectId(id),
        vendorId: vendor._id,
      });

      if (!item) {
        sendNotFound(res);
        return;
      }

      if (
        item.status !== "approved" &&
        item.status !== "inactive"
      ) {
        res.status(409).json({
          success: false,
          message:
            "Only approved or inactive items can have their availability changed.",
        });
        return;
      }

      const now = new Date();

      const premiumActive =
        vendor.subscriptionPlan === "premium" &&
        (!vendor.subscriptionExpiresAt ||
          new Date(vendor.subscriptionExpiresAt) > now);

      // Enforce the Free plan limit when activating an inactive item.
      if (
        isActive &&
        item.status !== "approved" &&
        !premiumActive
      ) {
        const activeCount = await collection.countDocuments({
          vendorId: vendor._id,
          status: "approved",
        });

        if (activeCount >= MAX_FREE_ACTIVE_ITEMS) {
          res.status(403).json({
            success: false,
            message:
              "Your Free plan allows only 3 active menu items. Upgrade to Premium to activate more items.",
            data: {
              activeItemLimit: MAX_FREE_ACTIVE_ITEMS,
              activeMenuItems: activeCount,
            },
          });
          return;
        }
      }

      const newStatus = isActive ? "approved" : "inactive";

      await collection.updateOne(
        {
          _id: item._id,
          vendorId: vendor._id,
        },
        {
          $set: {
            status: newStatus,
          },
        }
      );

      res.status(200).json({
        success: true,
        message: isActive
          ? "Menu item activated successfully."
          : "Menu item deactivated successfully.",
        data: {
          id,
          status: newStatus,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

// ============================================
// DELETE /api/vendor/menu-items/:id
// Delete only an item owned by the vendor
// ============================================

router.delete(
  "/menu-items/:id",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id;

      if (!isValidObjectId(id)) {
        res.status(400).json({
          success: false,
          message: "Invalid menu item ID.",
        });
        return;
      }

      const vendor = await getVendorAccount(req.authUser!.id);

      if (!vendor) {
        res.status(404).json({
          success: false,
          message: "Vendor account not found.",
        });
        return;
      }

      const result = await getMenuItemsCollection().deleteOne({
        _id: new ObjectId(id),
        vendorId: vendor._id,
      });

      if (result.deletedCount === 0) {
        sendNotFound(res);
        return;
      }

      res.status(200).json({
        success: true,
        message: "Menu item deleted successfully.",
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
