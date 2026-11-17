
import { ObjectId } from "mongodb";

export type UserRole = "customer" | "vendor" | "admin";

export type SubscriptionPlan = "free" | "premium";

export type MenuItemStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "inactive";

export type OrderStatus =
  | "pending"
  | "accepted"
  | "rejected"
  | "cancelled";

export type TransactionStatus =
  | "pending"
  | "completed"
  | "failed"
  | "cancelled";

export interface UserDocument {
  _id: ObjectId;
  name: string;
  email: string;
  image?: string;
  role: UserRole;
  isBlocked: boolean;
  businessName?: string;
  subscriptionPlan: SubscriptionPlan;
  subscriptionExpiresAt?: Date | null;
}

export interface MenuItemDocument {
  _id?: ObjectId;
  vendorId: ObjectId;
  itemName: string;
  category: string;
  description: string;
  price: number;
  location: string;
  images: string[];
  status: MenuItemStatus;
  createdAt: Date;
}

export interface OrderDocument {
  _id?: ObjectId;
  itemId: ObjectId;
  vendorId: ObjectId;
  customerId: ObjectId;
  deliveryDate: Date;
  deliveryAddress: string;
  message?: string;
  status: OrderStatus;
  createdAt: Date;
}

export interface TransactionDocument {
  _id?: ObjectId;
  vendorId: ObjectId;
  plan: SubscriptionPlan;
  amount: number;
  currency: string;
  stripeSessionId: string;
  stripeSubscriptionId?: string;
  status: TransactionStatus;
  createdAt: Date;
}
