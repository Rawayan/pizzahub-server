import { Router, Request, Response, NextFunction } from "express";
import { Filter, ObjectId } from "mongodb";

import { getDatabase } from "../config/database";
import {
  getMenuItemsCollection,
  getOrdersCollection,
} from "../config/collections";

import { authenticate } from "../middlewares/auth.middleware";
import { authorizeRoles } from "../middlewares/authorization.middleware";

import {
  MenuItemDocument,
  OrderDocument,
  UserDocument,
} from "../types/database.types";

const router = Router();

type OrderStatus = OrderDocument["status"];

interface CustomerOrderResponse {
  id: string;
  item: {
    id: string;
    itemName: string;
    category: string;
    description: string;
    price: number;
    images: string[];
    location: string;
  } | null;
  vendor: {
    id: string;
    name: string;
    businessName?: string;
    image?: string;
  } | null;
  deliveryDate: Date;
  deliveryAddress: string;
  message?: string;
  status: OrderStatus;
  createdAt: Date;
}

const VALID_STATUSES: OrderStatus[] = [
  "pending",
  "accepted",
  "rejected",
  "cancelled",
];

const isValidObjectId = (value: string): boolean =>
  ObjectId.isValid(value) &&
  new ObjectId(value).toHexString() === value.toLowerCase();

/**
 * Gets the authenticated customer's MongoDB ObjectId.
 */
const getCustomerObjectId = (req: Request): ObjectId | null => {
  const userId = req.authUser?.id;

  if (!userId || !isValidObjectId(userId)) {
    return null;
  }

  return new ObjectId(userId);
};

/**
 * Safely extracts a single route parameter.
 * Express 5 may type route parameters as string | string[].
 */
const getRouteParam = (
  req: Request,
  paramName: string
): string | null => {
  const value = req.params[paramName];

  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value) && typeof value[0] === "string") {
    return value[0];
  }

  return null;
};

/**
 * Gets an order with its related menu item and vendor information.
 */
const enrichOrder = async (
  order: OrderDocument
): Promise<CustomerOrderResponse> => {
  const menuItemsCollection = getMenuItemsCollection();
  const usersCollection = getDatabase().collection<UserDocument>("users");

  const [menuItem, vendor] = await Promise.all([
    menuItemsCollection.findOne({
      _id: order.itemId,
    }),
    usersCollection.findOne({
      _id: order.vendorId,
    }),
  ]);

  return {
    id: order._id?.toString() ?? "",
    item: menuItem
      ? {
          id: menuItem._id?.toString() ?? "",
          itemName: menuItem.itemName,
          category: menuItem.category,
          description: menuItem.description,
          price: menuItem.price,
          images: menuItem.images ?? [],
          location: menuItem.location,
        }
      : null,
    vendor: vendor
      ? {
          id: vendor._id.toString(),
          name: vendor.name,
          businessName: vendor.businessName,
          image: vendor.image,
        }
      : null,
    deliveryDate: order.deliveryDate,
    deliveryAddress: order.deliveryAddress,
    message: order.message,
    status: order.status,
    createdAt: order.createdAt,
  };
};

/**
 * Customer-only routes.
 */
router.use(authenticate, authorizeRoles("customer"));

/**
 * GET /api/customer/dashboard
 *
 * Returns customer dashboard statistics and recent activity.
 */
