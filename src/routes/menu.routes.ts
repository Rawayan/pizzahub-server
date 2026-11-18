
import { Router, Request, Response, NextFunction } from "express";
import { Filter, Sort } from "mongodb";

import { getMenuItemsCollection } from "../config/collections";
import { MenuItemDocument } from "../types/database.types";

const router = Router();

const DEFAULT_LIMIT = 12;
const MAX_LIMIT = 48;

/**
 * Escape special regex characters to prevent user input
 * from changing the intended search pattern.
 */
const escapeRegex = (value: string): string => {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
};

/**
 * Parse and validate optional numeric query parameters.
 */
const parsePrice = (
  value: unknown
): number | undefined | null => {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string" || value.trim() === "") {
    return null;
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }

  return parsed;
};

/**
 * GET /api/menu-items
 *
 * Public endpoint for browsing approved menu items.
 *
 * Supported query parameters:
 * - search: Search by menu item name
 * - category: Filter by category
 * - minPrice: Minimum price
 * - maxPrice: Maximum price
 * - sort: newest | oldest | price-low | price-high | name
 * - page: Page number
 * - limit: Number of items per page
 */
router.get(
  "/",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const collection = getMenuItemsCollection();

      // -----------------------------------------------
      // 1. Read query parameters
      // -----------------------------------------------

      const search =
        typeof req.query.search === "string"
          ? req.query.search.trim().slice(0, 80)
          : "";

      const category =
        typeof req.query.category === "string"
          ? req.query.category.trim().slice(0, 60)
          : "";

      const sortBy =
        typeof req.query.sort === "string"
          ? req.query.sort
          : "newest";

      const minPrice = parsePrice(req.query.minPrice);
      const maxPrice = parsePrice(req.query.maxPrice);

      // -----------------------------------------------
      // 2. Validate price filters
      // -----------------------------------------------

      if (minPrice === null || maxPrice === null) {
        res.status(400).json({
          success: false,
          message: "Please provide valid non-negative price values.",
        });
        return;
      }

      if (
        minPrice !== undefined &&
        maxPrice !== undefined &&
        minPrice > maxPrice
      ) {
        res.status(400).json({
          success: false,
          message: "Minimum price cannot be greater than maximum price.",
        });
        return;
      }

      // -----------------------------------------------
      // 3. Validate pagination
      // -----------------------------------------------

      const requestedPage = Number(req.query.page);
      const requestedLimit = Number(req.query.limit);

      const page =
        Number.isInteger(requestedPage) && requestedPage > 0
          ? Math.min(requestedPage, 100000)
          : 1;

      const limit =
        Number.isInteger(requestedLimit) && requestedLimit > 0
          ? Math.min(requestedLimit, MAX_LIMIT)
          : DEFAULT_LIMIT;

      const skip = (page - 1) * limit;

      // -----------------------------------------------
      // 4. Build MongoDB filter
      // -----------------------------------------------

      const filter: Filter<MenuItemDocument> = {
        status: "approved",
      };

      // Search by menu item name.
      if (search) {
        filter.itemName = {
          $regex: escapeRegex(search),
          $options: "i",
        };
      }

      // Filter by category.
      if (category && category.toLowerCase() !== "all") {
        filter.category = category;
      }

      // Filter by price range.
      if (minPrice !== undefined || maxPrice !== undefined) {
        const priceFilter: {
          $gte?: number;
          $lte?: number;
        } = {};

        if (minPrice !== undefined) {
          priceFilter.$gte = minPrice;
        }

        if (maxPrice !== undefined) {
          priceFilter.$lte = maxPrice;
        }

        filter.price = priceFilter;
      }

      // -----------------------------------------------
      // 5. Configure sorting
      // -----------------------------------------------

      const sortOptions: Record<string, Sort> = {
        newest: { createdAt: -1 },
        oldest: { createdAt: 1 },
        "price-low": { price: 1, createdAt: -1 },
        "price-high": { price: -1, createdAt: -1 },
        name: { itemName: 1 },
      };

      const sort: Sort =
        sortOptions[sortBy] || sortOptions.newest;

      // -----------------------------------------------
      // 6. Retrieve menu items, count, and categories
      // -----------------------------------------------

      const [documents, total, categories] = await Promise.all([
        collection
          .find(filter)
          .sort(sort)
          .skip(skip)
          .limit(limit)
          .toArray(),

        collection.countDocuments(filter),

        collection.distinct("category", {
          status: "approved",
        }),
      ]);

      // -----------------------------------------------
      // 7. Format menu item response
      // -----------------------------------------------

      const items = documents.map((item) => ({
        id: item._id?.toString() || "",
        itemName: item.itemName,
        category: item.category,
        description: item.description,
        price: item.price,
        location: item.location,
        images: item.images || [],
        createdAt: item.createdAt,
      }));

      // Return only valid, non-empty category names.
      const cleanCategories = categories
        .filter(
          (value): value is string =>
            typeof value === "string" &&
            value.trim().length > 0
        )
        .map((value) => value.trim())
        .sort((a, b) => a.localeCompare(b));

      // -----------------------------------------------
      // 8. Send successful response
      // -----------------------------------------------

      res.status(200).json({
        success: true,
        message: "Menu items retrieved successfully.",
        data: {
          items,
          categories: cleanCategories,
          total,
          pagination: {
            page,
            limit,
            total,
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
