const PRODUCT_CATEGORIES = ["Coffee", "Tea", "Bakery", "Food", "Other"];
const TAX_RATE = 0.08;

let products = [];
let order = [];
let editingProductId = null;

const menuContainer = document.getElementById("menuItems");
const orderContainer = document.getElementById("orderItems");
const message = document.getElementById("message");
const menuCount = document.getElementById("menuCount");
const customerName = document.getElementById("customerName");
const paymentMethod = document.getElementById("paymentMethod");
const productForm = document.getElementById("productForm");
const productId = document.getElementById("productId");
const productName = document.getElementById("productName");
const productPrice = document.getElementById("productPrice");
const productCategory = document.getElementById("productCategory");
const productActive = document.getElementById("productActive");
const productFilter = document.getElementById("productFilter");
const productMessage = document.getElementById("productMessage");
const productTableBody = document.getElementById("productTableBody");
const saveProduct = document.getElementById("saveProduct");
const cancelEdit = document.getElementById("cancelEdit");
const receiptModal = document.getElementById("receiptModal");
const receiptItems = document.getElementById("receiptItems");
const printReceiptButton = document.getElementById("printReceipt");
const newOrderButton = document.getElementById("newOrder");

function formatCurrency(value) {
    return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD"
    }).format(Number(value) || 0);
}

async function requestJson(url, options = {}) {
    const response = await fetch(url, options);
    const data = await response.json().catch(() => ({
        message: "Request failed."
    }));

    if (!response.ok) {
        throw new Error(data.message || "Request failed.");
    }

    return data;
}

function setMessage(element, text, type = "info") {
    element.textContent = text;
    element.className = type ? `message ${type}` : "message";
}

function populateCategorySelects() {
    productCategory.innerHTML = "";
    productFilter.innerHTML = "";

    const allOption = document.createElement("option");
    allOption.value = "";
    allOption.textContent = "All Categories";
    productFilter.appendChild(allOption);

    PRODUCT_CATEGORIES.forEach(category => {
        const formOption = document.createElement("option");
        formOption.value = category;
        formOption.textContent = category;
        productCategory.appendChild(formOption);

        const filterOption = document.createElement("option");
        filterOption.value = category;
        filterOption.textContent = category;
        productFilter.appendChild(filterOption);
    });
}

async function refreshProducts(options = {}) {
    const { syncOrder = false } = options;
    const category = productFilter.value;
    const adminProductsUrl = category
        ? `/api/products?includeInactive=1&category=${encodeURIComponent(category)}`
        : "/api/products?includeInactive=1";

    const [activeProducts, adminProducts] = await Promise.all([
        requestJson("/api/products"),
        requestJson(adminProductsUrl)
    ]);

    products = activeProducts;
    renderMenu();
    renderProductTable(adminProducts);

    if (syncOrder) {
        syncCurrentOrderWithProducts();
    }
}

function renderMenu() {
    menuContainer.innerHTML = "";
    menuCount.textContent = `${products.length} product${products.length === 1 ? "" : "s"}`;

    if (products.length === 0) {
        const empty = document.createElement("p");
        empty.classList.add("empty-state");
        empty.textContent = "No active products.";
        menuContainer.appendChild(empty);
        return;
    }

    products.forEach(product => {
        const card = document.createElement("article");
        card.classList.add("menu-item");

        const category = document.createElement("span");
        category.classList.add("category-badge");
        category.textContent = product.category;
        card.appendChild(category);

        const name = document.createElement("h3");
        name.textContent = product.name;
        card.appendChild(name);

        const price = document.createElement("p");
        price.textContent = formatCurrency(product.price);
        card.appendChild(price);

        const button = document.createElement("button");
        button.type = "button";
        button.textContent = "Add";
        button.addEventListener("click", () => addToOrder(product.id));
        card.appendChild(button);

        menuContainer.appendChild(card);
    });
}

function addToOrder(id) {
    const product = products.find(menuProduct => menuProduct.id === id);

    if (!product) {
        setMessage(message, "That product is not available.", "error");
        return;
    }

    const existingItem = order.find(orderItem => orderItem.id === id);

    if (existingItem) {
        existingItem.quantity++;
    } else {
        order.push({ ...product, quantity: 1 });
    }

    setMessage(message, `${product.name} added to order.`, "success");
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

    if (!item) {
        return;
    }

    item.quantity--;

    if (item.quantity <= 0) {
        removeItem(id);
        return;
    }

    renderOrder();
}

function removeItem(id) {
    order = order.filter(orderItem => orderItem.id !== id);
    setMessage(message, "Item removed from order.", "info");
    renderOrder();
}

