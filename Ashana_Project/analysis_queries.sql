-- Q1
SELECT substr(pickup_time, 1, 2) AS pickup_hour,
       COUNT(*) AS orders_count
FROM orders
WHERE status <> 'Cancelled'
GROUP BY substr(pickup_time, 1, 2)
ORDER BY pickup_hour;

-- Q2
SELECT m.name, SUM(oi.quantity) AS portions
FROM order_items AS oi
JOIN orders AS o ON o.id = oi.order_id
JOIN menu AS m ON m.id = oi.menu_item_id
WHERE o.status = 'Completed'
GROUP BY m.id, m.name
ORDER BY portions DESC, m.name
LIMIT 10;

-- Q3
SELECT date(created_at) AS order_date,
       SUM(total_price) AS completed_value_kzt,
       COUNT(*) AS completed_orders
FROM orders
WHERE status = 'Completed'
GROUP BY date(created_at)
ORDER BY order_date;