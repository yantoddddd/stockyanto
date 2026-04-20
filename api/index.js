const express = require('express');
const cors = require('cors');
const crypto = require('crypto');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const ADMIN_KEY = 'rahasia123';
const QRISPY_TOKEN = 'cki_IBpAYezwDHbfrMuENZMFvFw5mI94M11dAT146N0Ar4HrOWKi';
const QRISPY_API_URL = 'https://api.qrispy.id';

// Telegram Config
const TELEGRAM_BOT_TOKEN = '8622926718:AAFgjPx774euFGn3NFdekbMfF9NyJgBNUWs';
const TELEGRAM_CHAT_ID = '-5260518165';

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = process.env.GITHUB_REPO || 'yantoddddd/stockyanto';
const GITHUB_PATH = 'database.json';

async function getDB() {
  try {
    const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/${GITHUB_PATH}`, {
      headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json' }
    });
    if (!res.ok) return { products: [], orders: [], sha: null };
    const data = await res.json();
    const content = Buffer.from(data.content, 'base64').toString('utf8');
    return { ...JSON.parse(content), sha: data.sha };
  } catch (err) {
    return { products: [], orders: [], sha: null };
  }
}

async function setDB(products, orders, oldSha) {
  const content = { products, orders, updatedAt: new Date().toISOString() };
  const updatedContent = Buffer.from(JSON.stringify(content, null, 2)).toString('base64');
  const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/${GITHUB_PATH}`, {
    method: 'PUT',
    headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'Update db', content: updatedContent, sha: oldSha })
  });
  if (!res.ok) throw new Error('GitHub save failed');
  const data = await res.json();
  return data.content.sha;
}

async function sendTelegramNotification(order, source = 'polling') {
  try {
    const message = `
✅ *PEMBAYARAN BERHASIL!* (via ${source})

📦 *Produk:* ${order.productName}
👤 *Pembeli:* ${order.customerName}
💰 *Total:* Rp ${order.totalAmount.toLocaleString()}
🆔 *Order ID:* ${order.orderCode}
📅 *Waktu:* ${new Date().toLocaleString('id-ID')}

🔑 *Kode Item:* 
${order.productCode}
    `;
    
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: message,
        parse_mode: 'Markdown'
      })
    });
    console.log(`📱 Telegram notifikasi terkirim via ${source}`);
  } catch (err) {
    console.error('Telegram error:', err);
  }
}

// ========== CEK STATUS KE QRISPY LANGSUNG (POLLING BACKUP) ==========
app.get('/api/check-payment/:orderId', async (req, res) => {
  const db = await getDB();
  const order = db.orders.find(o => o.id == req.params.orderId || o.orderCode == req.params.orderId);
  if (!order) return res.status(404).json({ error: 'Order tidak ditemukan' });
  
  if (order.status === 'paid') {
    return res.json({ success: true, status: 'paid', productCode: order.productCode });
  }
  
  if (new Date(order.expiredAt) < new Date()) {
    order.status = 'expired';
    await setDB(db.products, db.orders, db.sha);
    return res.json({ success: true, status: 'expired' });
  }
  
  try {
    const response = await fetch(`${QRISPY_API_URL}/api/payment/qris/${order.qrisId}/status`, {
      headers: { 'X-API-Token': QRISPY_TOKEN }
    });
    const data = await response.json();
    
    if (data.status === 'success' && data.data.status === 'paid') {
      const product = db.products.find(p => p.id == order.productId);
      if (product && product.stock > 0) product.stock -= 1;
      order.status = 'paid';
      order.paidAt = new Date().toISOString();
      await setDB(db.products, db.orders, db.sha);
      
      // Kirim notifikasi Telegram via polling backup
      await sendTelegramNotification(order, 'polling');
      
      return res.json({ success: true, status: 'paid', productCode: order.productCode });
    }
    
    res.json({ success: true, status: 'pending' });
  } catch (err) {
    console.error('Check payment error:', err);
    res.json({ success: true, status: 'pending' });
  }
});

// ========== API LAINNYA ==========
app.get('/api/products', async (req, res) => {
  const db = await getDB();
  res.json({ success: true, products: db.products });
});

app.post('/api/create-order', async (req, res) => {
  const { productId, customerName, customerEmail, qrisId, qrisImage, totalAmount, expiredAt } = req.body;
  if (!productId || !customerName || !qrisId) {
    return res.status(400).json({ error: 'Data tidak lengkap' });
  }
  
  const db = await getDB();
  const product = db.products.find(p => p.id == productId);
  if (!product) return res.status(404).json({ error: 'Produk tidak ditemukan' });
  if (product.stock <= 0) return res.status(400).json({ error: 'Stok habis' });
  
  const orderCode = crypto.randomBytes(16).toString('hex');
  const newOrder = {
    id: Date.now(),
    orderCode: orderCode,
    qrisId: qrisId,
    productId: product.id,
    productName: product.name,
    productCode: product.itemCode,
    price: product.price,
    totalAmount: totalAmount || product.price,
    customerName,
    customerEmail: customerEmail || '-',
    status: 'pending',
    qrisImage: qrisImage,
    expiredAt: expiredAt,
    createdAt: new Date().toISOString()
  };
  db.orders.unshift(newOrder);
  await setDB(db.products, db.orders, db.sha);
  
  res.json({ success: true, orderId: newOrder.id, orderCode: orderCode });
});

// ========== ADMIN ==========
app.post('/api/admin/product', async (req, res) => {
  const { name, price, stock, itemCode, adminKey } = req.body;
  if (adminKey !== ADMIN_KEY) return res.status(401).json({ error: 'Unauthorized' });
  if (!name || !itemCode || price <= 0) return res.status(400).json({ error: 'Invalid data' });
  const db = await getDB();
  db.products.push({ id: Date.now(), name, price: parseInt(price), stock: parseInt(stock) || 1, itemCode, createdAt: new Date().toISOString() });
  await setDB(db.products, db.orders, db.sha);
  res.json({ success: true });
});

app.delete('/api/admin/product/:id', async (req, res) => {
  const { adminKey } = req.body;
  if (adminKey !== ADMIN_KEY) return res.status(401).json({ error: 'Unauthorized' });
  const db = await getDB();
  db.products = db.products.filter(p => p.id != req.params.id);
  await setDB(db.products, db.orders, db.sha);
  res.json({ success: true });
});

app.get('/api/admin/orders', async (req, res) => {
  const { adminKey } = req.query;
  if (adminKey !== ADMIN_KEY) return res.status(401).json({ error: 'Unauthorized' });
  const db = await getDB();
  res.json({ success: true, orders: db.orders });
});

app.get('/api/admin/products', async (req, res) => {
  const { adminKey } = req.query;
  if (adminKey !== ADMIN_KEY) return res.status(401).json({ error: 'Unauthorized' });
  const db = await getDB();
  res.json({ success: true, products: db.products });
});

module.exports = app;
