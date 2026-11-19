
import { Router, Request, Response, NextFunction } from "express";
import { Filter, ObjectId } from "mongodb";

import { getDatabase } from "../config/database";
import {
  getMenuItemsCollection,
  getTransactionsCollection,
} from "../config/collections";

import { authenticate } from "../middlewares/auth.middleware";
import { authorizeRoles } from "../middlewares/authorization.middleware";

import {
  MenuItemDocument,
  TransactionDocument,
  UserDocument,
} from "../types/database.types";

const router = Router();

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

const USER_ROLES = ["customer", "vendor"] as const;

const MENU_STATUSES = [
  "pending",
  "approved",
  "rejected",
  "inactive",
] as const;

const TRANSACTION_STATUSES = [
  "pending",
  "completed",
  "failed",
  "cancelled",
] as const;

type ManagedUserRole = (typeof USER_ROLES)[number];
type MenuStatus = (typeof MENU_STATUSES)[number];
type TransactionStatus = (typeof TRANSACTION_STATUSES)[number];

interface AdminUserSummary {
  id: string;
  name: string;
  email: string;
  image?: string;
  role: string;
  isBlocked: boolean;
  businessName?: string;
  subscriptionPlan?: string;
  subscriptionExpiresAt?: Date | null;
}

const escapeRegex = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const isValidObjectId = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[0-9a-fA-F]{24}$/.test(value);

const getRouteId = (req: Request): string | null => {
  const value = req.params.id;

  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value) && typeof value[0] === "string") {
    return value[0];
  }

  return null;
};

const getPagination = (req: Request) => {
  const requestedPage = Number(req.query.page);
  const requestedLimit = Number(req.query.limit);

  const page =
    Number.isInteger(requestedPage) && requestedPage > 0
      ? requestedPage
      : 1;

  const limit =
    Number.isInteger(requestedLimit) && requestedLimit > 0
      ? Math.min(requestedLimit, MAX_LIMIT)
      : DEFAULT_LIMIT;

  return {
    page,
    limit,
    skip: (page - 1) * limit,
  };
};

const serializeUser = (user: UserDocument): AdminUserSummary => ({
  id: user._id.toString(),
  name: user.name,
  email: user.email,
  image: user.image,
  role: user.role,
  isBlocked: user.isBlocked,
  businessName: user.businessName,
  subscriptionPlan: user.subscriptionPlan,
  subscriptionExpiresAt: user.subscriptionExpiresAt,
});

/**
 * Every route in this router requires an authenticated admin.
 * Role and blocked status are verified by the backend middleware.
 */
router.use(authenticate, authorizeRoles("admin"));

/**
 * GET /api/admin/dashboard
 *
 * Admin dashboard statistics.
 */
