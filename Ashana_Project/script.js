/* =========================================================
   AITU SMART CANTEEN — SCRIPT
   Sections:
   1. Menu data         5. Cart modal
   2. State & helpers   6. Orders + live status tracker
   3. Menu display      7. Crowd simulation
   4. Cart logic        8. Init
   ========================================================= */


/* =========================================================
   1. MENU DATA
   ========================================================= */

let menu = []; // Загружается из SQLite через /api/menu

const weeklyMenu = {
    1: [1, 2, 3, 11, 19, 20],
    2: [9, 13, 14, 15, 12, 28],
    3: [17, 18, 23, 21, 7, 25],
    4: [4, 10, 24, 26, 8, 29],
    5: [2, 14, 27, 16, 12, 30],
    6: [1, 9, 22, 25, 7, 20],
    0: [3, 17, 23, 11, 19, 28]
};

const dayNames = { 0: "Sunday", 1: "Monday", 2: "Tuesday", 3: "Wednesday", 4: "Thursday", 5: "Friday", 6: "Saturday" };


/* =========================================================
   2. STATE & HELPERS
   ========================================================= */

let cart = [];
let currentCategory = "all";
let searchQuery = "";
let favorites = new Set();
let selectedDay = new Date().getDay();
let showWeeklyAll = false;

let activeReviewDishId = null;
let selectedReviewRating = 5;
let reviewPhotoData = "";
const REVIEWS_STORAGE_KEY = "aituFoodReviews";

let sharedReviews = {};
function getAllFoodReviews() { return sharedReviews; }
function getFoodRating(dishId) {
    const reviews = getAllFoodReviews()[dishId] || [];
    const average = reviews.length ? reviews.reduce((sum, review) => sum + Number(review.rating || 0), 0) / reviews.length : 0;
    return { average, count: reviews.length, stars: average ? "★".repeat(Math.round(average)) + "☆".repeat(5 - Math.round(average)) : "☆☆☆☆☆" };
}
function openReviews(dishId) {
    activeReviewDishId = dishId;
    selectedReviewRating = 5;
    reviewPhotoData = "";
    const dish = menu.find(item => item.id === dishId);
    document.getElementById("reviewDishName").textContent = dish ? dish.name + " reviews" : "Food reviews";
    document.getElementById("reviewComment").value = "";
    document.getElementById("reviewPhoto").value = "";
    document.getElementById("reviewPhotoPreview").style.display = "none";
    setReviewRating(5);
    renderFoodReviews(dishId);
    document.getElementById("reviewModal").classList.add("show");
}
function closeReviewModal() { document.getElementById("reviewModal").classList.remove("show"); }
function renderFoodReviews(dishId) {
    const reviews = getAllFoodReviews()[dishId] || [];
    const list = document.getElementById("reviewExistingList");
    if (!reviews.length) { list.innerHTML = '<p style="color:#7b817a;font-size:13px">No reviews yet. Be the first to share your opinion!</p>'; return; }
    list.innerHTML = reviews.slice().reverse().map(review => `
        <article class="review-entry">
            <div class="review-entry-head"><strong>${escapeReviewText(review.author || "AITU Student")}</strong><span class="review-stars">${"★".repeat(review.rating)}${"☆".repeat(5-review.rating)}</span></div>
            <p>${escapeReviewText(review.comment || "")}</p>
            ${review.photo ? `<img class="review-photo" src="${review.photo}" alt="Photo attached to food review">` : ""}
            <small style="display:block;color:#899188;margin-top:8px">${escapeReviewText(review.date || "")}</small>
        </article>`).join("");
}
function escapeReviewText(value) {
    return String(value).replace(/[&<>"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
}
function setReviewRating(rating) {
    selectedReviewRating = rating;
    document.querySelectorAll("#reviewRatingPicker button").forEach((button, index) => button.classList.toggle("selected", index < rating));
}
function previewReviewPhoto(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) { reviewPhotoData = ""; return; }
    if (!file.type.startsWith("image/")) { showToast("Please choose an image file."); event.target.value = ""; return; }
    if (file.size > 5 * 1024 * 1024) { showToast("Please choose a photo smaller than 5 MB."); event.target.value = ""; return; }
    const reader = new FileReader();
    reader.onload = () => {
        const image = new Image();
        image.onload = () => {
            const canvas = document.createElement("canvas");
            const scale = Math.min(1, 900 / Math.max(image.width, image.height));
            canvas.width = Math.round(image.width * scale); canvas.height = Math.round(image.height * scale);
            canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
            reviewPhotoData = canvas.toDataURL("image/jpeg", 0.72);
            const preview = document.getElementById("reviewPhotoPreview");
            preview.src = reviewPhotoData; preview.style.display = "block";
        };
        image.src = reader.result;
    };
    reader.readAsDataURL(file);
}
async function submitFoodReview() {
 if (!activeReviewDishId) return;
 const comment = document.getElementById('reviewComment').value.trim();
 if (!comment) { showToast('Please write a review.'); return; }
 try {
 const res = await apiFetch('/api/reviews', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({dishId:activeReviewDishId,rating:selectedReviewRating,comment,photo:reviewPhotoData})});
 const result = await res.json(); if(!res.ok) throw new Error(result.error);
 await loadReviews(); renderFoodReviews(activeReviewDishId); closeReviewModal(); showToast('Review published.');
 } catch(e) { showToast(e.message || 'Could not save review'); }
}
async function loadReviews() {
 try { const r=await apiFetch('/api/reviews'); if(r.ok) { sharedReviews=await r.json(); displayMenu(); } } catch(e) { console.error(e); }
}


let currentOrder = null;      // { code, time, total, status }
let orderTimer = null;

const ORDER_STATUSES = ["Confirmed", "Preparing", "Ready for pickup"];

const TOKEN_KEY = "aituSessionToken";

function apiFetch(path, options = {}) {
    const token = sessionStorage.getItem(TOKEN_KEY);
    const headers = { ...(options.headers || {}) };
    if (token) headers.Authorization = `Bearer ${token}`;
    return fetch(path, { ...options, headers });
}

function saveSignedInUser(result) {
    sessionStorage.setItem(TOKEN_KEY, result.token);
    sessionStorage.setItem(LOGIN_STORAGE_KEY, "true");
    sessionStorage.setItem(CURRENT_USER_KEY, JSON.stringify(result.user));
}

