const express = require("express");
const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static("pos"));

const ORDER_STATUSES = ["New", "In Progress", "Ready", "Completed"];
const STATUS_TRANSITIONS = {
    New: ["In Progress"],
    "In Progress": ["Ready"],
    Ready: ["Completed"],
    Completed: []
};

const jsonOrdersPath = path.join(__dirname, "orders.json");
const dbPath = process.env.ORDERS_DB_PATH || path.join(__dirname, "orders.db");
const db = new DatabaseSync(dbPath);

db.exec("PRAGMA foreign_keys = ON");

function createSchema() {
    db.exec(`
        CREATE TABLE IF NOT EXISTS orders (
            id INTEGER PRIMARY KEY,
            date TEXT NOT NULL,
            customer_name TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'New'
        );

        CREATE TABLE IF NOT EXISTS order_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            order_id INTEGER NOT NULL,
            item_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            price REAL NOT NULL,
            quantity INTEGER NOT NULL,
            FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_order_items_order_id
        ON order_items(order_id);
    `);
}

function tableExists(tableName) {
    return Boolean(
        db.prepare(`
            SELECT 1
            FROM sqlite_master
            WHERE type = 'table' AND name = ?
        `).get(tableName)
    );
}

function getColumnNames(tableName) {
    return db.prepare(`PRAGMA table_info(${tableName})`)
        .all()
        .map(column => column.name);
}

function hasLegacySqliteOrders() {
    return tableExists("orders") && getColumnNames("orders").includes("items");
}

function withTransaction(callback) {
    db.exec("BEGIN");

    try {
        const result = callback();
        db.exec("COMMIT");
        return result;
    } catch (error) {
        db.exec("ROLLBACK");
        throw error;
    }
}

function prepareOrderStatements() {
    return {
        insertOrder: db.prepare(`
            INSERT INTO orders (id, date, customer_name, status)
            VALUES (?, ?, ?, ?)
        `),
        insertOrderIfMissing: db.prepare(`
            INSERT OR IGNORE INTO orders (id, date, customer_name, status)
            VALUES (?, ?, ?, ?)
        `),
        insertItem: db.prepare(`
            INSERT INTO order_items (order_id, item_id, name, price, quantity)
            VALUES (?, ?, ?, ?, ?)
        `),
        selectOrders: db.prepare(`
            SELECT id, date, customer_name AS customerName, status
            FROM orders
            ORDER BY id ASC
        `),
        selectItemsByOrder: db.prepare(`
            SELECT item_id AS id, name, price, quantity
            FROM order_items
            WHERE order_id = ?
            ORDER BY order_items.id ASC
        `),
        selectOrderStatus: db.prepare(`
            SELECT status
            FROM orders
            WHERE id = ?
        `),
        updateOrderStatus: db.prepare(`
            UPDATE orders
            SET status = ?
            WHERE id = ?
        `)
    };
}

function insertOrderWithItems(statements, order, ignoreExisting = false) {
    const insertStatement = ignoreExisting
        ? statements.insertOrderIfMissing
        : statements.insertOrder;

    const result = insertStatement.run(
        order.id,
        order.date,
        order.customerName || "Guest",
        order.status || "New"
    );

    if (ignoreExisting && result.changes === 0) {
        return;
    }

    (order.items || []).forEach(item => {
        statements.insertItem.run(
            order.id,
            item.id,
            item.name,
            item.price,
            item.quantity
        );
    });
}

function migrateLegacySqliteOrders() {
    withTransaction(() => {
        db.exec("ALTER TABLE orders RENAME TO legacy_orders_json");
        createSchema();

        const statements = prepareOrderStatements();
        const legacyOrders = db.prepare(`
            SELECT id, date, customer_name AS customerName, items, status
            FROM legacy_orders_json
            ORDER BY id ASC
        `).all();

        legacyOrders.forEach(order => {
            insertOrderWithItems(statements, {
                ...order,
                items: JSON.parse(order.items || "[]")
            });
        });

        db.exec("DROP TABLE legacy_orders_json");
    });
}

function migrateJsonOrders() {
    if (!fs.existsSync(jsonOrdersPath)) {
        return;
    }

    const data = fs.readFileSync(jsonOrdersPath, "utf8");
    const orders = data ? JSON.parse(data) : [];

    withTransaction(() => {
        orders.forEach(order => {
            insertOrderWithItems(statements, order, true);
        });
    });
}

if (hasLegacySqliteOrders()) {
    migrateLegacySqliteOrders();
}

createSchema();

const statements = prepareOrderStatements();

migrateJsonOrders();

function changeOrderStatus(orderId, nextStatus) {
    if (!Number.isFinite(orderId)) {
        return {
            statusCode: 400,
            message: "Order id must be a number."
        };
    }

    if (!ORDER_STATUSES.includes(nextStatus)) {
        return {
            statusCode: 400,
            message: `Status must be one of: ${ORDER_STATUSES.join(", ")}.`
        };
    }

    const order = statements.selectOrderStatus.get(orderId);

    if (!order) {
        return {
            statusCode: 404,
            message: "Order not found."
        };
    }

    if (order.status === nextStatus) {
        return {
            statusCode: 200,
            message: `Order is already ${nextStatus}.`
        };
    }

    const allowedNextStatuses = STATUS_TRANSITIONS[order.status] || [];

    if (!allowedNextStatuses.includes(nextStatus)) {
        return {
            statusCode: 409,
            message: `Order cannot move from ${order.status} to ${nextStatus}.`
        };
    }

    statements.updateOrderStatus.run(nextStatus, orderId);

    return {
        statusCode: 200,
        message: `Order moved to ${nextStatus}.`
    };
}

function sendStatusResponse(res, result) {
    res.status(result.statusCode).json({ message: result.message });
}

app.post("/api/order", (req, res) => {
    const order = req.body;

    if (!Array.isArray(order.items) || order.items.length === 0) {
        return res.status(400).json({ message: "Order must include at least one item." });
    }

    const orderRecord = {
        id: Date.now(),
        date: new Date().toLocaleString(),
        customerName: order.customerName || "Guest",
        items: order.items,
        status: "New"
    };

    withTransaction(() => {
        insertOrderWithItems(statements, orderRecord);
    });

    res.json({
        message: "Order submitted and sent to kitchen!"
    });
});

app.get("/api/orders", (req, res) => {
    const orders = statements.selectOrders.all().map(order => ({
        ...order,
        items: statements.selectItemsByOrder.all(order.id)
    }));

    res.json(orders);
});

app.patch("/api/orders/:id/status", (req, res) => {
    const orderId = Number(req.params.id);
    const result = changeOrderStatus(orderId, req.body.status);

    sendStatusResponse(res, result);
});

app.patch("/api/orders/:id/complete", (req, res) => {
    const orderId = Number(req.params.id);
    const result = changeOrderStatus(orderId, "Completed");

    sendStatusResponse(res, result);
});

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