function renderOrder() {
    orderContainer.innerHTML = "";

    let subtotal = 0;

    if (order.length === 0) {
        const empty = document.createElement("p");
        empty.classList.add("empty-state");
        empty.textContent = "No items added yet.";
        orderContainer.appendChild(empty);
    }

    order.forEach(item => {
        subtotal += item.price * item.quantity;

        const row = document.createElement("div");
        row.classList.add("order-item");

        const details = document.createElement("div");
        const name = document.createElement("strong");
        name.textContent = item.name;
        details.appendChild(name);

        const unitPrice = document.createElement("span");
        unitPrice.textContent = `${formatCurrency(item.price)} each`;
        details.appendChild(unitPrice);
        row.appendChild(details);

        const controls = document.createElement("div");
        controls.classList.add("quantity-controls");

        const decreaseButton = document.createElement("button");
        decreaseButton.type = "button";
        decreaseButton.textContent = "-";
        decreaseButton.addEventListener("click", () => decreaseQuantity(item.id));
        controls.appendChild(decreaseButton);

        const quantity = document.createElement("span");
        quantity.textContent = item.quantity;
        controls.appendChild(quantity);

        const increaseButton = document.createElement("button");
        increaseButton.type = "button";
        increaseButton.textContent = "+";
        increaseButton.addEventListener("click", () => increaseQuantity(item.id));
        controls.appendChild(increaseButton);

        row.appendChild(controls);

        const lineTotal = document.createElement("p");
        lineTotal.classList.add("line-total");
        lineTotal.textContent = formatCurrency(item.price * item.quantity);
        row.appendChild(lineTotal);

        const removeButton = document.createElement("button");
        removeButton.type = "button";
        removeButton.classList.add("remove-btn");
        removeButton.textContent = "Remove";
        removeButton.addEventListener("click", () => removeItem(item.id));
        row.appendChild(removeButton);

        orderContainer.appendChild(row);
    });

    const tax = subtotal * TAX_RATE;
    const total = subtotal + tax;

    document.getElementById("subtotal").textContent = subtotal.toFixed(2);
    document.getElementById("tax").textContent = tax.toFixed(2);
    document.getElementById("total").textContent = total.toFixed(2);
}

function syncCurrentOrderWithProducts() {
    let removedItems = false;
    let changedItems = false;

    order = order.map(item => {
        const product = products.find(activeProduct => activeProduct.id === item.id);

        if (!product) {
            removedItems = true;
            return null;
        }

        if (product.name !== item.name || product.price !== item.price) {
            changedItems = true;
        }

        return {
            ...product,
            quantity: item.quantity
        };
    }).filter(Boolean);

    if (removedItems) {
        setMessage(message, "Inactive products were removed from the current order.", "warning");
    } else if (changedItems) {
        setMessage(message, "Current order synced with updated product pricing.", "info");
    }

    renderOrder();
}

async function submitOrder() {
    if (order.length === 0) {
        setMessage(message, "Please add items before submitting.", "error");
        return;
    }

    try {
        const data = await requestJson("/api/order", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                customerName: customerName.value.trim(),
                paymentMethod: paymentMethod.value,
                items: order.map(item => ({
                    id: item.id,
                    quantity: item.quantity
                }))
            })
        });

        setMessage(message, data.message, "success");
        showReceipt(data.order);
        loadAnalytics();
    } catch (error) {
        setMessage(message, error.message, "error");
        refreshProducts({ syncOrder: true });
    }
}

function getProductFormPayload() {
    return {
        name: productName.value.trim(),
        price: Number(productPrice.value),
        category: productCategory.value,
        active: productActive.checked
    };
}

async function submitProductForm(event) {
    event.preventDefault();

    const payload = getProductFormPayload();
    const isEditing = Boolean(editingProductId);
    const url = isEditing ? `/api/products/${editingProductId}` : "/api/products";
    const method = isEditing ? "PATCH" : "POST";

    try {
        const data = await requestJson(url, {
            method,
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(payload)
        });

        setMessage(productMessage, data.message, "success");
        resetProductForm();
        await refreshProducts({ syncOrder: true });
        loadAnalytics();
    } catch (error) {
        setMessage(productMessage, error.message, "error");
    }
}

