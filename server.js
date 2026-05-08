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

const PAYMENT_METHODS = ["Cash", "Card", "Mobile Pay", "Other"];
const PRODUCT_CATEGORIES = ["Coffee", "Tea", "Bakery", "Food", "Other"];
const TAX_RATE = 0.08;
const DEFAULT_PRODUCTS = [
    { id: 1, name: "Coffee", price: 3, category: "Coffee" },
    { id: 2, name: "Latte", price: 4, category: "Coffee" },
    { id: 3, name: "Cappuccino", price: 4.5, category: "Coffee" },
    { id: 4, name: "Espresso", price: 2.5, category: "Coffee" },
    { id: 5, name: "Bagel", price: 3.5, category: "Bakery" },
    { id: 6, name: "Muffin", price: 2.75, category: "Bakery" }
];

const jsonOrdersPath = path.join(__dirname, "orders.json");
const dbPath = process.env.ORDERS_DB_PATH || path.join(__dirname, "orders.db");
const db = new DatabaseSync(dbPath);

db.exec("PRAGMA foreign_keys = ON");

function createSchema() {
    db.exec(`
        CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            price REAL NOT NULL CHECK (price > 0),
            category TEXT NOT NULL,
            active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS orders (
            id INTEGER PRIMARY KEY,
            date TEXT NOT NULL,
            customer_name TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'New',
            payment_method TEXT NOT NULL DEFAULT 'Other',
            subtotal REAL NOT NULL DEFAULT 0,
            tax REAL NOT NULL DEFAULT 0,
            total REAL NOT NULL DEFAULT 0
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

        CREATE INDEX IF NOT EXISTS idx_products_category
        ON products(category);
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

function ensureOrderCheckoutColumns() {
    if (!tableExists("orders")) {
        return;
    }

    const columns = getColumnNames("orders");
    const requiredColumns = [
        {
            name: "payment_method",
            definition: "TEXT NOT NULL DEFAULT 'Other'"
        },
        {
            name: "subtotal",
            definition: "REAL NOT NULL DEFAULT 0"
        },
        {
            name: "tax",
            definition: "REAL NOT NULL DEFAULT 0"
        },
        {
            name: "total",
            definition: "REAL NOT NULL DEFAULT 0"
        }
    ];

    requiredColumns.forEach(column => {
        if (!columns.includes(column.name)) {
            db.exec(`ALTER TABLE orders ADD COLUMN ${column.name} ${column.definition}`);
        }
    });
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

function prepareStatements() {
    return {
        productCount: db.prepare("SELECT COUNT(*) AS count FROM products"),
        insertSeedProduct: db.prepare(`
            INSERT INTO products (id, name, price, category, active)
            VALUES (?, ?, ?, ?, 1)
        `),
        selectProductById: db.prepare(`
            SELECT id, name, price, category, active, created_at AS createdAt
            FROM products
            WHERE id = ?
        `),
        selectActiveProductById: db.prepare(`
            SELECT id, name, price, category
            FROM products
            WHERE id = ? AND active = 1
        `),
        selectDuplicateProduct: db.prepare(`
            SELECT id
            FROM products
            WHERE lower(name) = lower(?) AND id != ?
            LIMIT 1
        `),
        insertProduct: db.prepare(`
            INSERT INTO products (name, price, category, active)
            VALUES (?, ?, ?, ?)
        `),
        softDeleteProduct: db.prepare(`
            UPDATE products
            SET active = 0
            WHERE id = ?
        `),
        insertOrder: db.prepare(`
            INSERT INTO orders (
                id,
                date,
                customer_name,
                status,
                payment_method,
                subtotal,
                tax,
                total
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `),
        insertOrderIfMissing: db.prepare(`
            INSERT OR IGNORE INTO orders (
                id,
                date,
                customer_name,
                status,
                payment_method,
                subtotal,
                tax,
                total
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `),
        insertItem: db.prepare(`
            INSERT INTO order_items (order_id, item_id, name, price, quantity)
            VALUES (?, ?, ?, ?, ?)
        `),
        selectOrders: db.prepare(`
            SELECT
                id,
                date,
                customer_name AS customerName,
                status,
                payment_method AS paymentMethod,
                subtotal,
                tax,
                total
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

function seedDefaultProducts(statements) {
    const { count } = statements.productCount.get();

    if (count > 0) {
        return;
    }

    withTransaction(() => {
        DEFAULT_PRODUCTS.forEach(product => {
            statements.insertSeedProduct.run(
                product.id,
                product.name,
                product.price,
                product.category
            );
        });
    });
}

function formatProduct(row) {
    return {
        ...row,
        active: Boolean(row.active)
    };
}

function roundMoney(value) {
    return Math.round((Number(value) || 0) * 100) / 100;
}

function calculateOrderTotals(items) {
    const subtotal = roundMoney(items.reduce(
        (sum, item) => sum + item.price * item.quantity,
        0
    ));
    const tax = roundMoney(subtotal * TAX_RATE);

    return {
        subtotal,
        tax,
        total: roundMoney(subtotal + tax)
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
        order.status || "New",
        order.paymentMethod || "Other",
        order.subtotal || 0,
        order.tax || 0,
        order.total || 0
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

        const statements = prepareStatements();
        const legacyOrders = db.prepare(`
            SELECT id, date, customer_name AS customerName, items, status
            FROM legacy_orders_json
            ORDER BY id ASC
        `).all();

        legacyOrders.forEach(order => {
            const items = JSON.parse(order.items || "[]");
            const totals = calculateOrderTotals(items);

            insertOrderWithItems(statements, {
                ...order,
                ...totals,
                paymentMethod: "Other",
                items
            });
        });

        db.exec("DROP TABLE legacy_orders_json");
    });
}

function migrateJsonOrders(statements) {
    if (!fs.existsSync(jsonOrdersPath)) {
        return;
    }

    const data = fs.readFileSync(jsonOrdersPath, "utf8");
    const orders = data ? JSON.parse(data) : [];

    withTransaction(() => {
        orders.forEach(order => {
            const items = order.items || [];
            const totals = calculateOrderTotals(items);

            insertOrderWithItems(statements, {
                ...order,
                ...totals,
                paymentMethod: order.paymentMethod || order.payment_method || "Other",
                items
            }, true);
        });
    });
}

function backfillOrderTotals() {
    const rows = db.prepare(`
        SELECT id
        FROM orders
        WHERE subtotal = 0 AND tax = 0 AND total = 0
    `).all();
    const selectItems = db.prepare(`
        SELECT price, quantity
        FROM order_items
        WHERE order_id = ?
    `);
    const updateTotals = db.prepare(`
        UPDATE orders
        SET subtotal = ?, tax = ?, total = ?
        WHERE id = ?
    `);

    withTransaction(() => {
        rows.forEach(order => {
            const totals = calculateOrderTotals(selectItems.all(order.id));
            updateTotals.run(totals.subtotal, totals.tax, totals.total, order.id);
        });
    });
}

if (hasLegacySqliteOrders()) {
    migrateLegacySqliteOrders();
}

createSchema();
ensureOrderCheckoutColumns();

const statements = prepareStatements();

seedDefaultProducts(statements);
migrateJsonOrders(statements);
backfillOrderTotals();

function hasField(object, field) {
    return Object.prototype.hasOwnProperty.call(object, field);
}

function isValidCategory(category) {
    return PRODUCT_CATEGORIES.includes(category);
}

function normalizeActive(value) {
    if (value === undefined) {
        return undefined;
    }

    if (typeof value === "boolean") {
        return value ? 1 : 0;
    }

    if (value === 1 || value === "1" || value === "true") {
        return 1;
    }

    if (value === 0 || value === "0" || value === "false") {
        return 0;
    }

    return null;
}

function validateProductInput(body, options = {}) {
    const { partial = false, productId = 0 } = options;
    const values = {};
    const errors = [];

    if (!partial || hasField(body, "name")) {
        const name = typeof body.name === "string" ? body.name.trim() : "";

        if (!name) {
            errors.push("Product name is required.");
        } else if (name.length > 80) {
            errors.push("Product name must be 80 characters or fewer.");
        } else if (statements.selectDuplicateProduct.get(name, productId)) {
            errors.push("A product with this name already exists.");
        } else {
            values.name = name;
        }
    }

    if (!partial || hasField(body, "price")) {
        const blankPrice = typeof body.price === "string" && body.price.trim() === "";
        const price = Number(body.price);

        if (blankPrice || !Number.isFinite(price) || price <= 0) {
            errors.push("Price must be a number greater than 0.");
        } else {
            values.price = Math.round(price * 100) / 100;
        }
    }

    if (!partial || hasField(body, "category")) {
        const category = typeof body.category === "string" ? body.category.trim() : "";

        if (!isValidCategory(category)) {
            errors.push(`Category must be one of: ${PRODUCT_CATEGORIES.join(", ")}.`);
        } else {
            values.category = category;
        }
    }

    if (hasField(body, "active")) {
        const active = normalizeActive(body.active);

        if (active === null) {
            errors.push("Active must be true or false.");
        } else {
            values.active = active;
        }
    } else if (!partial) {
        values.active = 1;
    }

    return { values, errors };
}

function getProductList(options = {}) {
    const { includeInactive = false, category } = options;
    const conditions = [];
    const params = [];

    if (!includeInactive) {
        conditions.push("active = 1");
    }

    if (category) {
        conditions.push("category = ?");
        params.push(category);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    return db.prepare(`
        SELECT id, name, price, category, active, created_at AS createdAt
        FROM products
        ${whereClause}
        ORDER BY active DESC, category ASC, name ASC
    `).all(...params).map(formatProduct);
}

function updateProduct(productId, values) {
    const fields = [];
    const params = [];

    Object.entries(values).forEach(([field, value]) => {
        const column = field === "createdAt" ? "created_at" : field;

        fields.push(`${column} = ?`);
        params.push(value);
    });

    if (fields.length === 0) {
        return null;
    }

    params.push(productId);
    db.prepare(`
        UPDATE products
        SET ${fields.join(", ")}
        WHERE id = ?
    `).run(...params);

    return formatProduct(statements.selectProductById.get(productId));
}

function getProductIdFromParams(req) {
    const productId = Number(req.params.id);

    if (!Number.isInteger(productId) || productId <= 0) {
        return null;
    }

    return productId;
}

function sendValidationError(res, errors) {
    return res.status(400).json({
        message: errors[0] || "Invalid request.",
        errors
    });
}

function validatePaymentMethod(paymentMethod) {
    const normalizedMethod = typeof paymentMethod === "string" ? paymentMethod.trim() : "";

    if (!PAYMENT_METHODS.includes(normalizedMethod)) {
        return {
            value: null,
            errors: [`Payment method must be one of: ${PAYMENT_METHODS.join(", ")}.`]
        };
    }

    return {
        value: normalizedMethod,
        errors: []
    };
}

function buildOrderItems(items) {
    const errors = [];
    const quantitiesByProduct = new Map();

    if (!Array.isArray(items) || items.length === 0) {
        return {
            errors: ["Order must include at least one item."],
            items: []
        };
    }

    items.forEach(item => {
        const productId = Number(item.id);
        const quantity = Number(item.quantity);

        if (!Number.isInteger(productId) || productId <= 0) {
            errors.push("Each order item must include a valid product id.");
            return;
        }

        if (!Number.isInteger(quantity) || quantity <= 0) {
            errors.push("Each order item must include a positive whole-number quantity.");
            return;
        }

        quantitiesByProduct.set(
            productId,
            (quantitiesByProduct.get(productId) || 0) + quantity
        );
    });

    if (errors.length > 0) {
        return { errors, items: [] };
    }

    const orderItems = [];

    quantitiesByProduct.forEach((quantity, productId) => {
        const product = statements.selectActiveProductById.get(productId);

        if (!product) {
            errors.push(`Product ${productId} is not available.`);
            return;
        }

        orderItems.push({
            id: product.id,
            name: product.name,
            price: product.price,
            quantity
        });
    });

    return { errors, items: orderItems };
}

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

function getAnalytics() {
    const totalOrders = db.prepare("SELECT COUNT(*) AS count FROM orders").get().count;
    const completedOrders = db.prepare(`
        SELECT COUNT(*) AS count
        FROM orders
        WHERE status = 'Completed'
    `).get().count;
    const activeOrders = db.prepare(`
        SELECT COUNT(*) AS count
        FROM orders
        WHERE status != 'Completed'
    `).get().count;
    const totalRevenue = db.prepare(`
        SELECT COALESCE(SUM(total), 0) AS total
        FROM orders
        WHERE orders.status = 'Completed'
    `).get().total;
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const tomorrowStart = new Date(todayStart);
    tomorrowStart.setDate(tomorrowStart.getDate() + 1);
    const todayStartId = todayStart.getTime();
    const tomorrowStartId = tomorrowStart.getTime();
    const todayRevenue = db.prepare(`
        SELECT COALESCE(SUM(total), 0) AS total
        FROM orders
        WHERE status = 'Completed' AND id >= ? AND id < ?
    `).get(todayStartId, tomorrowStartId).total;
    const todayCompletedOrders = db.prepare(`
        SELECT COUNT(*) AS count
        FROM orders
        WHERE status = 'Completed' AND id >= ? AND id < ?
    `).get(todayStartId, tomorrowStartId).count;
    const revenueByPaymentMethod = db.prepare(`
        SELECT payment_method AS paymentMethod, COALESCE(SUM(total), 0) AS revenue
        FROM orders
        WHERE status = 'Completed'
        GROUP BY payment_method
        ORDER BY revenue DESC, payment_method ASC
    `).all();
    const revenueByProduct = db.prepare(`
        SELECT
            item_id AS id,
            name,
            SUM(quantity) AS quantity,
            COALESCE(SUM(price * quantity), 0) AS revenue
        FROM order_items
        JOIN orders ON orders.id = order_items.order_id
        WHERE orders.status = 'Completed'
        GROUP BY item_id, name
        ORDER BY revenue DESC, quantity DESC, name ASC
    `).all();
    const statusCounts = db.prepare(`
        SELECT status, COUNT(*) AS count
        FROM orders
        GROUP BY status
    `).all();
    const recentOrders = db.prepare(`
        SELECT
            orders.id,
            orders.date,
            orders.customer_name AS customerName,
            orders.status,
            orders.payment_method AS paymentMethod,
            orders.total
        FROM orders
        ORDER BY orders.id DESC
        LIMIT 8
    `).all();

    const ordersByStatus = ORDER_STATUSES.map(status => {
        const statusRow = statusCounts.find(row => row.status === status);

        return {
            status,
            count: statusRow ? statusRow.count : 0
        };
    });

    const roundedRevenueByProduct = revenueByProduct.map(row => ({
        ...row,
        revenue: roundMoney(row.revenue)
    }));
    const roundedRevenueByPaymentMethod = revenueByPaymentMethod.map(row => ({
        ...row,
        revenue: roundMoney(row.revenue)
    }));
    const roundedRecentOrders = recentOrders.map(order => ({
        ...order,
        total: roundMoney(order.total)
    }));
    const roundedTotalRevenue = roundMoney(totalRevenue);

    return {
        totalOrders,
        completedOrders,
        activeOrders,
        totalRevenue: roundedTotalRevenue,
        averageOrderValue: completedOrders > 0 ? roundMoney(roundedTotalRevenue / completedOrders) : 0,
        todayRevenue: roundMoney(todayRevenue),
        todayCompletedOrders,
        topSellingProduct: roundedRevenueByProduct.length > 0
            ? roundedRevenueByProduct.slice().sort((a, b) => b.quantity - a.quantity || b.revenue - a.revenue)[0]
            : null,
        revenueByPaymentMethod: roundedRevenueByPaymentMethod,
        revenueByProduct: roundedRevenueByProduct,
        ordersByStatus,
        recentOrders: roundedRecentOrders
    };
}

app.get("/api/products", (req, res) => {
    const includeInactive = ["1", "true", "yes"].includes(
        String(req.query.includeInactive || "").toLowerCase()
    );
    const category = typeof req.query.category === "string" ? req.query.category.trim() : "";

    if (category && !isValidCategory(category)) {
        return sendValidationError(res, [
            `Category must be one of: ${PRODUCT_CATEGORIES.join(", ")}.`
        ]);
    }

    res.json(getProductList({
        includeInactive,
        category: category || null
    }));
});

app.post("/api/products", (req, res) => {
    const { values, errors } = validateProductInput(req.body || {});

    if (errors.length > 0) {
        return sendValidationError(res, errors);
    }

    const result = statements.insertProduct.run(
        values.name,
        values.price,
        values.category,
        values.active
    );
    const product = formatProduct(statements.selectProductById.get(Number(result.lastInsertRowid)));

    res.status(201).json({
        message: "Product added.",
        product
    });
});

app.patch("/api/products/:id", (req, res) => {
    const productId = getProductIdFromParams(req);

    if (!productId) {
        return res.status(400).json({ message: "Product id must be a positive number." });
    }

    if (!statements.selectProductById.get(productId)) {
        return res.status(404).json({ message: "Product not found." });
    }

    const { values, errors } = validateProductInput(req.body || {}, {
        partial: true,
        productId
    });

    if (errors.length > 0) {
        return sendValidationError(res, errors);
    }

    const product = updateProduct(productId, values);

    if (!product) {
        return res.status(400).json({ message: "No valid product fields provided." });
    }

    res.json({
        message: "Product updated.",
        product
    });
});

app.delete("/api/products/:id", (req, res) => {
    const productId = getProductIdFromParams(req);

    if (!productId) {
        return res.status(400).json({ message: "Product id must be a positive number." });
    }

    const product = statements.selectProductById.get(productId);

    if (!product) {
        return res.status(404).json({ message: "Product not found." });
    }

    if (!product.active) {
        return res.json({
            message: "Product is already inactive.",
            product: formatProduct(product)
        });
    }

    statements.softDeleteProduct.run(productId);

    res.json({
        message: "Product deactivated.",
        product: formatProduct(statements.selectProductById.get(productId))
    });
});

app.get("/api/analytics", (req, res) => {
    res.json(getAnalytics());
});

app.post("/api/order", (req, res) => {
    const order = req.body || {};
    const orderItems = buildOrderItems(order.items);
    const payment = validatePaymentMethod(order.paymentMethod || order.payment_method);
    const errors = [
        ...orderItems.errors,
        ...payment.errors
    ];

    if (errors.length > 0) {
        return sendValidationError(res, errors);
    }

    const totals = calculateOrderTotals(orderItems.items);

    const orderRecord = {
        id: Date.now(),
        date: new Date().toLocaleString(),
        customerName: typeof order.customerName === "string" && order.customerName.trim()
            ? order.customerName.trim()
            : "Guest",
        items: orderItems.items,
        status: "New",
        paymentMethod: payment.value,
        ...totals
    };

    withTransaction(() => {
        insertOrderWithItems(statements, orderRecord);
    });

    res.status(201).json({
        message: "Order submitted and sent to kitchen!",
        order: orderRecord
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
    const result = changeOrderStatus(orderId, req.body && req.body.status);

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
