
export type AppRole = "customer" | "vendor" | "admin";

export interface AuthenticatedUser {
  id: string;
  email: string;
  name?: string;
  role: AppRole;
  isBlocked: boolean;
}
