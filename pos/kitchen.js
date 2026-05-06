const kitchenMessage = document.getElementById("kitchenMessage");

const orderColumns = [
    {
        status: "New",
        container: document.getElementById("newOrders"),
        emptyMessage: "No new orders.",
        action: {
            label: "Start Order",
            nextStatus: "In Progress",
            className: "start-btn"
        }
    },
    {
        status: "In Progress",
        container: document.getElementById("inProgressOrders"),
        emptyMessage: "No orders in progress.",
        action: {
            label: "Mark Ready",
            nextStatus: "Ready",
            className: "ready-btn"
        }
    },
    {
        status: "Ready",
        container: document.getElementById("readyOrders"),
        emptyMessage: "No orders ready.",
        action: {
            label: "Complete Order",
            nextStatus: "Completed",
            className: "complete-btn"
        }
    },
    {
        status: "Completed",
        container: document.getElementById("completedOrders"),
        emptyMessage: "No completed orders.",
        action: null
    }
];

async function loadOrders() {
    const response = await fetch("/api/orders");
    const orders = await response.json();

    orderColumns.forEach(column => {
        column.container.innerHTML = "";

        const columnOrders = orders
            .filter(order => order.status === column.status)
            .reverse();

        if (columnOrders.length === 0) {
            const empty = document.createElement("p");
            empty.classList.add("empty-state");
            empty.textContent = column.emptyMessage;
            column.container.appendChild(empty);
            return;
        }

        columnOrders.forEach(order => {
            column.container.appendChild(createOrderCard(order, column.action));
        });
    });
}

function createOrderCard(order, action) {
    const card = document.createElement("div");
    card.classList.add("order-card", getStatusClassName(order.status));

    const heading = document.createElement("h3");
    heading.textContent = `Order #${order.id}`;
    card.appendChild(heading);

    card.appendChild(createDetail("Name", order.customerName));
    card.appendChild(createDetail("Time", order.date));

    const status = document.createElement("p");
    status.classList.add("status-line");
    status.textContent = order.status;
    card.appendChild(status);

    const items = document.createElement("div");
    items.classList.add("items");

    order.items.forEach(item => {
        const itemLine = document.createElement("p");
        itemLine.textContent = `${item.name} x${item.quantity}`;
        items.appendChild(itemLine);
    });

    card.appendChild(items);

    if (action) {
        const button = document.createElement("button");
        button.classList.add("action-btn", action.className);
        button.textContent = action.label;
        button.addEventListener("click", () => updateOrderStatus(order.id, action.nextStatus));
        card.appendChild(button);
    }

    return card;
}

function createDetail(label, value) {
    const detail = document.createElement("p");
    const labelText = document.createElement("strong");

    labelText.textContent = `${label}: `;
    detail.appendChild(labelText);
    detail.append(value);

    return detail;
}

function getStatusClassName(status) {
    return `status-${status.toLowerCase().replace(/\s+/g, "-")}`;
}

async function updateOrderStatus(id, status) {
    const response = await fetch(`/api/orders/${id}/status`, {
        method: "PATCH",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({ status })
    });

    const data = await response.json();
    kitchenMessage.textContent = data.message;

    if (!response.ok) {
        return;
    }

    loadOrders();
}

loadOrders();
setInterval(loadOrders, 5000);
