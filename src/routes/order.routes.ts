import {
  Router,
  Request,
  Response,
  NextFunction,
  RequestHandler,
} from "express";

import { Filter, ObjectId } from "mongodb";

import {
  getDatabase,
} from "../config/database";

import {
  getOrdersCollection,
  getMenuItemsCollection,
} from "../config/collections";

import { authenticate } from "../middlewares/auth.middleware";
import { authorizeRoles } from "../middlewares/authorization.middleware";

import {
  OrderDocument,
  OrderStatus,
  MenuItemDocument,
  UserDocument,
} from "../types/database.types";

const router = Router();

// ============================================
// Types
// ============================================

interface VendorOrderResponse {
  id: string;
  item: {
    id: string;
    itemName: string;
    category: string;
    price: number;
    images: string[];
  } | null;
  customer: {
    id: string;
    name: string;
    email: string;
    image: string | null;
  } | null;
  deliveryDate: Date;
  deliveryAddress: string;
  message: string;
  status: OrderStatus;
  createdAt: Date;
}

type VendorOrderStatusFilter =
  | "pending"
  | "accepted"
  | "rejected"
  | "cancelled";

// ============================================
// Helpers
// ============================================

const isValidObjectId = (value: unknown): value is string => {
  return (
    typeof value === "string" &&
    /^[0-9a-fA-F]{24}$/.test(value)
  );
};

const isOrderStatus = (
  value: string
): value is VendorOrderStatusFilter => {
  return (
    value === "pending" ||
    value === "accepted" ||
    value === "rejected" ||
    value === "cancelled"
  );
};

const getVendorId = (req: Request): ObjectId | null => {
  const userId = req.authUser?.id;

  if (!isValidObjectId(userId)) {
    return null;
  }

  return new ObjectId(userId);
};

const sendNotFound = (res: Response): void => {
  res.status(404).json({
    success: false,
    message: "Order not found.",
  });
};

// ============================================
// Authentication
// ============================================

router.use(authenticate);

// ============================================
// GET /api/orders/vendor-orders
// Get orders belonging to the logged-in vendor
// ============================================

