# POS

A vanilla HTML, CSS, JavaScript, Express, and SQLite point-of-sale app for a small cafe or restaurant.

## Features
- Cashier register for building and submitting orders
- SQLite-backed product/menu management
- Admin dashboard with order analytics
- Kitchen display with order status flow: `New` -> `In Progress` -> `Ready` -> `Completed`
- Persistent storage using `products`, `orders`, and `order_items` tables

## Install
```bash
npm install
```

## Start
```bash
npm start
```

The server runs at:
```text
http://localhost:3000
```

By default, data is stored in `orders.db`. To use a different database file:
```bash
ORDERS_DB_PATH=path/to/orders.db npm start
```

## Pages
- `/` - cashier register plus right-side admin dashboard
- `/kitchen.html` - kitchen order screen with status controls

## API Routes
- `GET /api/products` - list active products
- `GET /api/products?includeInactive=1` - list all products
- `GET /api/products?includeInactive=1&category=Coffee` - filter products by category
- `POST /api/products` - create a product
- `PATCH /api/products/:id` - update product fields
- `DELETE /api/products/:id` - soft-delete a product by setting `active = 0`
- `POST /api/order` - submit a cashier order
- `GET /api/orders` - list orders with items
- `PATCH /api/orders/:id/status` - move an order to the next allowed status
- `PATCH /api/orders/:id/complete` - compatibility route for completing an order
- `GET /api/analytics` - dashboard totals, revenue, status counts, product revenue, and recent orders

## Database Tables
- `products`
  - `id`
  - `name`
  - `price`
  - `category`
  - `active`
  - `created_at`
- `orders`
  - `id`
  - `date`
  - `customer_name`
  - `status`
- `order_items`
  - `id`
  - `order_id`
  - `item_id`
  - `name`
  - `price`
  - `quantity`

If an older `orders.json` file exists, orders are imported into SQLite on startup. Older SQLite databases that stored order items as JSON are migrated into `orders` and `order_items`.

## Test The App
1. Open `http://localhost:3000`.
2. Add products from the admin form, edit prices/categories, deactivate a product, and filter by category.
3. Add active products to the cashier order and submit it.
4. Open `http://localhost:3000/kitchen.html`.
5. Move the order through `Start Order`, `Mark Ready`, and `Complete Order`.
6. Return to the cashier/admin page and confirm analytics update for totals, status counts, recent orders, revenue, and top-selling product.

Product validation prevents blank names, invalid prices, invalid categories, invalid active values, and duplicate product names.
