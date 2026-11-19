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
import customerRoutes from "./routes/customer.routes";

import { notFoundMiddleware } from "./middlewares/not-found.middleware";
import { errorMiddleware } from "./middlewares/error.middleware";

const app = express();

app.use(helmet());

app.use(
  cors({
    origin: process.env.CLIENT_URL || "http://localhost:3000",
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.use(express.json());

app.use("/api", healthRoutes);
app.use("/api/db", databaseRoutes);
app.use("/api/protected", protectedRoutes);

// Public menu browsing and item details.
app.use("/api/menu-items", menuRoutes);

// Protected vendor features.
app.use("/api/vendor", vendorRoutes);

// Protected vendor order management.
app.use("/api/orders", orderRoutes);

// Protected customer dashboard and order management.
app.use("/api/customer", customerRoutes);

app.get("/", (_req, res) => {
  res.status(200).json({
    success: true,
    message: "Welcome to PizzaHub API",
  });
});

app.use(notFoundMiddleware);
app.use(errorMiddleware);

export default app;