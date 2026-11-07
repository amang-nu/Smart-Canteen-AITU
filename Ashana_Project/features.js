/* Account features use the server database; checkout remains a payment demo. */
let account = {points:0, favorites:[], notifications:[], queue:null};
let busyPayment = false;
window.onlyFavorites = false;

function astanaDate() { return new Date(Date.now()+5*3600000).toISOString().slice(0,10); }
function nextDate(date) { return new Date(Date.parse(date+'T00:00:00Z')+86400000).toISOString().slice(0,10); }
populatePickupTimes = function() {
    const date = document.getElementById('pickupDate');
    const today = astanaDate();
    date.min=today; date.max=nextDate(today);
    if (!date.value || date.value<today) date.value=today;
    const select=document.getElementById('pickupTime'); const previous=select.value;
    select.innerHTML='';
    for(let minutes=540;minutes<=1080;minutes+=10){
        const fmt=n=>String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0');
        const start=fmt(minutes);
        if(Date.parse(date.value+'T'+start+':00+05:00')<Date.now()+600000) continue;
        const value=start+' – '+fmt(minutes+10);
        select.add(new Option(value,value));
    }
    if([...select.options].some(o=>o.value===previous)) select.value=previous;
    if(!select.options.length){ const option=new Option('No slots left — choose tomorrow','');select.add(option); }
};
populatePickupTimes();

