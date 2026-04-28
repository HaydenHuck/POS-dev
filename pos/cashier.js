const menu = [
    { id: 1, name: "Coffee", price: 3 },
    { id: 2, name: "Latte", price: 4 },
    { id: 3, name: "Cappuccino", price: 4.5 },
    { id: 4, name: "Espresso", price: 2.5 },
    { id: 5, name: "Bagel", price: 3.5 },
    { id: 6, name: "Muffin", price: 2.75 }
];

let order = [];

const menuContainer = document.getElementById("menuItems");
const orderContainer = document.getElementById("orderItems");
const message = document.getElementById("message");

menu.forEach(item => {
    const div = document.createElement("div");
    div.classList.add("menu-item");

    div.innerHTML = `
        <h3>${item.name}</h3>
        <p>$${item.price.toFixed(2)}</p>
        <button onclick="addToOrder(${item.id})">Add to Order</button>
    `;

    menuContainer.appendChild(div);
});

function addToOrder(id) {
    const item = menu.find(menuItem => menuItem.id === id);
    const existingItem = order.find(orderItem => orderItem.id === id);

    if (existingItem) {
        existingItem.quantity++;
    } else {
        order.push({ ...item, quantity: 1 });
    }

    message.textContent = `${item.name} added to order.`;
    renderOrder();
}

function increaseQuantity(id) {
    const item = order.find(orderItem => orderItem.id === id);

    if (item) {
        item.quantity++;
    }

    renderOrder();
}

function decreaseQuantity(id) {
    const item = order.find(orderItem => orderItem.id === id);

    if (item) {
        item.quantity--;

        if (item.quantity <= 0) {
            removeItem(id);
            return;
        }
    }

    renderOrder();
}

function removeItem(id) {
    order = order.filter(orderItem => orderItem.id !== id);
    message.textContent = "Item removed from order.";
    renderOrder();
}

function renderOrder() {
    orderContainer.innerHTML = "";

    let subtotal = 0;

    if (order.length === 0) {
        orderContainer.innerHTML = "<p>No items added yet.</p>";
    }

    order.forEach(item => {
        subtotal += item.price * item.quantity;

        const div = document.createElement("div");
        div.classList.add("order-item");

        div.innerHTML = `
            <div>
                <strong>${item.name}</strong><br>
                $${item.price.toFixed(2)} each
            </div>

            <div class="quantity-controls">
                <button onclick="decreaseQuantity(${item.id})">-</button>
                <span>${item.quantity}</span>
                <button onclick="increaseQuantity(${item.id})">+</button>
            </div>

            <p>$${(item.price * item.quantity).toFixed(2)}</p>

            <button class="remove-btn" onclick="removeItem(${item.id})">Remove</button>
        `;

        orderContainer.appendChild(div);
    });

    const tax = subtotal * 0.08;
    const total = subtotal + tax;

    document.getElementById("subtotal").textContent = subtotal.toFixed(2);
    document.getElementById("tax").textContent = tax.toFixed(2);
    document.getElementById("total").textContent = total.toFixed(2);
}

document.getElementById("clearOrder").addEventListener("click", () => {
    order = [];
    message.textContent = "Order cleared.";
    renderOrder();
});

document.getElementById("submitOrder").addEventListener("click", async () => {
    if (order.length === 0) {
        message.textContent = "Please add items before submitting.";
        return;
    }

    try {
        const response = await fetch("/api/order", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                customerName: document.getElementById("customerName").value,
                items: order
            })
        });

        const data = await response.json();

        message.textContent = data.message;
        order = [];
        document.getElementById("customerName").value = "";
        renderOrder();

    } catch (error) {
        message.textContent = "There was an error submitting the order.";
        console.error(error);
    }
});

renderOrder();