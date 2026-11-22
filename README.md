# PizzaHub Server — Backend API

<p align="center">
  <strong>Express and TypeScript backend powering the PizzaHub pizza ordering and delivery platform.</strong>
</p>

<p align="center">
  <a href="https://pizzahub-server-puce.vercel.app/">Live API</a> ·
  <a href="https://github.com/Rawayan/pizzahub-client">Frontend Repository</a>
</p>

---

## Project Description

### The Problem PizzaHub Solves

Online pizza ordering platforms need more than a menu and a checkout page. Customers need reliable order processing and status tracking. Vendors need secure tools to manage menus, restaurants, and incoming orders. Administrators need centralized control over users, listings, and financial transactions.

Without a properly structured backend, these workflows can become disconnected, difficult to manage, and vulnerable to unauthorized access or inconsistent data.

**The PizzaHub Server solves this problem by providing a centralized API that securely manages the platform's business logic, data, authentication, authorization, order workflows, and vendor subscriptions.**

It connects the customer, vendor, and administrator experiences through a common backend. It also ensures that sensitive operations, such as role-protected management actions and Premium subscription activation, are handled on the server rather than trusted to the frontend.

## Live Deployment

- **Backend API:** https://pizzahub-server-puce.vercel.app/
- **Frontend Application:** https://pizzahub-client-gold.vercel.app/

## Related Repositories

- **Server:** https://github.com/Rawayan/pizzahub-server
- **Client:** https://github.com/Rawayan/pizzahub-client

## Backend Responsibilities

### Authentication and Authorization
- Verify authentication tokens.
- Protect private API routes.
- Enforce role-based access for customers, vendors, and administrators.
- Restrict protected operations to authorized users.
- Validate resource ownership where required.

### Customer Operations
- Retrieve menu data for customer browsing.
- Support menu search, filtering, and sorting.
- Provide menu item details.
- Create and manage customer orders.
- Support order tracking and pending-order cancellation.
- Provide customer-related data for dashboards.

### Vendor Operations
- Manage vendor restaurant profile information.
- Create, update, and delete menu items.
- Manage incoming orders.
- Accept or reject orders.
- Retrieve subscription information and transaction history.
- Create Stripe Checkout sessions.
- Create Stripe Billing Portal sessions.

### Administrator Operations
- Manage customer and vendor accounts.
- Review and manage menu items.
- Monitor platform transactions.
- Protect administrative endpoints through authorization.

## Premium Subscription and Stripe Integration

PizzaHub uses Stripe for vendor Premium subscriptions.

Premium subscription benefits include:
- Unlimited active menu items.
- Featured placement on the homepage.
- Premium badge.

### Subscription Security

The backend creates Stripe Checkout sessions and verifies incoming webhook signatures.

Subscription status is updated through verified Stripe events, including:

- `checkout.session.completed`
- `invoice.paid`
- `invoice.payment_failed`
- `customer.subscription.updated`
- `customer.subscription.deleted`

The backend does not activate Premium simply because the frontend redirects to a success page.

This protects subscription state from being changed through an untrusted frontend request.

**Important:** Stripe is used for vendor Premium subscriptions only. Customer pizza orders do not use Stripe payments.

## Database

PizzaHub uses MongoDB for application data.

Main application collections:

| Collection | Purpose |
|---|---|
| `users` | User accounts, roles, vendor profiles, and subscription information |
| `menuItems` | Pizza menu items and related information |
| `orders` | Customer orders and order status |
| `transactions` | Vendor subscription transaction records |

Better Auth also manages its authentication-related data.

## Technology Stack

- **Runtime:** Node.js
- **Framework:** Express 5
- **Language:** TypeScript
- **Database:** MongoDB
- **Authentication:** Better Auth token verification and JWT
- **Validation:** Zod
- **Payment Integration:** Stripe SDK
- **Image Upload:** ImgBB integration
- **Security Middleware:** Helmet
- **Cross-Origin Requests:** CORS
- **Environment Configuration:** dotenv

## Project Structure

```text
pizzahub-server/
├── src/
│   ├── config/
│   ├── middlewares/
│   ├── routes/
│   ├── ...
│   └── server.ts
├── .env.example
├── package.json
├── tsconfig.json
└── README.md
```

## Installation and Local Setup

### Prerequisites

- Node.js
- npm
- MongoDB database
- Stripe account for subscription testing
- ImgBB API key

### 1. Clone the repository

```bash
git clone https://github.com/Rawayan/pizzahub-server.git
cd pizzahub-server
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment variables

Create a `.env` file in the server project root.

Use `.env.example` as a reference:

```env
# Server
PORT=5000
NODE_ENV=development

# Frontend URL for CORS
CLIENT_URL=http://localhost:3000

# Better Auth
BETTER_AUTH_URL=http://localhost:3000

# MongoDB
MONGODB_URI=your_mongodb_connection_string
DB_NAME=pizzahub

# JWT
JWT_SECRET=replace_with_a_random_secret

# ImgBB
IMGBB_API_KEY=your_imgbb_api_key

