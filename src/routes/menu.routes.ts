
import { Router, Request, Response, NextFunction } from "express";
import { Filter, ObjectId, Sort } from "mongodb";

import { getMenuItemsCollection } from "../config/collections";
import { getDatabase } from "../config/database";
import { MenuItemDocument } from "../types/database.types";

const router = Router();

type MenuSortOption =
  | "newest"
  | "oldest"
  | "price-low"
  | "price-high"
  | "name";

const DEFAULT_LIMIT = 12;
const MAX_LIMIT = 50;

/**
 * GET /api/menu-items/:id
 *
 * Get details of one approved menu item.
 */
router.get(
  "/:id",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id;

      // Express may type route parameters as string | string[].
      if (
        typeof id !== "string" ||
        !/^[0-9a-fA-F]{24}$/.test(id)
      ) {
        res.status(400).json({
          success: false,
          message: "Invalid menu item ID.",
        });
        return;
      }

      const menuItemsCollection = getMenuItemsCollection();

      const item = await menuItemsCollection.findOne({
        _id: new ObjectId(id),
        status: "approved",
      });

      if (!item) {
        res.status(404).json({
          success: false,
          message: "Menu item not found or unavailable.",
        });
        return;
      }

      const database = getDatabase();

      const vendor = await database.collection("users").findOne(
        {
          _id: item.vendorId,
        },
        {
          projection: {
            _id: 1,
            name: 1,
            image: 1,
            businessName: 1,
          },
        }
      );

      const formattedItem = {
        id: item._id?.toString(),
        itemName: item.itemName,
        category: item.category,
        description: item.description,
        price: item.price,
        location: item.location,
        images: item.images ?? [],
        status: item.status,
        createdAt: item.createdAt,
        vendorId: item.vendorId.toString(),
        vendor: vendor
          ? {
              id: vendor._id.toString(),
              name: vendor.name ?? "PizzaHub Vendor",
              image: vendor.image ?? null,
              businessName:
                vendor.businessName ?? vendor.name ?? "PizzaHub Vendor",
            }
          : null,
      };

      res.status(200).json({
        success: true,
        message: "Menu item details retrieved successfully.",
        data: {
          item: formattedItem,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/menu-items
 *
 * Get approved menu items with search, filtering,
 * sorting, and pagination.
 *
 * Query parameters:
 * search, category, minPrice, maxPrice,
 * sort, page, limit
 */
router.get(
  "/",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const menuItemsCollection = getMenuItemsCollection();

      const search =
        typeof req.query.search === "string"
          ? req.query.search.trim()
          : "";

      const category =
        typeof req.query.category === "string"
          ? req.query.category.trim()
          : "";

      const minPriceValue =
        typeof req.query.minPrice === "string"
          ? Number(req.query.minPrice)
          : undefined;

      const maxPriceValue =
        typeof req.query.maxPrice === "string"
          ? Number(req.query.maxPrice)
          : undefined;

      const pageValue =
        typeof req.query.page === "string"
          ? Number(req.query.page)
          : 1;

      const limitValue =
        typeof req.query.limit === "string"
          ? Number(req.query.limit)
          : DEFAULT_LIMIT;

      const sortValue =
        typeof req.query.sort === "string"
          ? req.query.sort
          : "newest";

      const validSortOptions: MenuSortOption[] = [
        "newest",
        "oldest",
        "price-low",
        "price-high",
        "name",
      ];

      if (
        (minPriceValue !== undefined &&
          (!Number.isFinite(minPriceValue) || minPriceValue < 0)) ||
        (maxPriceValue !== undefined &&
          (!Number.isFinite(maxPriceValue) || maxPriceValue < 0))
      ) {
        res.status(400).json({
          success: false,
          message: "Price filters must be valid non-negative numbers.",
        });
        return;
      }

      if (
        minPriceValue !== undefined &&
        maxPriceValue !== undefined &&
        minPriceValue > maxPriceValue
      ) {
        res.status(400).json({
          success: false,
          message: "Minimum price cannot exceed maximum price.",
        });
        return;
      }

      const page =
        Number.isInteger(pageValue) && pageValue > 0
          ? pageValue
          : 1;

      const limit =
        Number.isInteger(limitValue) && limitValue > 0
          ? Math.min(limitValue, MAX_LIMIT)
          : DEFAULT_LIMIT;

      const sortOption: MenuSortOption = validSortOptions.includes(
        sortValue as MenuSortOption
      )
        ? (sortValue as MenuSortOption)
        : "newest";

      // Public users can only see approved menu items.
      const filter: Filter<MenuItemDocument> = {
        status: "approved",
      };

      if (search) {
        filter.$or = [
          { itemName: { $regex: search, $options: "i" } },
          { description: { $regex: search, $options: "i" } },
          { category: { $regex: search, $options: "i" } },
          { location: { $regex: search, $options: "i" } },
        ];
      }

      if (category && category.toLowerCase() !== "all") {
        filter.category = {
          $regex: `^${category.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
          $options: "i",
        };
      }

      if (minPriceValue !== undefined || maxPriceValue !== undefined) {
        const priceFilter: {
          $gte?: number;
          $lte?: number;
        } = {};

        if (minPriceValue !== undefined) {
          priceFilter.$gte = minPriceValue;
        }

        if (maxPriceValue !== undefined) {
          priceFilter.$lte = maxPriceValue;
        }

        filter.price = priceFilter;
      }

      const sortOptions: Record<MenuSortOption, Sort> = {
        newest: { createdAt: -1 },
        oldest: { createdAt: 1 },
        "price-low": { price: 1 },
        "price-high": { price: -1 },
        name: { itemName: 1 },
      };

      const skip = (page - 1) * limit;

      const [items, total, categories] = await Promise.all([
        menuItemsCollection
          .find(filter)
          .sort(sortOptions[sortOption])
          .skip(skip)
          .limit(limit)
          .toArray(),

        menuItemsCollection.countDocuments(filter),

        menuItemsCollection.distinct("category", {
          status: "approved",
        }),
      ]);

      const formattedItems = items.map((item) => ({
        id: item._id?.toString(),
        itemName: item.itemName,
        category: item.category,
        description: item.description,
        price: item.price,
        location: item.location,
        images: item.images ?? [],
        createdAt: item.createdAt,
      }));

      res.status(200).json({
        success: true,
        message: "Menu items retrieved successfully.",
        data: {
          items: formattedItems,
          categories: categories.filter(
            (value): value is string => typeof value === "string"
          ),
          pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
            hasNextPage: page * limit < total,
            hasPreviousPage: page > 1,
          },
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