function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, ch =>
        ({"&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"}[ch]));
}


/** 1600 -> "1 600 ₸" */
function formatPrice(value) {
    return value.toLocaleString() + " ₸";
}

function getCartTotal() {
    return cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
}

/** Small popup message at the bottom of the screen */
let toastTimeout;

function showToast(message) {
    const toast = document.getElementById("toast");

    toast.textContent = message;
    toast.classList.add("show");

    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => toast.classList.remove("show"), 2200);
}


/* =========================================================
   3. MENU DISPLAY
   ========================================================= */

function displayMenu() {

    const grid = document.getElementById("menuGrid");

    const availableIds = showWeeklyAll ? menu.map(item => item.id) : (weeklyMenu[selectedDay] || weeklyMenu[1]);
    const filteredMenu = menu.filter(item => {
        const matchesDay = availableIds.includes(item.id);
        const matchesCategory = currentCategory === "all" || item.category === currentCategory;
        const matchesSearch = item.name.toLowerCase().includes(searchQuery);
        return matchesDay && matchesCategory && matchesSearch && (!window.onlyFavorites || favorites.has(item.id));
    });

    const title = document.getElementById("todayMenuTitle");
    if (title) title.textContent = showWeeklyAll ? "All available dishes" : `${dayNames[selectedDay]} selection`;
    document.querySelectorAll("#dayTabs button").forEach(btn => btn.classList.toggle("active", Number(btn.dataset.day) === selectedDay && !showWeeklyAll));

    grid.innerHTML = "";

    if (filteredMenu.length === 0) {
        grid.innerHTML = `<div class="no-results">😕 Nothing found. Try another search.</div>`;
        return;
    }

    filteredMenu.forEach(item => {

        const isFavorite = favorites.has(item.id);
        const card = document.createElement("div");
        card.className = "food-card";
        card.addEventListener('click', event => { if (!event.target.closest('button')) location.hash = 'dish/'+item.id; });

        card.innerHTML = `
            <button
                class="fav-button ${isFavorite ? "active" : ""}"
                onclick="toggleFavorite(${item.id})">♥</button>

            <div class="food-image">
                <img src="${item.image}" alt="${item.name} — ${item.description}" loading="lazy" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
                <div class="food-fallback" style="display:none;">${item.emoji}</div>
            </div>

            <div class="food-info">
                <h3><a class="dish-link" href="#dish/${item.id}">${escapeHtml(item.name)}</a></h3>
                ${item.vegetarian ? '<span class="dish-badge vegetarian">🌿 Vegetarian</span>' : ''}
                ${item.hit ? '<span class="dish-badge">🔥 HIT · Last 7 days</span>' : ''}
                ${item.discount_percent ? `<span class="dish-badge sale">−${item.discount_percent}%</span>` : ''}
                <p>${item.description}</p>
                <div class="review-summary">
                    <span class="review-stars">${getFoodRating(item.id).stars}</span>
                    <span>${getFoodRating(item.id).average ? getFoodRating(item.id).average.toFixed(1) : "No ratings"} · ${getFoodRating(item.id).count} reviews</span>
                </div>
                <button class="review-link" onclick="openReviews(${item.id})">Read reviews / Write a review</button>

                <div class="food-bottom">
                    <span class="price">${item.discount_percent ? `<del>${formatPrice(item.original_price)}</del> ` : ''}${formatPrice(item.price)}</span>
                    <button class="add-button" onclick="addToCart(${item.id})">+</button>
                </div>
            </div>
        `;

        grid.appendChild(card);
    });
}

function selectDay(day) {
    selectedDay = day;
    showWeeklyAll = false;
    currentCategory = "all";
    document.querySelectorAll(".filter").forEach(btn => btn.classList.remove("active"));
    const allFilter = document.querySelector(".filter");
    if (allFilter) allFilter.classList.add("active");
    displayMenu();
}

function showAllMenu() {
    showWeeklyAll = true;
    displayMenu();
}

function filterMenu(category, button) {

    document.querySelectorAll(".filter")
        .forEach(btn => btn.classList.remove("active"));

    button.classList.add("active");

    currentCategory = category;
    displayMenu();
}

function searchMenu() {
    searchQuery = document.getElementById("searchInput").value.trim().toLowerCase();
    displayMenu();
}

function toggleFavorite(id) {

    const item = menu.find(food => food.id === id);

    if (favorites.has(id)) {
        favorites.delete(id);
        showToast(`💔 ${item.name} removed from favorites`);
    } else {
        favorites.add(id);
        showToast(`❤️ ${item.name} added to favorites`);
    }

    displayMenu();
}

function scrollToMenu() {
    document.getElementById("menu").scrollIntoView({ behavior: "smooth" });
}


/* =========================================================
   4. CART LOGIC
   ========================================================= */

function addToCart(id) {

    const item = menu.find(food => food.id === id);
    const existingItem = cart.find(food => food.id === id);

    if (existingItem) {
        existingItem.quantity++;
    } else {
        cart.push({ ...item, quantity: 1 });
    }

    updateCart();
    showToast(`✅ ${item.name} added to cart`);

    // Little bounce on the cart button
    const button = document.querySelector(".cart-button");
    button.style.transform = "scale(1.1)";
    setTimeout(() => button.style.transform = "scale(1)", 200);
}

/** delta = +1 or -1 */
function changeQuantity(id, delta) {

    const item = cart.find(food => food.id === id);
    if (!item) return;

    item.quantity += delta;

    if (item.quantity <= 0) {
        cart = cart.filter(food => food.id !== id);
    }

    updateCart();
}

function removeFromCart(id) {
    cart = cart.filter(food => food.id !== id);
    updateCart();
}

function updateCart() {

    const count = cart.reduce((sum, item) => sum + item.quantity, 0);
    document.getElementById("cartCount").textContent = count;

    displayCart();
}

