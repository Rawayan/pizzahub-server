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
