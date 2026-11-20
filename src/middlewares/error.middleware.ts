
import {
  Request,
  Response,
  NextFunction,
} from "express";

interface ErrorWithStatus extends Error {
  status?: unknown;
  statusCode?: unknown;
  type?: unknown;
}

export const errorMiddleware = (
  error: Error,
  req: Request,
  res: Response,
  _next: NextFunction
): void => {
  const appError = error as ErrorWithStatus;

  const suppliedStatus =
    typeof appError.statusCode === "number"
      ? appError.statusCode
      : typeof appError.status === "number"
        ? appError.status
        : undefined;

  const isMalformedJson =
    appError.type === "entity.parse.failed";

  const statusCode = isMalformedJson
    ? 400
    : suppliedStatus &&
        suppliedStatus >= 400 &&
        suppliedStatus <= 599
      ? suppliedStatus
      : 500;

  const isClientError = statusCode >= 400 && statusCode < 500;

  if (statusCode >= 500) {
    console.error("PizzaHub API error:", {
      method: req.method,
      path: req.originalUrl,
      error,
    });
  } else if (process.env.NODE_ENV !== "production") {
    console.warn("PizzaHub client request error:", {
      method: req.method,
      path: req.originalUrl,
      message: error.message,
    });
  }

  let message = "Internal server error.";

  if (isMalformedJson) {
    message = "Invalid JSON request body. Please check your request data.";
  } else if (isClientError) {
    message = error.message || "The request could not be processed.";
  } else if (process.env.NODE_ENV !== "production") {
    message = error.message || message;
  }

  res.status(statusCode).json({
    success: false,
    message,
  });
};