function displayCart() {

    const container = document.getElementById("cartItems");
    const footer = document.getElementById("cartFooter");

    if (cart.length === 0) {
        container.innerHTML = `
            <div class="empty-cart">
                <div>🛒</div>
                <p>Your cart is empty.</p>
            </div>
        `;
        footer.style.display = "none";
        return;
    }

    footer.style.display = "block";
    container.innerHTML = "";

    cart.forEach(item => {

        const div = document.createElement("div");
        div.className = "cart-item";

        div.innerHTML = `
            <div class="cart-item-info">
                <span class="cart-emoji" aria-hidden="true">${item.emoji}</span>
                <div>
                    <strong>${item.name}</strong>
                    <small>${formatPrice(item.price)} each</small>

                    <div class="qty">
                        <button onclick="changeQuantity(${item.id}, -1)">−</button>
                        <span>${item.quantity}</span>
                        <button onclick="changeQuantity(${item.id}, 1)">+</button>
                    </div>
                </div>
            </div>

            <div class="cart-item-price">
                <strong>${formatPrice(item.price * item.quantity)}</strong>
                <button class="remove" onclick="removeFromCart(${item.id})">Remove</button>
            </div>
        `;

        container.appendChild(div);
    });

    document.getElementById("cartTotal").textContent = formatPrice(getCartTotal());
}


/* =========================================================
   5. CART MODAL
   ========================================================= */

function openCart() {
    displayCart();
    document.getElementById("cartModal").classList.add("show");
}

function closeCart() {
    document.getElementById("cartModal").classList.remove("show");
}

function closeSuccess() {
    document.getElementById("successModal").classList.remove("show");
    document.getElementById("orders").scrollIntoView({ behavior: "smooth" });
}

// Close modals by clicking the dark background or pressing Escape
document.querySelectorAll(".modal").forEach(modal => {
    modal.addEventListener("click", event => {
        if (event.target === modal) modal.classList.remove("show");
    });
});

document.addEventListener("keydown", event => {
    if (event.key === "Escape") {
        document.querySelectorAll(".modal").forEach(modal => modal.classList.remove("show"));
    }
});


/* =========================================================
   6. ORDERS + LIVE STATUS TRACKER
   ========================================================= */

async function submitDemoOrder() {
    if (!cart.length) { showToast("Your cart is empty."); return; }
    if (currentOrder) { showToast("⚠️ You already have an active order."); return; }
    const pickupTime = document.getElementById("pickupTime").value;
    try {
        const response = await apiFetch('/api/orders', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items: cart.map(i => ({id:i.id, quantity:i.quantity})), pickupTime, pickupDate: document.getElementById("pickupDate").value, paymentMethod: "QR", points: selectedPoints(), expectedTotal: getCartTotal()-selectedPoints() })
        });
        const result = await response.json();
        if (!response.ok || !result.success) { showToast(result.error || 'Cannot place order'); return; }
        document.getElementById("confirmedPayment").textContent = "QR demo payment confirmed — no real charge";
        document.getElementById("pickupCode").textContent = result.code;
        document.getElementById("confirmedTime").textContent = pickupTime;
        currentOrder = {
            id: result.id, code: result.code, time: pickupTime,
            total: result.total, status: result.status, state: 'active',
            date: new Date().toLocaleString(),
            items: cart.map(item => ({id:item.id,name:item.name,quantity:item.quantity,price:item.price}))
        };
        saveCurrentOrder();
        cart = [];
        updateCart();
        renderOrder();
        renderOrderArchive();
        closeCart();
        document.getElementById('successModal').classList.add('show');
    } catch (error) {
        console.error('Order request failed:', error);
        showToast('Server unavailable. Start start.bat first.');
    }
}

/** Every 8 seconds the order moves to the next status */
// function startOrderProgress() {

//     clearInterval(orderTimer);

//     orderTimer = setInterval(() => {

//         if (!currentOrder) return;

//         currentOrder.status++;
//         saveCurrentOrder();
//         renderOrder();
//         renderOrderArchive();

//         if (currentOrder.status === 1) {
//             showToast("👨‍🍳 Your order is being prepared");
//         }

//         if (currentOrder.status >= ORDER_STATUSES.length - 1) {
//             clearInterval(orderTimer);
//             showToast(`🎉 Order #${currentOrder.code} is ready!`);
//             playReadySound();
//         }

//     }, 8000);
// }

function renderOrder() {
    const container = document.getElementById("orderContainer");

    if (!currentOrder) {
        container.className = "empty-order";
        container.innerHTML = `
            <div class="empty-icon">🧾</div>
            <h3>No active order</h3>
            <p>Your current order will appear here.</p>
        `;
        return;
    }

    const { code, time, total, status } = currentOrder;
    
    // Проверяем статус (он может быть числом из старой памяти или строкой из базы)
    let isReady = false;
    let isPreparing = false;
    let statusText = "CONFIRMED";
    let statusClass = "preparing";
    let noteText = `💡 Show your pickup code <strong>${code}</strong> at Pickup Point 1.`;
    let noteStyle = "";

        if (status === 'Ready' || status === 2) {
        isReady = true;
        statusText = "READY FOR PICKUP";
        statusClass = ""; // Убирает желтый цвет, делает зеленым
        noteText = `🎉 Your order is ready! Please take your code <strong>${code}</strong> to Pickup Point 1.`;
        noteStyle = "background: #e5f1df; color: #4d733f; font-weight: bold;";
    } else if (status === 'Preparing' || status === 1) {
        isPreparing = true;
        statusText = "PREPARING";
        statusClass = "preparing";
        noteText = `👨‍🍳 Your order is being prepared. Please wait.`;
    } else if (status === 'Cancelled') {
        statusText = "CANCELLED";
        statusClass = "cancelled";
        noteText = `❌ This order was cancelled.`;
        noteStyle = "background: #f6e9e7; color: #a25348; font-weight: bold;";
    } else {
        // Это сработает для статуса 'Pending' (когда заказ только оформлен)
        statusText = "CONFIRMED";
        statusClass = "preparing";
        noteText = `💡 Show your pickup code <strong>${code}</strong> at Pickup Point 1.`;
        noteStyle = "";
    }

    container.className = "";
    container.innerHTML = `
        <div class="order-card">
            <div class="order-top">
                <div>
                    <small>ORDER</small>
                    <div class="order-code">#${code}</div>
                </div>
                <span class="ready ${statusClass}">
                    ${statusText}
                </span>
            </div>

            <div class="order-details">
                <div>Pickup time <strong>${time}</strong></div>
                <div>Location <strong>Pickup Point 1</strong></div>
                <div>Total <strong>${formatPrice(total)}</strong></div>
            </div>

            <div class="order-note" style="${noteStyle}">
                ${noteText}
            </div>

            <div class="order-actions">
                <!-- НОВАЯ КНОПКА ОБНОВЛЕНИЯ -->
                <button class="primary-button" onclick="refreshStudentOrder()">🔄 Обновить статус</button>
                
                ${isReady ? `<button class="secondary-button" onclick="finishOrder()">Collected ✓</button>` : ''}
                ${['Pending','Preparing','Ready'].includes(status) ? `<button class="secondary-button danger" onclick="cancelOrder()">Cancel order · 5% fee</button>` : ''}
            </div>
        </div>
    `;
}

