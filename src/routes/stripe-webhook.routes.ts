
import { Router, Request, Response } from "express";
import express from "express";
import Stripe from "stripe";
import { ObjectId } from "mongodb";

import { getDatabase } from "../config/database";
import { getTransactionsCollection } from "../config/collections";

const router = Router();

const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

if (!stripeSecretKey) {
  throw new Error("STRIPE_SECRET_KEY is not configured");
}

if (!webhookSecret) {
  throw new Error("STRIPE_WEBHOOK_SECRET is not configured");
}

const stripe = new Stripe(stripeSecretKey);

type StripeSubscriptionWithPeriod = Stripe.Subscription & {
  current_period_end?: number;
};

type CompatibleStripeInvoice = {
  id: string;
  subscription?: string | Stripe.Subscription | null;
  customer?: string | Stripe.Customer | Stripe.DeletedCustomer | null;
  amount_paid?: number;
  amount_due?: number;
  currency?: string;
  parent?: {
    subscription_details?: {
      subscription?: string | Stripe.Subscription | null;
    } | null;
  } | null;
};

/**
 * Get the users collection.
 */
function getUsersCollection() {
  return getDatabase().collection("users");
}

/**
 * Validate MongoDB ObjectId.
 */
function validObjectId(value: string): boolean {
  return ObjectId.isValid(value) && value.length === 24;
}

/**
 * Get subscription ID from either a string or Stripe object.
 */
function getSubscriptionId(
  subscription: string | Stripe.Subscription | null | undefined
): string | null {
  if (!subscription) {
    return null;
  }

  return typeof subscription === "string"
    ? subscription
    : subscription.id;
}

/**
 * Get subscription period end.
 *
 * The cast handles Stripe SDK versions where
 * current_period_end is missing from the Subscription type.
 */
function getSubscriptionPeriodEnd(
  subscription: Stripe.Subscription
): Date | null {
  const periodEnd = (
    subscription as StripeSubscriptionWithPeriod
  ).current_period_end;

  return typeof periodEnd === "number"
    ? new Date(periodEnd * 1000)
    : null;
}

/**
 * Get subscription ID from a Stripe invoice.
 *
 * Newer Stripe API versions store subscription details
 * under invoice.parent.subscription_details.
 */
function getInvoiceSubscription(
  invoice: Stripe.Invoice
): string | Stripe.Subscription | null {
  const compatibleInvoice =
    invoice as unknown as CompatibleStripeInvoice;

  return (
    compatibleInvoice.subscription ??
    compatibleInvoice.parent?.subscription_details?.subscription ??
    null
  );
}

/**
 * Get vendor ID from Stripe subscription metadata.
 */
async function getVendorIdFromSubscription(
  subscriptionId: string
): Promise<string | null> {
  const subscription = await stripe.subscriptions.retrieve(
    subscriptionId
  );

  return subscription.metadata?.vendorId ?? null;
}

/**
 * Update a vendor's subscription information.
 */
async function updateVendorSubscription(
  vendorId: string,
  subscription: Stripe.Subscription,
  plan: "free" | "premium"
): Promise<void> {
  if (!validObjectId(vendorId)) {
    console.error("Invalid vendor ID:", vendorId);
    return;
  }

  const subscriptionExpiresAt =
    plan === "premium"
      ? getSubscriptionPeriodEnd(subscription)
      : null;

  await getUsersCollection().updateOne(
    {
      _id: new ObjectId(vendorId),
      role: "vendor",
    },
    {
      $set: {
        subscriptionPlan: plan,
        subscriptionExpiresAt,
        stripeCustomerId:
          typeof subscription.customer === "string"
            ? subscription.customer
            : subscription.customer.id,
      },
    }
  );
}

/**
 * Save a transaction safely.
 *
 * The unique stripeSessionId index and upsert prevent
 * duplicate transaction records when Stripe retries events.
 */
async function saveTransaction(data: {
  vendorId: string;
  amount: number;
  currency: string;
  stripeSessionId: string;
  stripeSubscriptionId?: string;
  status: "pending" | "completed" | "failed" | "cancelled";
}): Promise<void> {
  if (!validObjectId(data.vendorId)) {
    console.error("Cannot save transaction: invalid vendor ID");
    return;
  }

  const transactions = getTransactionsCollection();

  await transactions.updateOne(
    {
      stripeSessionId: data.stripeSessionId,
    },
    {
      $set: {
        vendorId: new ObjectId(data.vendorId),
        plan: "premium",
        amount: data.amount,
        currency: data.currency.toLowerCase(),
        stripeSessionId: data.stripeSessionId,
        stripeSubscriptionId: data.stripeSubscriptionId,
        status: data.status,
      },
      $setOnInsert: {
        createdAt: new Date(),
      },
    },
    {
      upsert: true,
    }
  );
}

/**
 * Resolve vendor ID from subscription metadata.
 */
async function resolveVendorId(
  subscriptionId: string
): Promise<string | null> {
  try {
    return await getVendorIdFromSubscription(subscriptionId);
  } catch (error) {
    console.error(
      "Failed to retrieve Stripe subscription:",
      error
    );

    return null;
  }
}

/**
 * Stripe webhook endpoint.
 *
 * IMPORTANT:
 * This route must be mounted before express.json()
 * in app.ts so Stripe receives the original raw body.
 */