async function readAccount(){
    const user=getCurrentUser();
    if(!user){account={points:0,favorites:[],notifications:[],queue:null}; favorites=new Set(); renderAccount(); return;}
    try{
        const res=await apiFetch('/api/account'); if(!res.ok)return;
        const data=await res.json(); if(getCurrentUser()?.id!==user.id)return;
        account=data; favorites=new Set(data.favorites);
        renderAccount(); displayMenu();
    }catch(e){console.error(e);}
}
function renderAccount(){
    const panel=document.getElementById('loyaltyPanel');
    panel.innerHTML=getCurrentUser()?`<h3>✨ ${account.points} points</h3><p>Earn 5% when you collect an order. 1 point = 1 ₸. Use points for up to 30% of your next order.</p>`:'';
    const notes=account.notifications;
    document.getElementById('notificationPanel').innerHTML=getCurrentUser()?`<h3>Notifications ${notes.filter(n=>!n.seen).length?'· '+notes.filter(n=>!n.seen).length+' new':''}</h3>${notes.length?'<button class="secondary-button" onclick="markNotificationsRead()">Mark as read</button>':'<p>No notifications yet.</p>'}<div class="notifications">${notes.map(n=>`<p class="notice ${n.seen?'':'unread'}">${escapeHtml(n.message)}</p>`).join('')}</div>`:'';
    let q=document.getElementById('queuePanel');
    if(!q){q=document.createElement('div');q.id='queuePanel';document.getElementById('orderContainer').after(q);}
    const order=account.queue;
    q.innerHTML=order?`<div class="extras-panel"><h3>${escapeHtml(order.code)} · ${order.ahead} orders ahead</h3><p>${order.status==='Ready'?'Ready — collect your order!':`Estimated wait: about ${order.minutes} min`}</p><small>Estimate: 10 min per order, scheduled pickups first. Actual preparation may differ.</small><p>Collect before ${new Date(order.deadline*1000).toLocaleString('en-GB',{timeZone:'Asia/Almaty'})} (Astana)</p></div>`:'';
    updateCheckout();
}
async function markNotificationsRead(){await apiFetch('/api/notifications/read',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});await readAccount();}
toggleFavorite=async function(id){
    if(!getCurrentUser()){showToast('Sign in to save favorites');return;}
    try{
        const res=await apiFetch('/api/favorites',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({dishId:id,favorite:!favorites.has(id)})});
        if(!res.ok)throw new Error('Could not save favorite');
        await readAccount(); renderDishPage();
    }catch(e){showToast(e.message);}
};
function showFavorites(){window.onlyFavorites=!window.onlyFavorites;showWeeklyAll=true;currentCategory='all';document.getElementById('favoriteFilter').textContent=window.onlyFavorites?'♥ Favorites only · Show all':'♥ Favorites';displayMenu();}
function renderDishPage(){
    const match=location.hash.match(/^#dish\/(\d+)$/); const page=document.getElementById('dishPage');
    page.hidden=!match; document.querySelector('main').hidden=!!match;
    if(!match)return;
    const dish=menu.find(d=>d.id===Number(match[1]));
    if(!dish){page.innerHTML='<a href="#menu">← Back to menu</a><h2>Dish unavailable</h2>';return;}
    page.innerHTML=`<a class="back-link" href="#menu">← Back to menu</a><div class="dish-layout"><div class="dish-photo"><img src="${escapeHtml(dish.image)}" alt="${escapeHtml(dish.name)}" onerror="this.style.display='none';this.nextElementSibling.hidden=false"><span hidden>${dish.emoji}</span></div><div><p class="tag">${escapeHtml(dish.category)}</p><h1>${escapeHtml(dish.name)}</h1>${dish.hit?'<span class="dish-badge">🔥 HIT · Last 7 days</span>':''}${dish.vegetarian ? '<span class="dish-badge vegetarian">🌿 Vegetarian · May include dairy / eggs</span>' : ''}<p class="dish-description">${escapeHtml(dish.description)}</p><div class="ingredients-panel"><h3>Ingredients</h3><p>${escapeHtml(dish.ingredients || 'Ask the canteen for ingredients.')}</p><small>Sample recipe for this menu prototype. Confirm the actual ingredients and dietary suitability with the canteen.</small></div><h2>${dish.discount_percent?`<del>${formatPrice(dish.original_price)}</del> `:''}${formatPrice(dish.price)} ${dish.discount_percent?`<span class="dish-badge">−${dish.discount_percent}%</span>`:''}</h2><p>${getFoodRating(dish.id).stars} · ${getFoodRating(dish.id).count} reviews</p><div class="dish-actions"><button class="primary-button" onclick="addToCart(${dish.id})">Add to cart</button><button class="secondary-button" onclick="toggleFavorite(${dish.id})">${favorites.has(dish.id)?'♥ Saved':'♡ Save'}</button><button class="secondary-button" onclick="openReviews(${dish.id})">Reviews</button></div></div></div>`;

}
addEventListener('hashchange',()=>{renderDishPage();window.scrollTo(0,0);});
const previousLoadMenu=loadMenuFromDB;
loadMenuFromDB=async function(){await previousLoadMenu();renderDiscountChoices();renderDishPage();};
function renderDiscountChoices(){
    const select=document.getElementById('discountDish');const previous=select.value;
    select.innerHTML=menu.map(d=>`<option value="${d.id}">${escapeHtml(d.name)} · ${d.discount_percent||0}%</option>`).join('');
    if(previous)select.value=previous;
}
document.getElementById('discountDish').addEventListener('change',e=>{document.getElementById('discountPercent').value=menu.find(d=>d.id===Number(e.target.value))?.discount_percent||0;});
async function saveDiscount(){
    const feedback=document.getElementById('discountFeedback');
    try{
        const res=await apiFetch('/api/admin/discount',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({dishId:Number(document.getElementById('discountDish').value),percent:Number(document.getElementById('discountPercent').value)})});
        const data=await res.json();if(!res.ok)throw new Error(data.error);
        feedback.textContent='Discount saved'; await loadMenuFromDB();repriceCart();
    }catch(e){feedback.textContent=e.message;}
}
function repriceCart(){cart=cart.map(item=>({...item,price:menu.find(m=>m.id===item.id)?.price??item.price}));updateCart();updateCheckout();}
function selectedPoints(){return document.getElementById('usePoints').checked?Math.min(account.points,Math.floor(getCartTotal()*.30)):0;}
function updateCheckout(){
    const total=getCartTotal(), points=selectedPoints();
    document.getElementById('pointsSummary').textContent=`Available: ${account.points} points · Use: ${points} · To pay: ${formatPrice(total-points)}`;
    document.getElementById('cartTotal').textContent=formatPrice(total-points);
}
const oldDisplayCart=displayCart;
displayCart=function(){oldDisplayCart();updateCheckout();};
const oldOpenCart=openCart;
openCart=async function(){await readAccount();await loadMenuFromDB();repriceCart();populatePickupTimes();oldOpenCart();};
function placeOrder(){
    if(!cart.length){showToast('Your cart is empty');return;}
    if(!document.getElementById('pickupTime').value){showToast('Choose a future pickup time');return;}
    if(!getCurrentUser()){showToast('Please sign in');return;}
    if(currentOrder){showToast('You already have an active order');return;}
    document.getElementById('qrTotal').textContent=formatPrice(getCartTotal()-selectedPoints());
    document.getElementById('qrFeedback').textContent='';
    document.getElementById('qrModal').classList.add('show');
}
async function confirmQR(){
    if(busyPayment)return;busyPayment=true;document.getElementById('qrContinue').disabled=true;
    try{await submitDemoOrder();
        if(!cart.length){document.getElementById('qrModal').classList.remove('show');await readAccount();}
        else document.getElementById('qrFeedback').textContent='Order not placed. Close this window to check your cart, points and pickup time.';
    }finally{busyPayment=false;document.getElementById('qrContinue').disabled=false;}
}
// Decorative QR-like placeholder; intentionally contains no banking payload.
(function(){let cells='';for(let y=0;y<25;y++)for(let x=0;x<25;x++){
    const corner=(x<7&&y<7)||(x>=18&&y<7)||(x<7&&y>=18);
    let ink;if(corner){const a=x>=18?x-18:x,b=y>=18?y-18:y;ink=a===0||a===6||b===0||b===6||(a>=2&&a<=4&&b>=2&&b<=4);}else ink=(x*13+y*7+x*y)%5<2;
    if(ink)cells+=`<rect x="${x+2}" y="${y+2}" width="1" height="1"/>`;
}document.getElementById('demoQR').innerHTML=`<svg viewBox="0 0 29 29" role="img" aria-label="Demo QR, non-working"><rect width="29" height="29" fill="white"/><g fill="#1e2924">${cells}</g><rect x="8" y="12" width="13" height="5" fill="white"/><text x="14.5" y="15.5" text-anchor="middle" font-size="3" fill="#b54b17">DEMO</text></svg>`;})();
function repeatOrder(id){
    const order=window.orderHistory?.find(o=>o.id===id);if(!order)return;
    if(currentOrder){showToast('Collect your active order first');return;}
    cart=order.orderItems.map(i=>{const d=menu.find(m=>m.id===i.menu_item_id);return d?{...d,quantity:i.quantity}:null;}).filter(Boolean);
    updateCart();openCart();showToast('Added to cart at current prices. Confirm to order.');
}
// Derive statistics from exactly the same filtered rows as order history.
loadAnalysis=async function(){
    const panel=document.getElementById('analysisPanel');
    try{
        const period=document.getElementById('adminOrderPeriod').value;
        const res=await apiFetch('/api/admin/orders');if(!res.ok)throw new Error();
        const rows=filterAdminOrders(await res.json(),period);
        if(document.getElementById('adminOrderPeriod').value!==period)return;
        const done=rows.filter(o=>o.status==='Completed'),cancelled=rows.filter(o=>o.status==='Cancelled');
        const popular={},hours={};
        for(const o of rows){if(o.status!=='Cancelled')hours[o.pickup_time.slice(0,2)]=(hours[o.pickup_time.slice(0,2)]||0)+1;}
        for(const o of done)for(const i of o.orderItems)popular[i.food_name]=(popular[i.food_name]||0)+i.quantity;
        const top=Object.entries(popular).sort((a,b)=>b[1]-a[1]).slice(0,5);
        const max=Math.max(1,...Object.values(hours));
        panel.innerHTML=`<h2>Order statistics · ${escapeHtml(document.getElementById('adminOrderPeriod').selectedOptions[0].text)}</h2><div class="stats-grid"><div><b>${rows.length}</b>Total orders</div><div><b>${done.length}</b>Completed</div><div><b>${cancelled.length}</b>Cancelled</div><div><b>${formatPrice(done.reduce((s,o)=>s+o.total_price,0))}</b>Completed order value</div></div><h3>Orders by pickup hour</h3>${Object.entries(hours).sort().map(([h,n])=>`<div class="stat-bar"><span>${h}:00</span><i style="width:${n/max*60}%"></i><b>${n}</b></div>`).join('')||'<p>No orders in this period</p>'}<h3>Popular dishes · Completed orders</h3>${top.map(([name,n])=>`<p>${escapeHtml(name)} · ${n} portions</p>`).join('')||'<p>No completed orders</p>'}`;
    }catch(e){panel.textContent='Statistics unavailable. Check your connection.';}
};
const oldRestore=restoreUserData;
restoreUserData=function(){oldRestore();readAccount();loadMenuFromDB();};
const oldLogout=logoutUser;
logoutUser=function(){oldLogout();readAccount();};
setInterval(()=>{if(!document.hidden){readAccount();}},5000);
setInterval(()=>{if(!document.hidden && !document.getElementById('qrModal').classList.contains('show')){loadMenuFromDB();}},30000);
readAccount();loadMenuFromDB();