let cancellingOrder = false;
async function cancelOrder() {
    if (!currentOrder || cancellingOrder) return;
    const fee = Math.floor((currentOrder.total * 5 + 50) / 100);
    if (!confirm(`Cancel this order?\nDemo refund: ${formatPrice(currentOrder.total-fee)}\nRetention: ${formatPrice(fee)} (5%).\nUsed points will be restored. No real money is transferred.`)) return;
    cancellingOrder = true;
    try {
        const response = await apiFetch(`/api/orders/${currentOrder.id}/cancel`, {
            method: 'PUT', headers: {'Content-Type':'application/json'},
            body: JSON.stringify({reason:'Cancelled by student'})
        });
        const result = await response.json();
        if (!response.ok) { showToast(result.error || 'Cancellation failed'); return; }
        currentOrder = null;
        clearSavedCurrentOrder();
        renderOrder();
        await renderOrderArchive();
        await readAccount();
        showToast(`Cancelled. Demo refund: ${formatPrice(result.refund)}; fee: ${formatPrice(result.fee)} (5%).`);
    } catch (e) { showToast('Cannot connect to server.'); }
    finally { cancellingOrder = false; }
}

async function finishOrder() {
    if (!currentOrder || currentOrder.status !== 'Ready') return;
    try {
        const response = await apiFetch(`/api/orders/${currentOrder.id}/complete`, {
            method: 'PUT', headers: {'Content-Type':'application/json'}, body:'{}'
        });
        const result = await response.json();
        if (!response.ok) { showToast(result.error || 'Cannot complete order'); return; }
        currentOrder = null;
        clearSavedCurrentOrder();
        renderOrder();
        await renderOrderArchive();
        showToast('Enjoy your meal! 😋');
    } catch (e) { showToast('Cannot connect to server.'); }
}

/* =========================================================
   USER PROFILE & ORDER HISTORY
   ========================================================= */

const USERS_STORAGE_KEY = "aituUsers";
const CURRENT_USER_KEY = "aituCurrentUser";
const ACTIVE_ORDER_KEY = "aituActiveOrder";

function activeOrderKey() {
    const user = getCurrentUser();
    return user ? ACTIVE_ORDER_KEY + "_" + user.email : null;
}

function getUsers() {
    try { return JSON.parse(localStorage.getItem(USERS_STORAGE_KEY)) || {}; }
    catch (e) { return {}; }
}

function getCurrentUser() {
    try { return JSON.parse(sessionStorage.getItem(CURRENT_USER_KEY)) || null; }
    catch (e) { return null; }
}

function userOrderKey() {
    const user = getCurrentUser();
    return user ? "aituOrders_" + user.email : null;
}

function getOrderArchive() {
    const key = userOrderKey();
    if (!key) return [];
    try { return JSON.parse(localStorage.getItem(key)) || []; }
    catch (e) { return []; }
}

function saveOrderToArchive(order) {
    const key = userOrderKey();
    if (!key || !order) return;
    const history = getOrderArchive().filter(item => item.id !== order.id);
    history.unshift({ ...order });
    localStorage.setItem(key, JSON.stringify(history.slice(0, 50)));
}

function saveCurrentOrder() {
    const key = activeOrderKey();
    if (key && currentOrder) localStorage.setItem(key, JSON.stringify(currentOrder));
}

function clearSavedCurrentOrder() {
    const key = activeOrderKey();
    if (key) localStorage.removeItem(key);
}

function loadCurrentOrder() {
    const key = activeOrderKey();
    if (!key) return null;
    try {
        const saved = JSON.parse(localStorage.getItem(key));
        return saved && saved.state === "active" ? saved : null;
    } catch (e) { return null; }
}

async function renderOrderArchive() {
    const container = document.getElementById("orderArchive");
    const count = document.getElementById("archiveCount");
    if (!container) return;

    const user = getCurrentUser();
    if (!user) {
        container.innerHTML = `<p>Войдите, чтобы увидеть историю заказов.</p>`;
        return;
    }

    try {
        const response = await apiFetch(`/api/my-orders/${encodeURIComponent(user.email)}`);
        if (!response.ok) throw new Error('Cannot load order history');
        const history = await response.json();
        window.orderHistory = history;
        // Синхронизация статуса с базой данных
        // Синхронизируем текущий заказ с базой данных
        if (currentOrder) {
            const dbOrder = history.find(o => o.code === currentOrder.code);
            if (dbOrder) {
                // Если статус изменился на Готов или Отменен, показываем уведомление
                if (currentOrder.status !== dbOrder.status) {
                    if (dbOrder.status === 'Ready') {
                        showToast("🎉 Ваш заказ готов к выдаче!");
                        playReadySound();
                    } else if (dbOrder.status === 'Cancelled') {
                        showToast("❌ Ваш заказ был отменен.");
                    }
                }
                
                // Обновляем статус карточки на экране
                if (dbOrder.status === 'Cancelled' || dbOrder.status === 'Completed') {
                    currentOrder = null;
                    clearSavedCurrentOrder();
                } else {
                    currentOrder.status = dbOrder.status;
                    saveCurrentOrder();
                }
                renderOrder();
            }
        }

        // Only closed orders belong under Past orders; an active order stays above.
        const pastOrders = history.filter(order => ['Completed', 'Cancelled'].includes(order.status));
        if (count) count.textContent = `${pastOrders.length} order${pastOrders.length === 1 ? "" : "s"}`;
        const stat = document.getElementById('profileOrderCount');
        if (stat) stat.textContent = history.length;

        if (!pastOrders.length) {
            container.innerHTML = `<div class="empty-order compact"><div class="empty-icon">🗂️</div><h3>No past orders yet</h3></div>`;
            return;
        }

        container.innerHTML = pastOrders.map(order => {
            const isCancelled = order.status === 'Cancelled';
            
            let dateStr = "Недавно";
            if (order.created_at) {
                const d = new Date(order.created_at.replace(' ', 'T')); 
                if (!isNaN(d.getTime())) {
                    dateStr = d.toLocaleString();
                }
            }
            
                        // Определяем правильный текст статуса
            let statusText = "В обработке";
            let statusClass = "";
            
            if (order.status === 'Cancelled') { statusText = "Отменен"; statusClass = "cancelled"; }
            else if (order.status === 'Pending') { statusText = "Ожидает"; statusClass = "preparing"; }
            else if (order.status === 'Preparing') { statusText = "Готовится"; statusClass = "preparing"; }
            else if (order.status === 'Ready') { statusText = "Готов к выдаче"; }
            else if (order.status === 'Completed') { statusText = "Завершен"; }

            return `<div class="archive-item" style="${isCancelled ? 'border-left: 4px solid red;' : ''}">
                <div class="archive-item-main">
                    <strong>#${escapeHtml(order.code)}</strong>
                    <span>${dateStr}</span>
                    <span>${escapeHtml(order.food_name)} × ${order.quantity}</span>
                    
                    ${isCancelled ? `<span style="color: red; font-weight: bold; margin-top: 5px; display: block;">Причина отмены: ${escapeHtml(order.cancel_reason || 'Не указана')}</span>` : ''}
                </div>
                <div class="archive-item-right">
                    <strong>${formatPrice(order.total_price)}</strong><br>
                    <span class="archive-status ${statusClass}">${statusText}</span>
                    <p>${isCancelled ? `Demo refund: ${formatPrice(order.refund_amount || 0)} · Fee: ${formatPrice(order.fee_amount || 0)}` : `+${order.points_earned || 0} points`}</p>
                    <button class="secondary-button" onclick="repeatOrder(${order.id})">Order again</button>
                </div>
            </div>`;
        }).join("");
    } catch (error) {
        console.error("Ошибка при загрузке истории:", error);
    }
}

