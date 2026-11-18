
import { Router, Request, Response, NextFunction } from "express";
import { getMenuItemsCollection } from "../config/collections";

const router = Router();

router.get(
  "/",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const requestedLimit =
        typeof req.query.limit === "string"
          ? Number.parseInt(req.query.limit, 10)
          : 6;

      const limit =
        Number.isFinite(requestedLimit) && requestedLimit > 0
          ? Math.min(requestedLimit, 12)
          : 6;

      const menuItemsCollection = getMenuItemsCollection();

      const [documents, categories] = await Promise.all([
        menuItemsCollection
          .find({ status: "approved" })
          .sort({ createdAt: -1 })
          .limit(limit)
          .toArray(),

        menuItemsCollection.distinct("category", {
          status: "approved",
        }),
      ]);

      const items = documents.map((item) => ({
        id: item._id?.toString() ?? "",
        itemName: item.itemName,
        category: item.category,
        description: item.description,
        price: item.price,
        location: item.location,
        images: Array.isArray(item.images) ? item.images : [],
        createdAt: item.createdAt,
      }));

      return res.status(200).json({
        success: true,
        message: "Approved menu items retrieved successfully",
        data: {
          items,
          categories: categories.filter(
            (category): category is string =>
              typeof category === "string" && category.length > 0
          ),
          total: items.length,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
