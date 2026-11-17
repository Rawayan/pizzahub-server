
import "dotenv/config";

import express from "express";
import cors from "cors";
import helmet from "helmet";

import healthRoutes from "./routes/health.routes";
import { notFoundHandler } from "./middlewares/not-found.middleware";
import { errorHandler } from "./middlewares/error.middleware";

const app = express();

// Hide Express information from response headers.
app.disable("x-powered-by");

// Security headers.
app.use(helmet());

// Frontend communication.
app.use(
  cors({
    origin: process.env.CLIENT_URL || "http://localhost:3000",
    credentials: true,
  })
);

// Request body parsing.
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

// Basic server information.
app.get("/", (_req, res) => {
  res.status(200).json({
    success: true,
    message: "Welcome to PizzaHub API",
    status: "Running",
  });
});

// Health-check route.
app.use("/api/health", healthRoutes);

// Handle unknown routes.
app.use(notFoundHandler);

// Centralized error handler.
app.use(errorHandler);

export default app;