router.get(
  "/dashboard",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const customerId = getCustomerObjectId(req);

      if (!customerId) {
        res.status(401).json({
          success: false,
          message: "Invalid or missing customer authentication.",
        });
        return;
      }

      const ordersCollection = getOrdersCollection();

      const orders = await ordersCollection
        .find({ customerId })
        .sort({ createdAt: -1 })
        .toArray();

      const statistics = {
        totalOrders: orders.length,
        pendingOrders: orders.filter(
          (order) => order.status === "pending"
        ).length,
        acceptedOrders: orders.filter(
          (order) => order.status === "accepted"
        ).length,
        rejectedOrders: orders.filter(
          (order) => order.status === "rejected"
        ).length,
        cancelledOrders: orders.filter(
          (order) => order.status === "cancelled"
        ).length,
      };

      const recentOrders = await Promise.all(
        orders.slice(0, 5).map((order) => enrichOrder(order))
      );

      res.status(200).json({
        success: true,
        message: "Customer dashboard retrieved successfully.",
        data: {
          statistics,
          recentOrders,
          activity: recentOrders,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/customer/orders
 *
 * Creates a pending order for one approved menu item.
 * The customer and vendor IDs, item price, and order status
 * are determined by the server rather than trusted from the client.
 */
router.post(
  "/orders",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const customerId = getCustomerObjectId(req);

      if (!customerId) {
        res.status(401).json({
          success: false,
          message: "Invalid or missing customer authentication.",
        });
        return;
      }

      const body = req.body as Record<string, unknown>;

      const itemId =
        typeof body.itemId === "string" ? body.itemId.trim() : "";

      const deliveryDateValue =
        typeof body.deliveryDate === "string"
          ? body.deliveryDate.trim()
          : "";

      const deliveryAddress =
        typeof body.deliveryAddress === "string"
          ? body.deliveryAddress.trim()
          : "";

      const message =
        typeof body.message === "string" ? body.message.trim() : "";

      if (!isValidObjectId(itemId)) {
        res.status(400).json({
          success: false,
          message: "A valid menu item is required.",
        });
        return;
      }

      const deliveryDate = new Date(deliveryDateValue);

      if (
        !deliveryDateValue ||
        Number.isNaN(deliveryDate.getTime()) ||
        deliveryDate < new Date(new Date().setHours(0, 0, 0, 0))
      ) {
        res.status(400).json({
          success: false,
          message:
            "Please select a valid delivery date that is not in the past.",
        });
        return;
      }

      if (deliveryAddress.length < 10 || deliveryAddress.length > 500) {
        res.status(400).json({
          success: false,
          message: "Delivery address must be between 10 and 500 characters.",
        });
        return;
      }

      if (message.length > 500) {
        res.status(400).json({
          success: false,
          message: "Special instructions cannot exceed 500 characters.",
        });
        return;
      }

      const item = await getMenuItemsCollection().findOne({
        _id: new ObjectId(itemId),
        status: "approved",
      });

      if (!item) {
        res.status(404).json({
          success: false,
          message:
            "This menu item is unavailable or has not been approved.",
        });
        return;
      }

      const vendor = await getDatabase()
        .collection<UserDocument>("users")
        .findOne({
          _id: item.vendorId,
          role: "vendor",
          isBlocked: { $ne: true },
        });

      if (!vendor) {
        res.status(409).json({
          success: false,
          message: "This restaurant is currently unavailable.",
        });
        return;
      }

      const order: OrderDocument = {
        itemId: item._id!,
        vendorId: item.vendorId,
        customerId,
        deliveryDate,
        deliveryAddress,
        ...(message ? { message } : {}),
        status: "pending",
        createdAt: new Date(),
      };

      const result = await getOrdersCollection().insertOne(order);

      const savedOrder: OrderDocument = {
        ...order,
        _id: result.insertedId,
      };

      const enrichedOrder = await enrichOrder(savedOrder);

      res.status(201).json({
        success: true,
        message: "Your order has been placed successfully.",
        data: {
          order: enrichedOrder,
          total: item.price,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/customer/orders
 *
 * Returns the authenticated customer's order history.
 *
 * Optional query parameters:
 * status, page, limit
 */
router.get(
  "/orders",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const customerId = getCustomerObjectId(req);

      if (!customerId) {
        res.status(401).json({
          success: false,
          message: "Invalid or missing customer authentication.",
        });
        return;
      }

      const rawStatus = req.query.status;

      const status =
        typeof rawStatus === "string" ? rawStatus : undefined;

      if (status && !VALID_STATUSES.includes(status as OrderStatus)) {
        res.status(400).json({
          success: false,
          message: "Invalid order status filter.",
        });
        return;
      }

      const rawPage = Number(req.query.page);
      const rawLimit = Number(req.query.limit);

      const page =
        Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1;

      const limit =
        Number.isInteger(rawLimit) && rawLimit > 0
          ? Math.min(rawLimit, 50)
          : 10;

      const filter: Filter<OrderDocument> = {
        customerId,
        ...(status ? { status: status as OrderStatus } : {}),
      };

      const ordersCollection = getOrdersCollection();

      const [orders, total] = await Promise.all([
        ordersCollection
          .find(filter)
          .sort({ createdAt: -1 })
          .skip((page - 1) * limit)
          .limit(limit)
          .toArray(),

        ordersCollection.countDocuments(filter),
      ]);

      const enrichedOrders = await Promise.all(
        orders.map((order) => enrichOrder(order))
      );

      res.status(200).json({
        success: true,
        message: "Customer orders retrieved successfully.",
        data: {
          orders: enrichedOrders,
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/customer/orders/:id
 *
 * Returns one order belonging to the authenticated customer.
 */
router.get(
  "/orders/:id",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const customerId = getCustomerObjectId(req);

      if (!customerId) {
        res.status(401).json({
          success: false,
          message: "Invalid or missing customer authentication.",
        });
        return;
      }

      const id = getRouteParam(req, "id");

      if (typeof id !== "string" || !isValidObjectId(id)) {
        res.status(400).json({
          success: false,
          message: "Invalid order ID.",
        });
        return;
      }

      const order = await getOrdersCollection().findOne({
        _id: new ObjectId(id),
        customerId,
      });

      if (!order) {
        res.status(404).json({
          success: false,
          message: "Order not found.",
        });
        return;
      }

      const enrichedOrder = await enrichOrder(order);

      res.status(200).json({
        success: true,
        message: "Order details retrieved successfully.",
        data: {
          order: enrichedOrder,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * PATCH /api/customer/orders/:id/cancel
 *
 * Customers can cancel only their own pending orders.
 */
router.patch(
  "/orders/:id/cancel",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const customerId = getCustomerObjectId(req);

      if (!customerId) {
        res.status(401).json({
          success: false,
          message: "Invalid or missing customer authentication.",
        });
        return;
      }

      const id = getRouteParam(req, "id");

      if (typeof id !== "string" || !isValidObjectId(id)) {
        res.status(400).json({
          success: false,
          message: "Invalid order ID.",
        });
        return;
      }

      const orderId = new ObjectId(id);
      const ordersCollection = getOrdersCollection();

      const updatedOrder = await ordersCollection.findOneAndUpdate(
        {
          _id: orderId,
          customerId,
          status: "pending",
        },
        {
          $set: {
            status: "cancelled",
          },
        },
        {
          returnDocument: "after",
        }
      );

      if (!updatedOrder) {
        const existingOrder = await ordersCollection.findOne({
          _id: orderId,
          customerId,
        });

        if (!existingOrder) {
          res.status(404).json({
            success: false,
            message: "Order not found.",
          });
          return;
        }

        res.status(409).json({
          success: false,
          message: "Only pending orders can be cancelled.",
        });
        return;
      }

      const enrichedOrder = await enrichOrder(updatedOrder);

      res.status(200).json({
        success: true,
        message: "Order cancelled successfully.",
        data: {
          order: enrichedOrder,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;