function updateProfile() {
    const user = getCurrentUser();
    if (!user) return;
    const fullName = `${user.firstName} ${user.lastName}`;
    document.getElementById("profileName").textContent = fullName;
    document.getElementById("profileEmail").textContent = user.email;
    document.getElementById("profileGroup").textContent = user.group;
    document.getElementById("profileFirstName").textContent = user.firstName;
    document.getElementById("profileLastName").textContent = user.lastName;
    document.getElementById("profileEmailDetail").textContent = user.email;
    document.getElementById("profileGroupDetail").textContent = user.group;
    document.getElementById("profileAvatar").textContent = (user.firstName || "A").charAt(0).toUpperCase();
    // Count is loaded from SQLite in renderOrderArchive().
}

function restoreUserData() {
    currentOrder = loadCurrentOrder();
    if (currentOrder) {
        renderOrder();
        clearInterval(orderTimer);
  //      if (currentOrder.status < ORDER_STATUSES.length - 1) startOrderProgress();
    } else {
        renderOrder();
    }
   // renderOrderArchive();
    updateProfile();
    renderOrderArchive();
    // Restore server state when the page opens in another tab or browser session.
    syncCurrentOrder();
}

async function syncCurrentOrder() {
    const user = getCurrentUser();
    if (!user || !sessionStorage.getItem(TOKEN_KEY)) return;
    try {
        const res = await apiFetch(`/api/my-orders/${encodeURIComponent(user.email)}`);
        if (!res.ok) return;
        const list = await res.json();
        const active = list.find(o => ['Pending','Preparing','Ready'].includes(o.status));
        if (active) {
            currentOrder = {id:active.id, code:active.code, time:active.pickup_time,
                total:active.total_price, status:active.status, state:'active'};
            saveCurrentOrder();
        } else { currentOrder = null; clearSavedCurrentOrder(); }
        renderOrder();
    } catch (e) { console.error('Sync failed:', e); }
}

function logoutUser() {
    clearInterval(orderTimer);
    apiFetch('/api/logout', { method:'POST' }).catch(() => {});
    sessionStorage.removeItem(LOGIN_STORAGE_KEY);
    sessionStorage.removeItem(TOKEN_KEY);
    currentOrder = null;
    // Keep the user's active order saved so it is restored after the next sign-in.
    sessionStorage.removeItem(CURRENT_USER_KEY);
    cart = [];
    updateCart();
    document.getElementById("authScreen").style.display = "flex";
    document.getElementById('admin').style.display = 'none';
    setPersonalOrderHeadings();
    renderOrder();
    document.getElementById('orderArchive').innerHTML = '';
    document.getElementById('archiveCount').textContent = '0 orders';
    showAuthForm("login");
    showRememberedUser();
    window.scrollTo({ top: 0, behavior: "smooth" });
    showToast("You have been logged out.");
}


/* =========================================================
   7. CROWD SIMULATION
   ========================================================= */

function updateCrowd() {

    const people = Math.floor(45 + Math.random() * 65);
    const progress = Math.min((people / 120) * 100, 100);

    const bar = document.getElementById("crowdProgress");
    const dot = document.getElementById("statusDot");
    const crowdText = document.getElementById("crowdText");
    const waitTime = document.getElementById("waitTime");

    document.getElementById("peopleCount").textContent = people;
    bar.style.width = progress + "%";

    let color;

    if (people < 60) {
        crowdText.textContent = "Low crowd";
        waitTime.textContent = "5–10 min";
        color = "#5e8b4d";
    } else if (people < 90) {
        crowdText.textContent = "Medium crowd";
        waitTime.textContent = "10–20 min";
        color = "#c8a332";
    } else {
        crowdText.textContent = "High crowd";
        waitTime.textContent = "20+ min";
        color = "#c0533f";
    }

    bar.style.background = color;
    dot.style.background = color;
}



/* =========================================================
   8. AUTHENTICATION & THEME
   ========================================================= */

const USER_STORAGE_KEY = "aituRegisteredUser";
const LOGIN_STORAGE_KEY = "aituLoggedIn";

async function hashPassword(password) {
    const data = new TextEncoder().encode(password);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(hashBuffer))
        .map(byte => byte.toString(16).padStart(2, "0"))
        .join("");
}

