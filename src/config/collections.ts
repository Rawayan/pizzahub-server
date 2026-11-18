
import { Collection } from "mongodb";

import { getDatabase } from "./database";

import {
  MenuItemDocument,
  OrderDocument,
  TransactionDocument,
} from "../types/database.types";

export const getMenuItemsCollection =
  (): Collection<MenuItemDocument> => {
    return getDatabase().collection<MenuItemDocument>("menuItems");
  };

export const getOrdersCollection =
  (): Collection<OrderDocument> => {
    return getDatabase().collection<OrderDocument>("orders");
  };

export const getTransactionsCollection =
  (): Collection<TransactionDocument> => {
    return getDatabase().collection<TransactionDocument>("transactions");
  };