function renderProductTable(productList) {
    productTableBody.innerHTML = "";

    if (productList.length === 0) {
        const row = document.createElement("tr");
        const cell = document.createElement("td");
        cell.colSpan = 5;
        cell.textContent = "No products found.";
        row.appendChild(cell);
        productTableBody.appendChild(row);
        return;
    }

    productList.forEach(product => {
        const row = document.createElement("tr");

        row.appendChild(createTableCell(product.name));
        row.appendChild(createTableCell(product.category));
        row.appendChild(createTableCell(formatCurrency(product.price)));

        const statusCell = document.createElement("td");
        const status = document.createElement("span");
        status.classList.add("status-badge", product.active ? "active" : "inactive");
        status.textContent = product.active ? "Active" : "Inactive";
        statusCell.appendChild(status);
        row.appendChild(statusCell);

        const actionCell = document.createElement("td");
        actionCell.classList.add("table-actions");

        const editButton = document.createElement("button");
        editButton.type = "button";
        editButton.classList.add("table-btn");
        editButton.textContent = "Edit";
        editButton.addEventListener("click", () => startEditingProduct(product));
        actionCell.appendChild(editButton);

        const toggleButton = document.createElement("button");
        toggleButton.type = "button";
        toggleButton.classList.add("table-btn", product.active ? "danger" : "success");
        toggleButton.textContent = product.active ? "Deactivate" : "Activate";
        toggleButton.addEventListener("click", () => toggleProduct(product));
        actionCell.appendChild(toggleButton);

        row.appendChild(actionCell);
        productTableBody.appendChild(row);
    });
}

function createTableCell(text) {
    const cell = document.createElement("td");
    cell.textContent = text;
    return cell;
}

function startEditingProduct(product) {
    editingProductId = product.id;
    productId.value = product.id;
    productName.value = product.name;
    productPrice.value = product.price;
    productCategory.value = product.category;
    productActive.checked = product.active;
    saveProduct.textContent = "Update Product";
    setMessage(productMessage, `Editing ${product.name}.`, "info");
}

function resetProductForm() {
    editingProductId = null;
    productId.value = "";
    productForm.reset();
    productActive.checked = true;
    productCategory.value = PRODUCT_CATEGORIES[0];
    saveProduct.textContent = "Save Product";
}

async function toggleProduct(product) {
    try {
        const data = product.active
            ? await requestJson(`/api/products/${product.id}`, { method: "DELETE" })
            : await requestJson(`/api/products/${product.id}`, {
                method: "PATCH",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({ active: true })
            });

        setMessage(productMessage, data.message, "success");
        await refreshProducts({ syncOrder: true });
        loadAnalytics();
    } catch (error) {
        setMessage(productMessage, error.message, "error");
    }
}

async function loadAnalytics() {
    try {
        const analytics = await requestJson("/api/analytics");
        renderAnalytics(analytics);
    } catch (error) {
        setMessage(productMessage, error.message, "error");
    }
}

function renderAnalytics(analytics) {
    document.getElementById("analyticsTotalOrders").textContent = analytics.totalOrders;
    document.getElementById("analyticsCompletedOrders").textContent = analytics.completedOrders;
    document.getElementById("analyticsActiveOrders").textContent = analytics.activeOrders;
    document.getElementById("analyticsTotalRevenue").textContent = formatCurrency(analytics.totalRevenue);
    document.getElementById("analyticsAverageOrderValue").textContent = formatCurrency(analytics.averageOrderValue);
    document.getElementById("analyticsTopProduct").textContent = analytics.topSellingProduct
        ? analytics.topSellingProduct.name
        : "None";
    document.getElementById("analyticsTodayRevenue").textContent = formatCurrency(analytics.todayRevenue);
    document.getElementById("analyticsTodayCompletedOrders").textContent = analytics.todayCompletedOrders;

    renderRevenueByProduct(analytics.revenueByProduct);
    renderOrdersByStatus(analytics.ordersByStatus);
    renderRevenueByPaymentMethod(analytics.revenueByPaymentMethod);
    renderRecentOrders(analytics.recentOrders);
}

function renderRevenueByProduct(rows) {
    const container = document.getElementById("revenueByProduct");
    container.innerHTML = "";

    if (rows.length === 0) {
        const empty = document.createElement("p");
        empty.classList.add("empty-state");
        empty.textContent = "No completed-order revenue yet.";
        container.appendChild(empty);
        return;
    }

    const maxRevenue = Math.max(...rows.map(row => row.revenue));

    rows.slice(0, 6).forEach(row => {
        const item = document.createElement("div");
        item.classList.add("revenue-row");

        const header = document.createElement("div");

        const name = document.createElement("span");
        name.textContent = row.name;
        header.appendChild(name);

        const revenue = document.createElement("strong");
        revenue.textContent = formatCurrency(row.revenue);
        header.appendChild(revenue);
        item.appendChild(header);

        const track = document.createElement("div");
        track.classList.add("bar-track");

        const bar = document.createElement("div");
        bar.classList.add("bar-fill");
        bar.style.width = `${maxRevenue > 0 ? (row.revenue / maxRevenue) * 100 : 0}%`;
        track.appendChild(bar);
        item.appendChild(track);

        container.appendChild(item);
    });
}

