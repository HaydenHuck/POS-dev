# POS

A simple point-of-sale system built with:
- HTML
- CSS
- JavaScript
- Node.js (Express)
- SQLite

## Features
- Add/remove items
- Calculate totals
- Submit orders
- Kitchen display screen
- Order completion tracking
- Persistent SQLite order storage using relational `orders` and `order_items` tables

### How to Run
1. Clone the repository:
git clone https://github.com/HaydenHuck/POS.git

2. Navigate into the project:
cd POS

3. Install dependencies:
npm install

4. Start the server:
node server.js

The server stores orders in `orders.db` using SQLite. If an `orders.json` file exists, those orders are imported into SQLite on startup. Older SQLite databases that stored order items as JSON are automatically migrated to the relational table layout.

To use a different database file, start the server with `ORDERS_DB_PATH=path/to/orders.db`.

5. View the webpages:

In your browser open http://localhost:3000/ to view the POS

In another tab open http://localhost:3000/kitchen.html to view the orders for the kitchen