# Stripe
STRIPE_SECRET_KEY=your_stripe_test_secret_key
STRIPE_WEBHOOK_SECRET=your_stripe_webhook_signing_secret
STRIPE_PREMIUM_PRICE_ID=your_recurring_premium_price_id
```

Replace all placeholders with valid configuration values.

Never commit actual API keys, database credentials, or Stripe secrets.

### 4. Start the development server

```bash
npm run dev
```

The local API server runs at:

```text
http://localhost:5000
```

## Available Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start the development server with automatic reload |
| `npm run build` | Compile TypeScript into the production output |
| `npm run start` | Start the compiled production server |
| `npm run typecheck` | Run TypeScript type checking |

## Stripe Webhook Configuration

For local Stripe webhook testing, install and authenticate the Stripe CLI.

```bash
stripe login
```

Forward Stripe events to the local backend:

```bash
stripe listen --forward-to localhost:5000/api/stripe/webhook
```

Copy the signing secret provided by the CLI into the local environment variable:

```env
STRIPE_WEBHOOK_SECRET=your_local_webhook_signing_secret
```

In Stripe Dashboard, configure the deployed webhook endpoint:

```text
https://pizzahub-server-puce.vercel.app/api/stripe/webhook
```

Use the appropriate Stripe mode and matching API keys, Price ID, and webhook signing secret. Sandbox/Test and Live credentials must not be mixed.

## Frontend Integration

The PizzaHub frontend is maintained in a separate repository:

https://github.com/Rawayan/pizzahub-client

Local frontend origin:

```text
http://localhost:3000
```

Production frontend:

```text
https://pizzahub-client-gold.vercel.app
```

Configure `CLIENT_URL` to match the frontend origin for the environment being used.

## Deployment

The backend API is deployed on Vercel.

**Production URL:** https://pizzahub-server-puce.vercel.app/

Configure all required production environment variables in Vercel before deploying.


## Implementation Challenges: API Query Parameters and Middleware Flow

### 1. Building Flexible Menu Search, Filtering, Sorting, and Pagination

A key challenge was supporting multiple menu discovery controls through one list endpoint instead of creating a separate endpoint for every search or filter combination.

**Endpoint:**

```http
GET /api/menu-items
```

Supported query parameters:

| Parameter | Behavior |
|---|---|
| `search` | Case-insensitive search across `itemName`, `description`, `category`, and `location` |
| `category` | Case-insensitive category filter; `all` skips this filter |
| `minPrice` | Inclusive lower price bound |
| `maxPrice` | Inclusive upper price bound |
| `sort` | `newest`, `oldest`, `price-low`, `price-high`, or `name` |
| `page` | 1-based page number; defaults to `1` |
| `limit` | Page size; defaults to `12` and is capped at `50` |

**Example request:**

```http
GET /api/menu-items?search=pepperoni&category=Classic&minPrice=300&maxPrice=900&sort=price-low&page=1&limit=12
```

The route builds a MongoDB filter from the supplied values and always restricts public menu results to approved items.

It validates price values, rejects negative or non-numeric prices, and rejects a minimum price greater than the maximum. It then applies the selected sort order and calculates the pagination offset using:

```ts
const skip = (page - 1) * limit;
```

The item query, matching document count, and available category list are retrieved together. The response includes the items, categories, and pagination metadata such as total pages and whether a previous or next page exists.

Other list endpoints use focused query filters where appropriate. For example, vendor order retrieval accepts `status` (including `all`), while admin transaction monitoring accepts `status`, `page`, and `limit`.

### 2. Middleware Flow: From Incoming Request to Route Handler

The Express application uses an intentional middleware order so that security, database access, Stripe signature verification, and normal JSON parsing work correctly.

The request flow is:

1. **Helmet:** Adds HTTP security headers.
2. **CORS:** Allows the configured frontend origin, credentials, required HTTP methods, and headers.
3. **MongoDB connection middleware:** Ensures the database connection is ready before an API route runs. Connection errors are passed to the centralized error handler.
4. **Stripe webhook router:** Mounted at `/api/stripe` before `express.json()`. This is important because Stripe signature verification needs the original raw request body.
5. **JSON body parser:** Parses JSON for regular API endpoints.
6. **Route mounting:** Directs requests to the users, menu, vendor, orders, customer, admin, and vendor-subscription routers.
7. **Not-found middleware:** Returns a structured 404 response when no route matches.
8. **Central error middleware:** Formats errors into a consistent JSON response and avoids exposing internal server details in production.

### 3. Authentication and Role Authorization

Protected routers use two separate checks.

**Authentication — `authenticate`:**

- Reads the Bearer token from the Authorization header.
- Verifies it against the Better Auth remote JWKS using the configured issuer and audience.
- Validates the token subject.
- Loads the user from MongoDB.
- Rejects missing, invalid, or expired tokens, missing users, blocked accounts, and invalid roles.
- Attaches verified user information to `req.authUser`.

**Authorization — `authorizeRoles(...)`:**

- Checks that the authenticated user's role is permitted for the requested route.
- Returns HTTP 401 when authentication is missing.
- Returns HTTP 403 when the authenticated user does not have the required role.

Route handlers also scope database operations to the authenticated user's ID where ownership matters. For example, vendor order queries include the authenticated vendor's ID, preventing one vendor from retrieving or updating another vendor's orders by changing an order ID.

### 4. Protecting Stripe Webhook Processing

Stripe webhook handling is deliberately separated from ordinary JSON API parsing.

The raw-body route verifies the `Stripe-Signature` header with the configured webhook signing secret before processing subscription events.

Premium status is updated from verified webhook events, not from a frontend redirect or an unverified client request.

## Security Notes

- Keep MongoDB credentials private.
- Never expose Stripe secret keys or webhook signing secrets.
- Never commit `.env` files.
- Validate incoming request data.
- Verify authentication tokens on protected routes.
- Enforce role authorization on the backend.
- Verify Stripe webhook signatures before processing subscription events.
- Do not allow frontend requests to directly modify user roles or Premium subscription status.

## Author

**GitHub:** https://github.com/Rawayan

## License

This project was developed as an academic assignment. No separate open-source license is specified.
