const newOrders = document.getElementById("newOrders");
const completedOrders = document.getElementById("completedOrders");

async function loadOrders() {
    const response = await fetch("/api/orders");
    const orders = await response.json();

    newOrders.innerHTML = "";
    completedOrders.innerHTML = "";

    const active = orders.filter(order => order.status === "New").reverse();
    const completed = orders.filter(order => order.status === "Completed").reverse();

    if (active.length === 0) {
        newOrders.innerHTML = "<p>No new orders.</p>";
    }

    if (completed.length === 0) {
        completedOrders.innerHTML = "<p>No completed orders.</p>";
    }

    active.forEach(order => {
        newOrders.appendChild(createOrderCard(order, true));
    });

    completed.forEach(order => {
        completedOrders.appendChild(createOrderCard(order, false));
    });
}

function createOrderCard(order, showCompleteButton) {
    const div = document.createElement("div");
    div.classList.add("order-card");

    let itemsHtml = "";

    order.items.forEach(item => {
        itemsHtml += `<p>${item.name} x${item.quantity}</p>`;
    });

    div.innerHTML = `
        <h3>Order #${order.id}</h3>
        <p><strong>Name:</strong> ${order.customerName}</p>
        <p><strong>Time:</strong> ${order.date}</p>
        <p><strong>Status:</strong> ${order.status}</p>
        <div class="items">
            ${itemsHtml}
        </div>
        ${
            showCompleteButton
                ? `<button class="complete-btn" onclick="completeOrder(${order.id})">Mark Complete</button>`
                : ""
        }
    `;

    return div;
}

async function completeOrder(id) {
    await fetch(`/api/orders/${id}/complete`, {
        method: "PATCH"
    });

    loadOrders();
}

loadOrders();
setInterval(loadOrders, 5000);