function getRegisteredUser() {
    const users = getUsers();
    const current = getCurrentUser();
    if (current && users[current.email]) return users[current.email];
    try {
        const legacy = JSON.parse(localStorage.getItem(USER_STORAGE_KEY));
        return legacy || null;
    } catch (e) { return null; }
}

function showAuthForm(form) {
    const isLogin = form === "login";
    document.getElementById("loginForm").classList.toggle("active", isLogin);
    document.getElementById("registerForm").classList.toggle("active", !isLogin);
    document.getElementById("loginTab").classList.toggle("active", isLogin);
    document.getElementById("registerTab").classList.toggle("active", !isLogin);
    if (!isLogin) {
        const savedUser = getRegisteredUser();
        if (savedUser) {
            document.getElementById("regEmail").value = savedUser.email || "";
            document.getElementById("regFirstName").value = savedUser.firstName || "";
            document.getElementById("regLastName").value = savedUser.lastName || "";
            document.getElementById("regGroup").value = savedUser.group || "";
        }
    }
}

async function registerUser() {
    const email = document.getElementById('regEmail').value.trim().toLowerCase();
    const firstName = document.getElementById('regFirstName').value.trim();
    const lastName = document.getElementById('regLastName').value.trim();
    const group = document.getElementById('regGroup').value.trim().toUpperCase();
    const password = document.getElementById('regPassword').value;
    const confirm = document.getElementById('regPasswordConfirm').value;
    const error = document.getElementById('registerError');
    const success = document.getElementById('registerSuccess');
    error.textContent = ''; success.textContent = '';
    if (!email.endsWith('@astanait.edu.kz')) { error.textContent='Use your AITU corporate email'; return; }
    if (!firstName || !lastName || !group) { error.textContent='Fill in all fields'; return; }
    if (password.length < 8) { error.textContent='Password must contain at least 8 characters'; return; }
    if (password !== confirm) { error.textContent='Passwords do not match'; return; }
    try {
        const response = await apiFetch('/api/register', {method:'POST',headers:{'Content-Type':'application/json'},
            body:JSON.stringify({email,firstName,lastName,group,password})});
        const result = await response.json();
        if (!response.ok || !result.success) { error.textContent=result.error || 'Cannot register'; return; }
        saveSignedInUser(result);
        success.textContent='Account created successfully!';
        document.getElementById('authScreen').style.display='none';
        restoreUserData();
        showToast(`Welcome, ${firstName}!`);
    } catch (e) { error.textContent='Server unavailable. Run start.bat first.'; }
}

async function login() {
    const email = document.getElementById('loginInput').value.trim().toLowerCase();
    const password = document.getElementById('passwordInput').value;
    const error = document.getElementById('authError');
    error.textContent='';
    try {
        const response = await apiFetch('/api/login', {method:'POST',headers:{'Content-Type':'application/json'},
            body:JSON.stringify({email,password})});
        const result = await response.json();
        if (!response.ok || !result.success) { error.textContent=result.error || 'Sign in failed'; return; }
        saveSignedInUser(result);
        document.getElementById('authScreen').style.display='none';
        restoreUserData();
        showToast(`Welcome back, ${result.user.firstName}!`);
    } catch (e) { error.textContent='Server unavailable. Run start.bat first.'; }
}

function showRememberedUser() {
    const remembered = document.getElementById("rememberedUser");
    const users = getUsers();
    const emails = Object.keys(users);
    if (remembered && emails.length) {
        const current = getCurrentUser();
        const user = current && users[current.email] ? users[current.email] : users[emails[0]];
        remembered.textContent = `Remembered account: ${user.firstName} ${user.lastName} · ${user.group}`;
        document.getElementById("loginInput").value = user.email || "";
    } else if (remembered) {
        remembered.textContent = "";
    }
}

function applySavedTheme() {
    const savedTheme = localStorage.getItem("aituTheme");
    if (savedTheme === "dark") {
        document.body.classList.add("dark-theme");
        document.getElementById("themeToggle").textContent = "☀️";
    }
}

function toggleTheme() {
    document.body.classList.toggle("dark-theme");
    const isDark = document.body.classList.contains("dark-theme");
    localStorage.setItem("aituTheme", isDark ? "dark" : "light");
    document.getElementById("themeToggle").textContent = isDark ? "☀️" : "🌙";
}

async function checkAuth() {
    const token = sessionStorage.getItem(TOKEN_KEY);
    if (token) {
        try {
            const response = await apiFetch('/api/me');
            if (response.ok) {
                const result = await response.json();
                sessionStorage.setItem(CURRENT_USER_KEY, JSON.stringify(result.user));
                sessionStorage.setItem(LOGIN_STORAGE_KEY, 'true');
                document.getElementById('authScreen').style.display='none';
                restoreUserData();
            } else {
                sessionStorage.removeItem(TOKEN_KEY);
                sessionStorage.removeItem(LOGIN_STORAGE_KEY);
                sessionStorage.removeItem(CURRENT_USER_KEY);
                document.getElementById('authScreen').style.display='flex';
            }
        } catch (e) { document.getElementById('authScreen').style.display='flex'; }
    } else {
        sessionStorage.removeItem(LOGIN_STORAGE_KEY);
        document.getElementById('authScreen').style.display='flex';
    }
    showRememberedUser();
    applySavedTheme();
}

/* =========================================================
   PICKUP TIME OPTIONS
   ========================================================= */
function populatePickupTimes() {
    const select = document.getElementById("pickupTime");
    if (!select) return;

    select.innerHTML = "";
    const startMinutes = 9 * 60;   // 09:00
    const endMinutes = 18 * 60;    // last slot starts at 18:00
    const slotLength = 10;

    for (let minutes = startMinutes; minutes <= endMinutes; minutes += slotLength) {
        const nextMinutes = minutes + slotLength;
        const formatTime = value => {
            const hours = Math.floor(value / 60).toString().padStart(2, "0");
            const mins = (value % 60).toString().padStart(2, "0");
            return `${hours}:${mins}`;
        };
        const option = document.createElement("option");
        option.value = `${formatTime(minutes)} – ${formatTime(nextMinutes)}`;
        option.textContent = option.value;
        if (minutes === 12 * 60) option.selected = true;
        select.appendChild(option);
    }
}