router.get(
  "/vendor-orders",
  authorizeRoles("vendor"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const vendorId = getVendorId(req);

      if (!vendorId) {
        res.status(401).json({
          success: false,
          message: "Invalid vendor account.",
        });
        return;
      }

      const requestedStatus =
        typeof req.query.status === "string"
          ? req.query.status.trim().toLowerCase()
          : "all";

      if (
        requestedStatus !== "all" &&
        !isOrderStatus(requestedStatus)
      ) {
        res.status(400).json({
          success: false,
          message: "Invalid order status filter.",
        });
        return;
      }

      const filter: Filter<OrderDocument> = {
        vendorId,
      };

      if (
        requestedStatus !== "all" &&
        isOrderStatus(requestedStatus)
      ) {
        filter.status = requestedStatus;
      }

      const orders = await getOrdersCollection()
        .find(filter)
        .sort({
          createdAt: -1,
        })
        .limit(100)
        .toArray();

      if (orders.length === 0) {
        res.status(200).json({
          success: true,
          message: "No customer orders found.",
          data: {
            orders: [],
            total: 0,
          },
        });
        return;
      }

      // ----------------------------------------
      // Collect related IDs for batch lookups
      // ----------------------------------------

      const itemIds = [
        ...new Map(
          orders.map((order) => [
            order.itemId.toString(),
            order.itemId,
          ])
        ).values(),
      ];

      const customerIds = [
        ...new Map(
          orders.map((order) => [
            order.customerId.toString(),
            order.customerId,
          ])
        ).values(),
      ];

      // ----------------------------------------
      // Fetch related menu items and customers
      // ----------------------------------------

      const [items, customers] = await Promise.all([
        getMenuItemsCollection()
          .find({
            _id: {
              $in: itemIds,
            },
          })
          .toArray(),

        getDatabase()
          .collection<UserDocument>("users")
          .find({
            _id: {
              $in: customerIds,
            },
          })
          .project({
            name: 1,
            email: 1,
            image: 1,
          })
          .toArray(),
      ]);

      const itemMap = new Map(
        items.map((item) => [
          item._id!.toString(),
          item,
        ])
      );

      const customerMap = new Map(
        customers.map((customer) => [
          customer._id.toString(),
          customer,
        ])
      );

      // ----------------------------------------
      // Build response
      // ----------------------------------------

      const formattedOrders: VendorOrderResponse[] =
        orders.map((order) => {
          const item = itemMap.get(order.itemId.toString());
          const customer = customerMap.get(
            order.customerId.toString()
          );

          return {
            id: order._id!.toString(),

            item: item
              ? {
                  id: item._id!.toString(),
                  itemName: item.itemName,
                  category: item.category,
                  price: item.price,
                  images: item.images || [],
                }
              : null,

            customer: customer
              ? {
                  id: customer._id.toString(),
                  name: customer.name || "Customer",
                  email: customer.email || "",
                  image: customer.image || null,
                }
              : null,

            deliveryDate: order.deliveryDate,
            deliveryAddress: order.deliveryAddress,
            message: order.message || "",
            status: order.status,
            createdAt: order.createdAt,
          };
        });

      res.status(200).json({
        success: true,
        message: "Vendor orders retrieved successfully.",
        data: {
          orders: formattedOrders,
          total: formattedOrders.length,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

// ============================================
// GET /api/orders/:id
// Get one order belonging to the vendor
// ============================================

router.get(
  "/:id",
  authorizeRoles("vendor"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id;
      const vendorId = getVendorId(req);

      if (!isValidObjectId(id)) {
        res.status(400).json({
          success: false,
          message: "Invalid order ID.",
        });
        return;
      }

      if (!vendorId) {
        res.status(401).json({
          success: false,
          message: "Invalid vendor account.",
        });
        return;
      }

      const order = await getOrdersCollection().findOne({
        _id: new ObjectId(id),
        vendorId,
      });

      if (!order) {
        sendNotFound(res);
        return;
      }

      const [item, customer] = await Promise.all([
        getMenuItemsCollection().findOne({
          _id: order.itemId,
        }),

        getDatabase()
          .collection<UserDocument>("users")
          .findOne(
            {
              _id: order.customerId,
            },
            {
              projection: {
                name: 1,
                email: 1,
                image: 1,
              },
            }
          ),
      ]);

      res.status(200).json({
        success: true,
        message: "Order details retrieved successfully.",
        data: {
          order: {
            id: order._id!.toString(),

            item: item
              ? {
                  id: item._id!.toString(),
                  itemName: item.itemName,
                  category: item.category,
                  description: item.description,
                  price: item.price,
                  location: item.location,
                  images: item.images || [],
                }
              : null,

            customer: customer
              ? {
                  id: customer._id.toString(),
                  name: customer.name || "Customer",
                  email: customer.email || "",
                  image: customer.image || null,
                }
              : null,

            deliveryDate: order.deliveryDate,
            deliveryAddress: order.deliveryAddress,
            message: order.message || "",
            status: order.status,
            createdAt: order.createdAt,
          },
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

// ============================================
// Shared accept/reject handler
// Only pending orders can be updated
// ============================================

const updateOrderStatus = (
  newStatus: "accepted" | "rejected"
): RequestHandler => {
  return async (req, res, next) => {
    try {
      const id = req.params.id;
      const vendorId = getVendorId(req);

      if (!isValidObjectId(id)) {
        res.status(400).json({
          success: false,
          message: "Invalid order ID.",
        });
        return;
      }

      if (!vendorId) {
        res.status(401).json({
          success: false,
          message: "Invalid vendor account.",
        });
        return;
      }

      const orderId = new ObjectId(id);

      // Atomic transition:
      // The order can only be changed while its status is pending.
      const result = await getOrdersCollection().updateOne(
        {
          _id: orderId,
          vendorId,
          status: "pending",
        },
        {
          $set: {
            status: newStatus,
          },
        }
      );

      if (result.modifiedCount === 0) {
        const existingOrder = await getOrdersCollection().findOne({
          _id: orderId,
          vendorId,
        });

        if (!existingOrder) {
          sendNotFound(res);
          return;
        }

        res.status(409).json({
          success: false,
          message:
            "This order has already been processed. Only pending orders can be accepted or rejected.",
          data: {
            currentStatus: existingOrder.status,
          },
        });
        return;
      }

      res.status(200).json({
        success: true,
        message:
          newStatus === "accepted"
            ? "Order accepted successfully."
            : "Order rejected successfully.",
        data: {
          id,
          status: newStatus,
        },
      });
    } catch (error) {
      next(error);
    }
  };
};

// ============================================
// PATCH /api/orders/:id/accept
// ============================================

router.patch(
  "/:id/accept",
  authorizeRoles("vendor"),
  updateOrderStatus("accepted")
);

// ============================================
// PATCH /api/orders/:id/reject
// ============================================

router.patch(
  "/:id/reject",
  authorizeRoles("vendor"),
  updateOrderStatus("rejected")
);

export default router;