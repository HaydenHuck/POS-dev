const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = 3000;

app.use(express.json());
app.use(express.static("pos"));

const filePath = path.join(__dirname, "orders.json");

app.post("/api/order", (req, res) => {
    const order = req.body;

    const orderRecord = {
        id: Date.now(),
        date: new Date().toLocaleString(),
        customerName: order.customerName || "Guest",
        items: order.items,
        status: "New"
    };

    let orders = [];

    if (fs.existsSync(filePath)) {
        const data = fs.readFileSync(filePath, "utf8");
        orders = data ? JSON.parse(data) : [];
    }

    orders.push(orderRecord);

    fs.writeFileSync(filePath, JSON.stringify(orders, null, 2));

    res.json({
        message: "Order submitted and sent to kitchen!"
    });
});

app.get("/api/orders", (req, res) => {
    let orders = [];

    if (fs.existsSync(filePath)) {
        const data = fs.readFileSync(filePath, "utf8");
        orders = data ? JSON.parse(data) : [];
    }

    res.json(orders);
});

app.patch("/api/orders/:id/complete", (req, res) => {
    const orderId = Number(req.params.id);

    let orders = [];

    if (fs.existsSync(filePath)) {
        const data = fs.readFileSync(filePath, "utf8");
        orders = data ? JSON.parse(data) : [];
    }

    const order = orders.find(order => order.id === orderId);

    if (!order) {
        return res.status(404).json({ message: "Order not found." });
    }

    order.status = "Completed";

    fs.writeFileSync(filePath, JSON.stringify(orders, null, 2));

    res.json({ message: "Order marked as completed." });
});

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});