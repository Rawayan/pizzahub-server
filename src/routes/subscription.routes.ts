
import {
  Router,
  Request,
  Response,
  NextFunction,
} from "express";
import Stripe from "stripe";
import { ObjectId } from "mongodb";

import { getDatabase } from "../config/database";
import { getTransactionsCollection } from "../config/collections";
import { authenticate } from "../middlewares/auth.middleware";
import { authorizeRoles } from "../middlewares/authorization.middleware";

const router = Router();

const stripeSecretKey = process.env.STRIPE_SECRET_KEY;

const stripe = stripeSecretKey
  ? new Stripe(stripeSecretKey)
  : null;

const getVendor = async (userId: string) => {
  if (!/^[0-9a-fA-F]{24}$/.test(userId)) {
    return null;
  }

  return getDatabase().collection("users").findOne({
    _id: new ObjectId(userId),
    role: "vendor",
  });
};

const getClientUrl = () =>
  (process.env.CLIENT_URL || "http://localhost:3000").replace(/\/$/, "");

router.use(authenticate, authorizeRoles("vendor"));

/**
 * GET /api/vendor/subscription
 * Current plan and vendor's payment history.
 */
router.get(
  "/",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const vendor = await getVendor(req.authUser!.id);

      if (!vendor) {
        res.status(404).json({
          success: false,
          message: "Vendor account not found.",
        });
        return;
      }

      const expiresAt = vendor.subscriptionExpiresAt
        ? new Date(vendor.subscriptionExpiresAt)
        : null;

      const isPremium =
        vendor.subscriptionPlan === "premium" &&
        (!expiresAt || expiresAt.getTime() > Date.now());

      const transactions = await getTransactionsCollection()
        .find({ vendorId: vendor._id })
        .sort({ createdAt: -1 })
        .limit(20)
        .toArray();

      res.status(200).json({
        success: true,
        message: "Subscription information retrieved.",
        data: {
          plan: isPremium ? "premium" : "free",
          expiresAt: expiresAt?.toISOString() ?? null,
          stripeCustomerConfigured: Boolean(vendor.stripeCustomerId),
          transactions: transactions.map((transaction) => ({
            id: transaction._id?.toString() ?? "",
            plan: transaction.plan,
            amount: transaction.amount,
            currency: transaction.currency,
            status: transaction.status,
            createdAt: transaction.createdAt,
          })),
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/vendor/subscription/checkout
 * Create a recurring Stripe Checkout Session.
 */
router.post(
  "/checkout",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!stripe) {
        res.status(503).json({
          success: false,
          message: "Stripe is not configured on the server.",
        });
        return;
      }

      const priceId = process.env.STRIPE_PREMIUM_PRICE_ID;

      if (!priceId) {
        res.status(503).json({
          success: false,
          message: "Premium subscription price is not configured.",
        });
        return;
      }

      const vendor = await getVendor(req.authUser!.id);

      if (!vendor) {
        res.status(404).json({
          success: false,
          message: "Vendor account not found.",
        });
        return;
      }

      const expiresAt = vendor.subscriptionExpiresAt
        ? new Date(vendor.subscriptionExpiresAt)
        : null;

      const premiumActive =
        vendor.subscriptionPlan === "premium" &&
        (!expiresAt || expiresAt.getTime() > Date.now());

      if (premiumActive) {
        res.status(409).json({
          success: false,
          message: "Your Premium subscription is already active.",
        });
        return;
      }

      const price = await stripe.prices.retrieve(priceId);

      if (!price.active || price.type !== "recurring") {
        res.status(400).json({
          success: false,
          message: "The configured Premium price must be an active recurring price.",
        });
        return;
      }

      const clientUrl = getClientUrl();

      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        line_items: [
          {
            price: priceId,
            quantity: 1,
          },
        ],
        success_url: `${clientUrl}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${clientUrl}/payment/cancel`,
        client_reference_id: vendor._id.toString(),
        metadata: {
          vendorId: vendor._id.toString(),
          userId: vendor._id.toString(),
          plan: "premium",
        },
        subscription_data: {
          metadata: {
            vendorId: vendor._id.toString(),
            userId: vendor._id.toString(),
            plan: "premium",
          },
        },
        ...(vendor.stripeCustomerId
          ? { customer: vendor.stripeCustomerId }
          : { customer_email: vendor.email }),
        allow_promotion_codes: true,
      });

      if (!session.url) {
        res.status(502).json({
          success: false,
          message: "Stripe did not return a Checkout URL.",
        });
        return;
      }

      res.status(200).json({
        success: true,
        message: "Checkout session created.",
        data: {
          checkoutUrl: session.url,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/vendor/subscription/portal
 * Open Stripe Billing Portal for the authenticated vendor.
 */
router.post(
  "/portal",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!stripe) {
        res.status(503).json({
          success: false,
          message: "Stripe is not configured.",
        });
        return;
      }

      const vendor = await getVendor(req.authUser!.id);

      if (!vendor) {
        res.status(404).json({
          success: false,
          message: "Vendor account not found.",
        });
        return;
      }

      if (!vendor.stripeCustomerId) {
        res.status(400).json({
          success: false,
          message: "No Stripe customer is associated with this vendor yet.",
        });
        return;
      }

      const portal = await stripe.billingPortal.sessions.create({
        customer: vendor.stripeCustomerId,
        return_url: `${getClientUrl()}/vendor/subscription`,
      });

      res.status(200).json({
        success: true,
        message: "Billing Portal session created.",
        data: {
          portalUrl: portal.url,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/vendor/subscription/verify-session?session_id=...
 *
 * This endpoint only checks Checkout status.
 * It NEVER activates Premium. The webhook is responsible for activation.
 */
router.get(
  "/verify-session",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!stripe) {
        res.status(503).json({
          success: false,
          message: "Stripe is not configured.",
        });
        return;
      }

      const sessionId =
        typeof req.query.session_id === "string"
          ? req.query.session_id
          : "";

      if (!sessionId || !sessionId.startsWith("cs_")) {
        res.status(400).json({
          success: false,
          message: "A valid Checkout Session ID is required.",
        });
        return;
      }

      const session = await stripe.checkout.sessions.retrieve(sessionId);
      const vendorId = req.authUser!.id;

      if (session.metadata?.vendorId !== vendorId) {
        res.status(403).json({
          success: false,
          message: "This Checkout Session does not belong to your account.",
        });
        return;
      }

      const vendor = await getVendor(vendorId);

      if (!vendor) {
        res.status(404).json({
          success: false,
          message: "Vendor account not found.",
        });
        return;
      }

      const expiresAt = vendor.subscriptionExpiresAt
        ? new Date(vendor.subscriptionExpiresAt)
        : null;

      const premiumActive =
        vendor.subscriptionPlan === "premium" &&
        (!expiresAt || expiresAt.getTime() > Date.now());

      res.status(200).json({
        success: true,
        message: premiumActive
          ? "Premium subscription is active."
          : "Payment confirmation is being processed.",
        data: {
          checkoutStatus: session.status,
          paymentStatus: session.payment_status,
          premiumActive,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