function renderOrdersByStatus(rows) {
    const container = document.getElementById("ordersByStatus");
    container.innerHTML = "";

    rows.forEach(row => {
        const item = document.createElement("div");
        item.classList.add("status-count");

        const badge = document.createElement("span");
        badge.classList.add("order-status", getStatusClassName(row.status));
        badge.textContent = row.status;
        item.appendChild(badge);

        const count = document.createElement("strong");
        count.textContent = row.count;
        item.appendChild(count);

        container.appendChild(item);
    });
}

function renderRevenueByPaymentMethod(rows) {
    const container = document.getElementById("revenueByPaymentMethod");
    container.innerHTML = "";

    if (rows.length === 0) {
        const empty = document.createElement("p");
        empty.classList.add("empty-state");
        empty.textContent = "No completed payments yet.";
        container.appendChild(empty);
        return;
    }

    rows.forEach(row => {
        const item = document.createElement("div");
        item.classList.add("status-count");

        const method = document.createElement("span");
        method.classList.add("payment-pill");
        method.textContent = row.paymentMethod;
        item.appendChild(method);

        const revenue = document.createElement("strong");
        revenue.textContent = formatCurrency(row.revenue);
        item.appendChild(revenue);

        container.appendChild(item);
    });
}

function renderRecentOrders(rows) {
    const table = document.getElementById("recentOrders");
    table.innerHTML = "";

    if (rows.length === 0) {
        const row = document.createElement("tr");
        const cell = document.createElement("td");
        cell.colSpan = 3;
        cell.textContent = "No orders yet.";
        row.appendChild(cell);
        table.appendChild(row);
        return;
    }

    rows.forEach(orderRow => {
        const row = document.createElement("tr");

        row.appendChild(createTableCell(`#${orderRow.id}`));

        const statusCell = document.createElement("td");
        const status = document.createElement("span");
        status.classList.add("order-status", getStatusClassName(orderRow.status));
        status.textContent = orderRow.status;
        statusCell.appendChild(status);
        row.appendChild(statusCell);

        row.appendChild(createTableCell(formatCurrency(orderRow.total)));

        table.appendChild(row);
    });
}

function showReceipt(orderRecord) {
    document.getElementById("receiptOrderId").textContent = `Order #${orderRecord.id}`;
    document.getElementById("receiptCustomer").textContent = orderRecord.customerName;
    document.getElementById("receiptDate").textContent = orderRecord.date;
    document.getElementById("receiptPaymentMethod").textContent = orderRecord.paymentMethod;
    document.getElementById("receiptSubtotal").textContent = formatCurrency(orderRecord.subtotal);
    document.getElementById("receiptTax").textContent = formatCurrency(orderRecord.tax);
    document.getElementById("receiptTotal").textContent = formatCurrency(orderRecord.total);

    receiptItems.innerHTML = "";

    orderRecord.items.forEach(item => {
        const row = document.createElement("div");
        row.classList.add("receipt-item");

        const details = document.createElement("div");

        const name = document.createElement("strong");
        name.textContent = item.name;
        details.appendChild(name);

        const quantity = document.createElement("span");
        quantity.textContent = `${item.quantity} x ${formatCurrency(item.price)}`;
        details.appendChild(quantity);
        row.appendChild(details);

        const total = document.createElement("strong");
        total.textContent = formatCurrency(item.price * item.quantity);
        row.appendChild(total);

        receiptItems.appendChild(row);
    });

    receiptModal.setAttribute("aria-hidden", "false");
}

function closeReceiptAndStartNewOrder() {
    receiptModal.setAttribute("aria-hidden", "true");
    order = [];
    customerName.value = "";
    paymentMethod.value = "Cash";
    renderOrder();
    setMessage(message, "Ready for a new order.", "info");
}

function printReceipt() {
    document.body.classList.add("printing-receipt");
    window.print();
}

function getStatusClassName(status) {
    return `status-${status.toLowerCase().replace(/\s+/g, "-")}`;
}

window.addEventListener("afterprint", () => {
    document.body.classList.remove("printing-receipt");
});

document.getElementById("clearOrder").addEventListener("click", () => {
    order = [];
    setMessage(message, "Order cleared.", "info");
    renderOrder();
});

document.getElementById("submitOrder").addEventListener("click", submitOrder);
productForm.addEventListener("submit", submitProductForm);
productFilter.addEventListener("change", () => refreshProducts());
printReceiptButton.addEventListener("click", printReceipt);
newOrderButton.addEventListener("click", closeReceiptAndStartNewOrder);
cancelEdit.addEventListener("click", () => {
    resetProductForm();
    setMessage(productMessage, "", "");
});

populateCategorySelects();
resetProductForm();
renderOrder();
refreshProducts().catch(error => setMessage(message, error.message, "error"));
loadAnalytics();
setInterval(loadAnalytics, 10000);