router.post(
  "/webhook",
  express.raw({ type: "application/json" }),
  async (req: Request, res: Response): Promise<void> => {
    const signature = req.headers["stripe-signature"];

    if (!signature || Array.isArray(signature)) {
      res.status(400).send("Missing Stripe signature");
      return;
    }

    let event: Stripe.Event;

    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        signature,
        webhookSecret
      );
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Unknown signature error";

      console.error("Stripe webhook signature verification failed:", message);

      res.status(400).send(`Webhook Error: ${message}`);
      return;
    }

    try {
      switch (event.type) {
        /**
         * 1. Checkout completed.
         *
         * Premium is activated only after Stripe confirms
         * the completed subscription checkout.
         */
        case "checkout.session.completed": {
          const session = event.data.object as Stripe.Checkout.Session;

          if (
            session.mode !== "subscription" ||
            session.payment_status !== "paid"
          ) {
            break;
          }

          const vendorId =
            session.metadata?.vendorId ??
            session.metadata?.userId;

          const subscriptionId = getSubscriptionId(
            session.subscription as
              | string
              | Stripe.Subscription
              | null
          );

          if (!vendorId || !subscriptionId) {
            console.error(
              "Checkout session is missing vendor or subscription metadata"
            );
            break;
          }

          const subscription =
            await stripe.subscriptions.retrieve(subscriptionId);

          await updateVendorSubscription(
            vendorId,
            subscription,
            "premium"
          );

          await saveTransaction({
            vendorId,
            amount: (session.amount_total ?? 0) / 100,
            currency: session.currency ?? "usd",
            stripeSessionId: session.id,
            stripeSubscriptionId: subscriptionId,
            status: "completed",
          });

          console.log(
            `Premium subscription activated for vendor ${vendorId}`
          );

          break;
        }

        /**
         * 2. Invoice paid.
         *
         * Handles recurring monthly subscription payments.
         */
        case "invoice.paid": {
          const invoice = event.data.object as Stripe.Invoice;

          const subscriptionValue =
            getInvoiceSubscription(invoice);

          const subscriptionId = getSubscriptionId(
            subscriptionValue
          );

          if (!subscriptionId) {
            break;
          }

          const vendorId =
            await resolveVendorId(subscriptionId);

          if (!vendorId) {
            console.error(
              "Could not find vendor for paid invoice:",
              invoice.id
            );
            break;
          }

          const subscription =
            await stripe.subscriptions.retrieve(subscriptionId);

          if (
            subscription.status === "active" ||
            subscription.status === "trialing"
          ) {
            await updateVendorSubscription(
              vendorId,
              subscription,
              "premium"
            );
          }

          await saveTransaction({
            vendorId,
            amount: (invoice.amount_paid ?? 0) / 100,
            currency: invoice.currency ?? "usd",
            stripeSessionId: `invoice:${invoice.id}`,
            stripeSubscriptionId: subscriptionId,
            status: "completed",
          });

          console.log(
            `Invoice ${invoice.id} paid for vendor ${vendorId}`
          );

          break;
        }

        /**
         * 3. Invoice payment failed.
         *
         * Record the failure. Existing paid access is not
         * immediately removed here; subscription status
         * and paid-through expiry determine access.
         */
        case "invoice.payment_failed": {
          const invoice = event.data.object as Stripe.Invoice;

          const subscriptionValue =
            getInvoiceSubscription(invoice);

          const subscriptionId = getSubscriptionId(
            subscriptionValue
          );

          if (!subscriptionId) {
            break;
          }

          const vendorId =
            await resolveVendorId(subscriptionId);

          if (!vendorId) {
            console.error(
              "Could not find vendor for failed invoice:",
              invoice.id
            );
            break;
          }

          await saveTransaction({
            vendorId,
            amount: (invoice.amount_due ?? 0) / 100,
            currency: invoice.currency ?? "usd",
            stripeSessionId: `invoice:${invoice.id}`,
            stripeSubscriptionId: subscriptionId,
            status: "failed",
          });

          console.log(
            `Invoice payment failed for vendor ${vendorId}`
          );

          break;
        }

        /**
         * 4. Subscription updated.
         *
         * Synchronizes subscription status and expiry.
         */
        case "customer.subscription.updated": {
          const subscription =
            event.data.object as Stripe.Subscription;

          const vendorId =
            subscription.metadata?.vendorId;

          if (!vendorId) {
            console.error(
              "Subscription is missing vendorId metadata:",
              subscription.id
            );
            break;
          }

          const isPremium =
            subscription.status === "active" ||
            subscription.status === "trialing";

          await updateVendorSubscription(
            vendorId,
            subscription,
            isPremium ? "premium" : "free"
          );

          console.log(
            `Subscription updated for vendor ${vendorId}: ${subscription.status}`
          );

          break;
        }

        /**
         * 5. Subscription deleted.
         *
         * Reset the vendor to the Free plan.
         */
        case "customer.subscription.deleted": {
          const subscription =
            event.data.object as Stripe.Subscription;

          const vendorId =
            subscription.metadata?.vendorId;

          if (!vendorId) {
            console.error(
              "Deleted subscription is missing vendorId metadata:",
              subscription.id
            );
            break;
          }

          await updateVendorSubscription(
            vendorId,
            subscription,
            "free"
          );

          console.log(
            `Premium subscription ended for vendor ${vendorId}`
          );

          break;
        }

        default: {
          console.log(
            `Unhandled Stripe event: ${event.type}`
          );
        }
      }

      res.status(200).json({
        received: true,
      });
    } catch (error) {
      console.error("Stripe webhook processing error:", error);

      res.status(500).json({
        message: "Webhook processing failed",
      });
    }
  }
);

export default router;