router.get(
  "/dashboard",
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const users = getDatabase().collection<UserDocument>("users");
      const menuItems = getMenuItemsCollection();
      const transactions = getTransactionsCollection();

      const [
        totalUsers,
        totalVendors,
        totalCustomers,
        totalMenuItems,
        pendingMenuItems,
        approvedMenuItems,
        rejectedMenuItems,
        inactiveMenuItems,
        totalTransactions,
        completedTransactions,
        pendingTransactions,
        failedTransactions,
        recentTransactions,
      ] = await Promise.all([
        users.countDocuments(),

        users.countDocuments({ role: "vendor" }),

        users.countDocuments({ role: "customer" }),

        menuItems.countDocuments(),

        menuItems.countDocuments({ status: "pending" }),

        menuItems.countDocuments({ status: "approved" }),

        menuItems.countDocuments({ status: "rejected" }),

        menuItems.countDocuments({ status: "inactive" }),

        transactions.countDocuments(),

        transactions.countDocuments({ status: "completed" }),

        transactions.countDocuments({ status: "pending" }),

        transactions.countDocuments({ status: "failed" }),

        transactions
          .find()
          .sort({ createdAt: -1 })
          .limit(5)
          .toArray(),
      ]);

      const recentPayments = await Promise.all(
        recentTransactions.map(async (transaction) => {
          const vendor = await users.findOne({
            _id: transaction.vendorId,
          });

          return {
            id: transaction._id?.toString() ?? "",
            vendor: vendor
              ? {
                  id: vendor._id.toString(),
                  name: vendor.name,
                  email: vendor.email,
                  businessName: vendor.businessName,
                }
              : null,
            plan: transaction.plan,
            amount: transaction.amount,
            currency: transaction.currency,
            status: transaction.status,
            createdAt: transaction.createdAt,
          };
        })
      );

      res.status(200).json({
        success: true,
        message: "Admin dashboard loaded successfully.",
        data: {
          statistics: {
            totalUsers,
            totalVendors,
            totalCustomers,
            totalMenuItems,
            pendingMenuItems,
            approvedMenuItems,
            rejectedMenuItems,
            inactiveMenuItems,
            totalTransactions,
            completedTransactions,
            pendingTransactions,
            failedTransactions,
          },
          recentTransactions: recentPayments,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/admin/users
 *
 * Search and filter customers and vendors.
 *
 * Query parameters:
 * search, role, blocked, page, limit
 */
router.get(
  "/users",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const usersCollection =
        getDatabase().collection<UserDocument>("users");

      const search =
        typeof req.query.search === "string"
          ? req.query.search.trim()
          : "";

      const role =
        typeof req.query.role === "string"
          ? req.query.role
          : "all";

      const blocked =
        typeof req.query.blocked === "string"
          ? req.query.blocked
          : "all";

      if (
        role !== "all" &&
        !USER_ROLES.includes(role as ManagedUserRole)
      ) {
        res.status(400).json({
          success: false,
          message: "Invalid user role filter.",
        });
        return;
      }

      if (!["all", "true", "false"].includes(blocked)) {
        res.status(400).json({
          success: false,
          message: "Invalid blocked status filter.",
        });
        return;
      }

      const { page, limit, skip } = getPagination(req);

      const filter: Filter<UserDocument> = {
        role:
          role === "all"
            ? { $in: ["customer", "vendor"] }
            : (role as ManagedUserRole),
      };

      if (blocked !== "all") {
        filter.isBlocked = blocked === "true";
      }

      if (search) {
        const expression = new RegExp(escapeRegex(search), "i");

        filter.$or = [
          { name: expression },
          { email: expression },
          { businessName: expression },
        ];
      }

      const [users, total] = await Promise.all([
        usersCollection
          .find(filter)
          .project<UserDocument>({
            name: 1,
            email: 1,
            image: 1,
            role: 1,
            isBlocked: 1,
            businessName: 1,
            subscriptionPlan: 1,
            subscriptionExpiresAt: 1,
          })
          .sort({ name: 1 })
          .skip(skip)
          .limit(limit)
          .toArray(),

        usersCollection.countDocuments(filter),
      ]);

      res.status(200).json({
        success: true,
        message: "Users retrieved successfully.",
        data: {
          users: users.map(serializeUser),
          pagination: {
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit),
          },
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/admin/users/:id
 *
 * View one customer or vendor.
 */
router.get(
  "/users/:id",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = getRouteId(req);

      if (!isValidObjectId(id)) {
        res.status(400).json({
          success: false,
          message: "Invalid user ID.",
        });
        return;
      }

      const user = await getDatabase()
        .collection<UserDocument>("users")
        .findOne({
          _id: new ObjectId(id),
          role: { $in: ["customer", "vendor"] },
        });

      if (!user) {
        res.status(404).json({
          success: false,
          message: "User not found.",
        });
        return;
      }

      res.status(200).json({
        success: true,
        message: "User details retrieved successfully.",
        data: {
          user: serializeUser(user),
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * PATCH /api/admin/users/:id/block
 *
 * Block a customer or vendor.
 */
router.patch(
  "/users/:id/block",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = getRouteId(req);

      if (!isValidObjectId(id)) {
        res.status(400).json({
          success: false,
          message: "Invalid user ID.",
        });
        return;
      }

      const usersCollection =
        getDatabase().collection<UserDocument>("users");

      const result = await usersCollection.updateOne(
        {
          _id: new ObjectId(id),
          role: { $in: ["customer", "vendor"] },
        },
        {
          $set: { isBlocked: true },
        }
      );

      if (result.matchedCount === 0) {
        res.status(404).json({
          success: false,
          message: "Customer or vendor account not found.",
        });
        return;
      }

      res.status(200).json({
        success: true,
        message: "User blocked successfully.",
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * PATCH /api/admin/users/:id/unblock
 *
 * Unblock a customer or vendor.
 */
router.patch(
  "/users/:id/unblock",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = getRouteId(req);

      if (!isValidObjectId(id)) {
        res.status(400).json({
          success: false,
          message: "Invalid user ID.",
        });
        return;
      }

      const usersCollection =
        getDatabase().collection<UserDocument>("users");

      const result = await usersCollection.updateOne(
        {
          _id: new ObjectId(id),
          role: { $in: ["customer", "vendor"] },
        },
        {
          $set: { isBlocked: false },
        }
      );

      if (result.matchedCount === 0) {
        res.status(404).json({
          success: false,
          message: "Customer or vendor account not found.",
        });
        return;
      }

      res.status(200).json({
        success: true,
        message: "User unblocked successfully.",
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/admin/menu-items
 *
 * View, search, and filter all submitted menu items.
 *
 * Query parameters:
 * search, status, page, limit
 */
router.get(
  "/menu-items",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const search =
        typeof req.query.search === "string"
          ? req.query.search.trim()
          : "";

      const status =
        typeof req.query.status === "string"
          ? req.query.status
          : "all";

      if (
        status !== "all" &&
        !MENU_STATUSES.includes(status as MenuStatus)
      ) {
        res.status(400).json({
          success: false,
          message: "Invalid menu item status filter.",
        });
        return;
      }

      const { page, limit, skip } = getPagination(req);

      const filter: Filter<MenuItemDocument> = {};

      if (status !== "all") {
        filter.status = status as MenuStatus;
      }

      if (search) {
        const expression = new RegExp(escapeRegex(search), "i");

        filter.$or = [
          { itemName: expression },
          { category: expression },
          { location: expression },
        ];
      }

      const collection = getMenuItemsCollection();

      const [items, total] = await Promise.all([
        collection
          .find(filter)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .toArray(),

        collection.countDocuments(filter),
      ]);

      const usersCollection =
        getDatabase().collection<UserDocument>("users");

      const menuItems = await Promise.all(
        items.map(async (item) => {
          const vendor = await usersCollection.findOne({
            _id: item.vendorId,
          });

          return {
            id: item._id?.toString() ?? "",
            itemName: item.itemName,
            category: item.category,
            description: item.description,
            price: item.price,
            location: item.location,
            images: item.images ?? [],
            status: item.status,
            createdAt: item.createdAt,
            vendor: vendor
              ? {
                  id: vendor._id.toString(),
                  name: vendor.name,
                  email: vendor.email,
                  businessName: vendor.businessName,
                }
              : null,
          };
        })
      );

      res.status(200).json({
        success: true,
        message: "Menu items retrieved successfully.",
        data: {
          items: menuItems,
          pagination: {
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit),
          },
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * PATCH /api/admin/menu-items/:id/approve
 *
 * Approve a submitted menu item.
 */
router.patch(
  "/menu-items/:id/approve",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = getRouteId(req);

      if (!isValidObjectId(id)) {
        res.status(400).json({
          success: false,
          message: "Invalid menu item ID.",
        });
        return;
      }

      const result = await getMenuItemsCollection().updateOne(
        { _id: new ObjectId(id) },
        { $set: { status: "approved" } }
      );

      if (result.matchedCount === 0) {
        res.status(404).json({
          success: false,
          message: "Menu item not found.",
        });
        return;
      }

      res.status(200).json({
        success: true,
        message: "Menu item approved successfully.",
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * PATCH /api/admin/menu-items/:id/reject
 *
 * Reject a submitted menu item.
 */
router.patch(
  "/menu-items/:id/reject",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = getRouteId(req);

      if (!isValidObjectId(id)) {
        res.status(400).json({
          success: false,
          message: "Invalid menu item ID.",
        });
        return;
      }

      const result = await getMenuItemsCollection().updateOne(
        { _id: new ObjectId(id) },
        { $set: { status: "rejected" } }
      );

      if (result.matchedCount === 0) {
        res.status(404).json({
          success: false,
          message: "Menu item not found.",
        });
        return;
      }

      res.status(200).json({
        success: true,
        message: "Menu item rejected successfully.",
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * PATCH /api/admin/menu-items/:id/status
 *
 * Change a published item's visibility.
 * Allowed values: approved, inactive.
 */
router.patch(
  "/menu-items/:id/status",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = getRouteId(req);
      const status = req.body?.status;

      if (!isValidObjectId(id)) {
        res.status(400).json({
          success: false,
          message: "Invalid menu item ID.",
        });
        return;
      }

      if (status !== "approved" && status !== "inactive") {
        res.status(400).json({
          success: false,
          message: "Status must be approved or inactive.",
        });
        return;
      }

      const result = await getMenuItemsCollection().updateOne(
        { _id: new ObjectId(id) },
        { $set: { status } }
      );

      if (result.matchedCount === 0) {
        res.status(404).json({
          success: false,
          message: "Menu item not found.",
        });
        return;
      }

      res.status(200).json({
        success: true,
        message: `Menu item status changed to ${status}.`,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * DELETE /api/admin/menu-items/:id
 *
 * Delete an inappropriate menu item.
 */
router.delete(
  "/menu-items/:id",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = getRouteId(req);

      if (!isValidObjectId(id)) {
        res.status(400).json({
          success: false,
          message: "Invalid menu item ID.",
        });
        return;
      }

      const result = await getMenuItemsCollection().deleteOne({
        _id: new ObjectId(id),
      });

      if (result.deletedCount === 0) {
        res.status(404).json({
          success: false,
          message: "Menu item not found.",
        });
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

/**
 * GET /api/admin/transactions
 *
 * Read-only transaction monitoring.
 *
 * Query parameters:
 * status, page, limit
 *
 * There are intentionally no transaction update or delete endpoints.
 */
router.get(
  "/transactions",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const status =
        typeof req.query.status === "string"
          ? req.query.status
          : "all";

      if (
        status !== "all" &&
        !TRANSACTION_STATUSES.includes(
          status as TransactionStatus
        )
      ) {
        res.status(400).json({
          success: false,
          message: "Invalid transaction status filter.",
        });
        return;
      }

      const { page, limit, skip } = getPagination(req);

      const filter: Filter<TransactionDocument> =
        status === "all"
          ? {}
          : { status: status as TransactionStatus };

      const collection = getTransactionsCollection();

      const [transactions, total] = await Promise.all([
        collection
          .find(filter)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .toArray(),

        collection.countDocuments(filter),
      ]);

      const usersCollection =
        getDatabase().collection<UserDocument>("users");

      const records = await Promise.all(
        transactions.map(async (transaction) => {
          const vendor = await usersCollection.findOne({
            _id: transaction.vendorId,
          });

          return {
            id: transaction._id?.toString() ?? "",
            vendor: vendor
              ? {
                  id: vendor._id.toString(),
                  name: vendor.name,
                  email: vendor.email,
                  businessName: vendor.businessName,
                }
              : null,
            plan: transaction.plan,
            amount: transaction.amount,
            currency: transaction.currency,
            status: transaction.status,
            createdAt: transaction.createdAt,
          };
        })
      );

      res.status(200).json({
        success: true,
        message: "Transactions retrieved successfully.",
        data: {
          transactions: records,
          pagination: {
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit),
          },
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
