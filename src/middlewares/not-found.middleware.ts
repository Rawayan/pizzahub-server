
import {
  Request,
  Response,
  NextFunction,
} from "express";

export const notFoundMiddleware = (
  req: Request,
  res: Response,
  _next: NextFunction
): void => {
  res.status(404).json({
    success: false,
    message: "The requested API endpoint was not found.",
    path:
      process.env.NODE_ENV === "production"
        ? undefined
        : req.originalUrl,
  });
};