/* =========================================================
   SOUND NOTIFICATION (off by default, never autoplays)
   Plays assets/sounds/order-ready.mp3 only when the user
   switched sound on AND the order becomes "Ready for pickup".
   Every sound also has a visual twin: toast + status badge.
   ========================================================= */
const SOUND_KEY = "aituSoundOn";
const readySound = new Audio("assets/sounds/order-ready.wav");
readySound.preload = "none";

function isSoundOn() {
    try { return localStorage.getItem(SOUND_KEY) === "1"; } catch (e) { return false; }
}

function updateSoundButton() {
    const button = document.getElementById("soundToggle");
    if (!button) return;
    const on = isSoundOn();
    button.innerHTML = `<span aria-hidden="true">${on ? "🔔" : "🔕"}</span><span class="sound-label"> Sound: ${on ? "on" : "off"}</span>`;
    button.setAttribute("aria-pressed", on ? "true" : "false");
}

function toggleSound() {
    const on = !isSoundOn();
    try { localStorage.setItem(SOUND_KEY, on ? "1" : "0"); } catch (e) {}
    updateSoundButton();
    showToast(on ? "🔔 Sound on: you will hear a chime when your order is ready" : "🔕 Sound off");
    if (!on) { readySound.pause(); readySound.currentTime=0; }
    if (on) playReadySound(true);   // short preview, triggered by the user's click
}

function playReadySound(force) {
    if (!force && !isSoundOn()) return;
    readySound.currentTime = 0;
    readySound.play().catch(() => {});   // blocked playback is harmless: the toast still shows
}

/* =========================================================
   8. INIT
   ========================================================= */

populatePickupTimes();
checkAuth();
updateSoundButton();
async function loadMenuFromDB() {
    try {
        const response = await apiFetch('/api/menu');
        if (!response.ok) throw new Error('Menu unavailable');
        menu = await response.json(); 
        displayMenu(); // Вызываем отрисовку только ПОСЛЕ получения данных
    } catch (error) {
        console.error("Ошибка при загрузке меню:", error);
    }
}

// Запускаем загрузку при старте
loadMenuFromDB();
updateCart();
// Profile and order history load after successful authentication.

// Update crowd status every 15 seconds
setInterval(updateCrowd, 15000);
// ==========================================
// ЛОГИКА АДМИН-ПАНЕЛИ
// ==========================================

// Показываем панель при входе, если это админ
const originalRestoreUserData = restoreUserData;
restoreUserData = function() {
    setPersonalOrderHeadings();
    originalRestoreUserData();
    const user = getCurrentUser();
    if (user && user.role === 'admin') {
        document.getElementById("admin").style.display = "block";
        loadAdminOrders();
        loadAdminUsers();
    } else {
        document.getElementById("admin").style.display = "none";
        setPersonalOrderHeadings();
        renderOrder();
    }
}

function setPersonalOrderHeadings() {
    const currentTag = document.querySelector('#orders > .section-heading .tag');
    const pastTag = document.querySelector('#orders .archive-heading .tag');
    if (currentTag) currentTag.textContent = 'MY ORDER';
    if (pastTag) pastTag.textContent = 'ORDER HISTORY';
    document.getElementById('orderContainer').className = 'empty-order';
}

function filterAdminOrders(orders, period, now = new Date()) {
    if (period === 'all') return orders;
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    if (period === 'week') start.setDate(start.getDate() - 6);
    if (period === 'month') start.setDate(start.getDate() - 29);
    return orders.filter(order => {
        // SQLite CURRENT_TIMESTAMP is UTC; display/filter in the browser's timezone.
        let value = String(order.created_at || '').replace(' ', 'T');
        if (!/(Z|[+-]\d{2}:?\d{2})$/i.test(value)) value += 'Z';
        const date = new Date(value);
        return date >= start && date <= now;
    });
}

async function loadAdminOrders() {
    loadAnalysis();
    const container = document.getElementById("adminOrdersList");
    if (!container) return;
    try {
        const res = await apiFetch('/api/admin/orders');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const allOrders = await res.json();
        const period = document.getElementById('adminOrderPeriod')?.value || 'all';
        const orders = filterAdminOrders(allOrders, period);
        if (!orders.length) {
            container.innerHTML = '<div class="empty-order compact"><h3>За выбранный период заказов нет</h3><p>Заказы студентов появятся здесь автоматически.</p></div>';
            return;
        }
        container.innerHTML = orders.map(o => `
            <div style="background:white; padding:15px; border-radius:10px; margin-bottom:15px; border-left:5px solid ${o.status === 'Cancelled' ? 'red' : (o.status === 'Pending' ? 'orange' : 'green')}">
                <div style="display:flex; justify-content:space-between;">
                    <strong>Заказ #${escapeHtml(o.code)} (${escapeHtml(o.first_name || 'Гость')})</strong>
                    <span>Статус: <b>${escapeHtml(o.status)}</b></span>
                </div>
                <p style="margin:10px 0; font-size:14px;">Состав: ${escapeHtml(o.items || 'Нет данных')}</p>
                <p style="margin:0; font-size:13px; color:#777;">Время: ${escapeHtml(o.pickup_time)} | Сумма: ${o.total_price} тг</p>
                ${o.cancel_reason ? `<p style="color:red; font-size:12px;">Причина отмены: ${escapeHtml(o.cancel_reason)}</p>` : ''}
                <div style="margin-top:15px; display:flex; gap:10px;">
                    ${o.status === 'Pending' ? `<button class="primary-button" onclick="updateOrderStatus(${o.id}, 'Preparing')">Принять в работу</button>` : ''}
                    ${o.status === 'Ready' ? `<button class="primary-button" onclick="updateOrderStatus(${o.id}, 'Completed')">Выдан клиенту</button>` : ''}
                    ${o.status === 'Preparing' ? `<button class="primary-button" style="background:#2f7d4b;" onclick="updateOrderStatus(${o.id}, 'Ready')">Готов к выдаче</button>` : ''}
                    ${o.status !== 'Cancelled' && o.status !== 'Completed' ? `<button class="secondary-button danger" onclick="cancelAdminOrder(${o.id})">Отменить</button>` : ''}
                </div>
            </div>
        `).join('');
    } catch (error) {
        console.error('Failed to refresh admin orders:', error);
        container.innerHTML = '<p style="color:#b44">Не удалось загрузить заказы. Проверь, что сервер запущен, и войди в аккаунт администратора.</p>';
    }
}

