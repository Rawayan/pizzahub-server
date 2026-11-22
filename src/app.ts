
import "dotenv/config";

import express from "express";
import cors from "cors";
import helmet from "helmet";

import { connectToDatabase } from "./config/database";

import healthRoutes from "./routes/health.routes";
import databaseRoutes from "./routes/database.routes";
import protectedRoutes from "./routes/protected.routes";
import menuRoutes from "./routes/menu.routes";
import vendorRoutes from "./routes/vendor.routes";
import orderRoutes from "./routes/order.routes";
import customerRoutes from "./routes/customer.routes";
import adminRoutes from "./routes/admin.routes";
import subscriptionRoutes from "./routes/subscription.routes";
import stripeWebhookRoutes from "./routes/stripe-webhook.routes";
import usersRoutes from "./routes/users.routes";

import { notFoundMiddleware } from "./middlewares/not-found.middleware";
import { errorMiddleware } from "./middlewares/error.middleware";

const app = express();

app.use(helmet());

app.use(
  cors({
    origin: process.env.CLIENT_URL || "http://localhost:3000",
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "Stripe-Signature"],
  })
);

// Connect to MongoDB before processing any API request.
// This works for Vercel serverless requests and local Express requests.
app.use(async (_req, _res, next) => {
  try {
    await connectToDatabase();
    next();
  } catch (error) {
    next(error);
  }
});

// IMPORTANT: Stripe webhook must receive the original raw body.
// Keep this before express.json().
app.use("/api/stripe", stripeWebhookRoutes);

// Parse JSON for normal API endpoints.
app.use(express.json());

app.use("/api/users", usersRoutes);

app.use("/api", healthRoutes);
app.use("/api/db", databaseRoutes);
app.use("/api/protected", protectedRoutes);

app.use("/api/menu-items", menuRoutes);
app.use("/api/vendor", vendorRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/customer", customerRoutes);
app.use("/api/admin", adminRoutes);

app.use("/api/vendor/subscription", subscriptionRoutes);

app.get("/", (_req, res) => {
  res.status(200).json({
    success: true,
    message: "Welcome to PizzaHub API",
  });
});

app.use(notFoundMiddleware);
app.use(errorMiddleware);

export default app;
