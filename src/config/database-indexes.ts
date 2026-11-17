
import { Db } from "mongodb";

export const createDatabaseIndexes = async (
  database: Db
): Promise<void> => {
  try {
    const menuItems = database.collection("menuItems");
    const orders = database.collection("orders");
    const transactions = database.collection("transactions");

    // Menu item indexes
    await menuItems.createIndex(
      { vendorId: 1, createdAt: -1 },
      { name: "vendor_menu_created_at" }
    );

    await menuItems.createIndex(
      { status: 1, category: 1 },
      { name: "menu_status_category" }
    );

    await menuItems.createIndex(
      { itemName: "text", description: "text" },
      { name: "menu_search_text" }
    );

    // Order indexes
    await orders.createIndex(
      { customerId: 1, createdAt: -1 },
      { name: "customer_orders_created_at" }
    );

    await orders.createIndex(
      { vendorId: 1, status: 1, createdAt: -1 },
      { name: "vendor_orders_status" }
    );

    await orders.createIndex(
      { itemId: 1, customerId: 1, deliveryDate: 1, status: 1 },
      { name: "order_duplicate_check" }
    );

    // Transaction indexes
    await transactions.createIndex(
      { vendorId: 1, createdAt: -1 },
      { name: "vendor_transactions_created_at" }
    );

    await transactions.createIndex(
      { stripeSessionId: 1 },
      {
        name: "unique_stripe_session",
        unique: true,
        sparse: true,
      }
    );

    console.log("MongoDB indexes created successfully");
  } catch (error) {
    console.error("Failed to create MongoDB indexes:", error);
    throw error;
  }
};