async function updateOrderStatus(id, newStatus) {
    const response = await apiFetch(`/api/admin/orders/${id}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus })
    });
    if (!response.ok) { showToast('Could not update order'); return; }
    loadAdminOrders();
}

async function cancelAdminOrder(id) {
    const reason = prompt("Укажите причину отмены (например: Ингредиенты закончились, Недостаточно средств):");
    if (reason === null) return; // Если нажали "Отмена"
    
    const response = await apiFetch(`/api/admin/orders/${id}/cancel`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason })
    });
    if (!response.ok) { showToast('Could not cancel order'); return; }
    loadAdminOrders();
}

async function loadAdminUsers() {
    const res = await apiFetch('/api/admin/users');
    if (!res.ok) throw new Error('Admin access required');
    const users = await res.json();
    const container = document.getElementById("adminUsersList");
    
    container.innerHTML = `
        <table style="width:100%; text-align:left; border-collapse: collapse;">
            <tr style="border-bottom: 1px solid #ddd;">
                <th>ID</th><th>Email</th><th>Имя</th><th>Роль</th>
            </tr>
            ${users.map(u => `
                <tr style="border-bottom: 1px solid #eee;">
                    <td style="padding: 10px 0;">${u.id}</td>
                    <td>${escapeHtml(u.email)}</td>
                    <td>${escapeHtml(u.first_name)} ${escapeHtml(u.last_name)}</td>
                    <td><b>${escapeHtml(u.role)}</b></td>
                </tr>
            `).join('')}
        </table>
    `;
}
// Admin panel is available only for accounts with role 'admin'.

// Функция для обновления ВСЕХ данных в админке сразу
function refreshAdminData() {
    renderOrderArchive();
    syncCurrentOrder();
    loadAdminOrders(); // Обновляем список заказов
    loadAdminUsers();  // Обновляем список пользователей
} // Ждем 1 секунду, чтобы всё остальное загрузилось
// Функция для проверки статуса заказа студентом (по кнопке)
async function refreshStudentOrder() {
    const user = getCurrentUser();
    if (!user || !currentOrder) return;

    showToast("⏳ Проверяем статус...");

    try {
        // Запрашиваем свежие данные из базы
        const response = await apiFetch(`/api/my-orders/${encodeURIComponent(user.email)}`);
        if (!response.ok) throw new Error('Cannot read order status');
        const history = await response.json();

        // Ищем нашу текущую карточку в базе
        const dbOrder = history.find(o => o.code === currentOrder.code);

        if (dbOrder) {
            // Обновляем статус
            if (['Cancelled','Completed'].includes(dbOrder.status)) {
                currentOrder = null;
                clearSavedCurrentOrder();
            } else {
                currentOrder.status = dbOrder.status;
                saveCurrentOrder();
            }

            if (dbOrder.status === 'Ready') {
                showToast("🎉 Ваш заказ готов к выдаче!");
                playReadySound();
            } else if (dbOrder.status === 'Preparing') {
                showToast("👨‍🍳 Ваш заказ готовится.");
            } else if (dbOrder.status === 'Cancelled') {
                showToast("❌ Ваш заказ был отменен.");
            } else {
                showToast("Статус заказа: Ожидает обработки.");
            }
            
            // Перерисовываем карточку и историю
            renderOrder(); 
            renderOrderArchive(); 
        } else {
            showToast("Заказ не найден в базе.");
        }
    } catch (error) {
        console.error("Ошибка:", error);
        showToast("Ошибка соединения с сервером.");
    }
}

// Regularly update admin orders created from other users, tabs or browsers.
// Only poll while the admin page is open; the API validates the admin session.
setInterval(() => {
    const user = getCurrentUser();
    if (!user || document.hidden || !sessionStorage.getItem(TOKEN_KEY)) return;
    if (user.role === 'admin') {
        loadAdminOrders();
        loadAdminUsers().catch(console.error);
    }
    // Personal orders are refreshed for every role, including administrators.
    renderOrderArchive();
    if (!currentOrder) syncCurrentOrder();
}, 5000);

// Refresh immediately when switching back to an already open admin tab.
document.addEventListener('visibilitychange', () => {
    if (document.hidden || !sessionStorage.getItem(TOKEN_KEY)) return;
    if (getCurrentUser()?.role === 'admin') loadAdminOrders();
    if (getCurrentUser()) { renderOrderArchive(); syncCurrentOrder(); }
});

async function loadAnalysis() {
    const panel = document.getElementById('analysisPanel');
    try {
        const response = await apiFetch('/api/admin/analytics');
        if (!response.ok) throw new Error('Analysis unavailable');
        const d = await response.json();
        const top = d.popular[0];
        const peak = [...d.hourly].sort((a,b)=>b.orders_count-a.orders_count)[0];
        const total = Object.values(d.counts).reduce((a,b)=>a+b,0);
        panel.innerHTML = `<h2>Order statistics</h2>
        
        <div style="display:flex;gap:30px;margin:20px 0;flex-wrap:wrap">
        <div><strong style="font-size:26px">${total}</strong><br>Total orders</div>
        <div><strong style="font-size:26px">${d.counts.Completed || 0}</strong><br>Completed</div>
        <div><strong style="font-size:26px">${d.counts.Cancelled || 0}</strong><br>Cancelled</div>
        <div><strong style="font-size:26px">${peak ? escapeHtml(peak.pickup_hour)+':00' : '-'}</strong><br>Peak pickup hour</div></div>
        <h3>Orders by pickup hour</h3>
        ${d.hourly.map(r=>`<div style="display:flex;align-items:center;gap:12px;margin:9px 0"><span style="width:50px">${escapeHtml(r.pickup_hour)}:00</span><div style="background:#e87827;height:22px;width:${r.orders_count / peak.orders_count * 65}%"></div><b>${r.orders_count}</b></div>`).join('')}
        <p style="margin-top:18px"><b>Most ordered item:</b> ${top ? escapeHtml(top.name)+' ('+top.portions+' portions)' : 'No completed orders'}</p>
        <p><b>Completed order value:</b> ${d.daily.reduce((a,r)=>a+r.completed_value_kzt,0).toLocaleString('en-US')} KZT</p>
        `;
    } catch(e) { panel.textContent = 'Could not load analysis. Sign in as administrator and refresh.'; }
}

loadReviews();
