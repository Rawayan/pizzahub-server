import "dotenv/config";

import express from "express";
import cors from "cors";
import helmet from "helmet";

import healthRoutes from "./routes/health.routes";
import databaseRoutes from "./routes/database.routes";
import protectedRoutes from "./routes/protected.routes";
import menuRoutes from "./routes/menu.routes";
import vendorRoutes from "./routes/vendor.routes";
import orderRoutes from "./routes/order.routes";

import { notFoundMiddleware } from "./middlewares/not-found.middleware";
import { errorMiddleware } from "./middlewares/error.middleware";

const app = express();

// ============================================
// Security
// ============================================

app.use(helmet());

app.use(
  cors({
    origin: process.env.CLIENT_URL || "http://localhost:3000",
    credentials: true,
    methods: [
      "GET",
      "POST",
      "PUT",
      "PATCH",
      "DELETE",
      "OPTIONS",
    ],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
    ],
  })
);

// ============================================
// Body Parser
// ============================================

app.use(express.json());

// ============================================
// Existing Routes
// ============================================

app.use("/api", healthRoutes);
app.use("/api/db", databaseRoutes);
app.use("/api/protected", protectedRoutes);

// Public menu routes
app.use("/api/menu-items", menuRoutes);

// Vendor dashboard and menu management
app.use("/api/vendor", vendorRoutes);

// Vendor and customer order management
app.use("/api/orders", orderRoutes);

// ============================================
// Root API
// ============================================

app.get("/", (_req, res) => {
  res.status(200).json({
    success: true,
    message: "Welcome to PizzaHub API",
  });
});

// ============================================
// Error Handling
// ============================================

app.use(notFoundMiddleware);
app.use(errorMiddleware);

export default app;