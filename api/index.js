const express = require('express');
const cors = require('cors');
const crypto = require('crypto');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// ========== KONFIGURASI ==========
const ADMIN_KEY = 'rahasia123';
const WEBHOOK_SECRET = 'whsec_jJfqxO5wpcbQQF7sMVURsJ7re3ofIVTX';

// ========== KONFIGURASI GITHUB ==========
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = process.env.GITHUB_REPO || 'yantoddddd/stockyanto';
const GITHUB_PATH = 'database.json';

// ========== FUNGSI DATABASE ==========
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
    console.error('GetDB error:', err);
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
  if (!res.ok) {
    const error = await res.text();
    throw new Error(`GitHub save failed: ${error}`);
  }
  const data = await res.json();
  return data.content.sha;
}

// ========== WEBHOOK ==========
app.post('/api/webhook', (req, res) => {
  const signature = req.headers['x-qrispy-signature'];
  const payload = JSON.stringify(req.body);
  const expected = crypto.createHmac('sha256', WEBHOOK_SECRET).update(payload).digest('hex');
  if (signature !== expected) return res.status(401).end();
  res.status(200).end();
  (async () => {
    try {
      const { event, data } = req.body;
      if (event === 'payment.received') {
        const db = await getDB();
        const order = db.orders.find(o => o.qrisId === data.qris_id);
        if (!order || order.status === 'paid') return;
        const product = db.products.find(p => p.id == order.productId);
        if (product && product.stock > 0) product.stock -= 1;
        order.status = 'paid';
        order.paidAt = data.paid_at || new Date().toISOString();
        await setDB(db.products, db.orders, db.sha);
        console.log(`Order ${order.id} paid via webhook`);
      }
    } catch(e) { console.error('Webhook error:', e); }
  })();
});

// ========== API: BUAT ORDER ==========
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
    productDescription: product.description || '',
    itemType: product.itemType,
    itemContent: product.itemContent,
    bonusType: product.bonusType,
    bonusContent: product.bonusContent,
    price: product.price,
    totalAmount: totalAmount || product.price,
    customerName,
    customerEmail: customerEmail || '-',
    status: 'pending',
    qrisImage: qrisImage,
    expiredAt: expiredAt || new Date(Date.now() + 15 * 60000).toISOString(),
    createdAt: new Date().toISOString()
  };
  db.orders.unshift(newOrder);
  await setDB(db.products, db.orders, db.sha);

  res.json({ success: true, orderCode: orderCode });
});

// ========== HALAMAN UNIK ORDER ==========
app.get('/order/:code', async (req, res) => {
  const db = await getDB();
  const order = db.orders.find(o => o.orderCode === req.params.code);
  if (!order) {
    return res.status(404).send(`<!DOCTYPE html><html><head><title>Not Found</title><style>body{background:#0a2b5e;color:white;font-family:sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;}</style></head><body><div><h1>❌ Order Tidak Ditemukan</h1></div></body></html>`);
  }

  if (order.status === 'paid') {
    let itemHtml = '';
    if (order.itemType === 'link') {
      itemHtml = `<a href="${order.itemContent}" class="download-btn" target="_blank"><i class="fas fa-external-link-alt"></i> Buka Link</a>`;
    } else {
      itemHtml = `<div class="code-box">${escapeHtml(order.itemContent)}<br><button class="copy-btn" onclick="copyText()"><i class="far fa-copy"></i> Salin Teks</button></div>`;
    }
    
    let bonusHtml = '';
    if (order.bonusContent && order.bonusContent !== '') {
      if (order.bonusType === 'link') {
        bonusHtml = `<div class="bonus-box"><strong><i class="fas fa-gift"></i> Bonus:</strong><br><a href="${order.bonusContent}" target="_blank"><i class="fas fa-external-link-alt"></i> Buka Link Bonus</a></div>`;
      } else {
        bonusHtml = `<div class="bonus-box"><strong><i class="fas fa-gift"></i> Bonus:</strong><br>${escapeHtml(order.bonusContent)}</div>`;
      }
    }

    res.send(`
      <!DOCTYPE html>
      <html lang="id">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Detail Order - ${order.productName}</title>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0-beta3/css/all.min.css">
        <style>
          *{margin:0;padding:0;box-sizing:border-box;}
          body{background:linear-gradient(135deg,#0a2b5e,#0f3b7a);font-family:'Inter',sans-serif;min-height:100vh;display:flex;justify-content:center;align-items:center;padding:20px;}
          .card{background:rgba(255,255,255,0.1);backdrop-filter:blur(10px);border-radius:32px;padding:40px;max-width:550px;width:100%;border:1px solid rgba(255,255,255,0.2);}
          h1{color:#10b981;margin-bottom:20px;font-size:2rem;text-align:center;}
          .product-name{font-size:1.5rem;font-weight:700;margin:10px 0;color:white;}
          .product-desc{color:#94a3b8;margin-bottom:20px;font-size:0.9rem;}
          .code-box{background:#0f172a;padding:20px;border-radius:20px;margin:15px 0;word-break:break-all;font-family:monospace;font-size:0.9rem;border-left:4px solid #10b981;}
          .bonus-box{background:#1e293b;padding:15px;border-radius:20px;margin:15px 0;border-left:4px solid #f59e0b;}
          .download-btn{background:#3b82f6;display:inline-block;padding:12px 24px;border-radius:40px;color:white;text-decoration:none;margin:10px 0;font-weight:600;}
          .copy-btn{background:#334155;border:none;padding:8px 16px;border-radius:40px;color:white;cursor:pointer;margin-top:10px;}
          .info{color:#94a3b8;font-size:0.7rem;margin-top:20px;text-align:center;}
        </style>
      </head>
      <body>
        <div class="card">
          <i class="fas fa-check-circle" style="font-size:4rem;color:#10b981;display:block;text-align:center;"></i>
          <h1>✅ Pembayaran Berhasil!</h1>
          <div class="product-name">${escapeHtml(order.productName)}</div>
          <div class="product-desc">${escapeHtml(order.productDescription)}</div>
          <div style="font-weight:600; margin-top:15px;">📦 Barang Digital:</div>
          ${itemHtml}
          ${bonusHtml}
          <div class="info"><i class="fas fa-save"></i> Simpan kode di atas. Halaman ini tidak akan berubah meskipun di-refresh.</div>
        </div>
        <script>
          function copyText() {
            const text = document.querySelector('.code-box').innerText.replace('Salin Teks', '').trim();
            navigator.clipboard.writeText(text);
            alert('Teks disalin!');
          }
        </script>
      </body>
      </html>
    `);
  } else {
    res.send(`
      <!DOCTYPE html>
      <html lang="id">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Menunggu Pembayaran - ${order.productName}</title>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0-beta3/css/all.min.css">
        <style>
          *{margin:0;padding:0;box-sizing:border-box;}
          body{background:linear-gradient(135deg,#0a2b5e,#0f3b7a);font-family:'Inter',sans-serif;min-height:100vh;display:flex;justify-content:center;align-items:center;padding:20px;}
          .card{background:rgba(255,255,255,0.1);backdrop-filter:blur(10px);border-radius:32px;padding:40px;max-width:500px;width:100%;text-align:center;}
          .qris-img{width:100%;max-width:250px;margin:20px auto;display:block;background:white;padding:16px;border-radius:24px;}
          .total{font-size:1.5rem;font-weight:800;color:#60a5fa;margin:10px 0;}
          .refresh-btn{background:#3b82f6;border:none;padding:12px 24px;border-radius:40px;color:white;font-weight:600;cursor:pointer;margin-top:20px;}
          .info{color:#94a3b8;font-size:0.7rem;margin-top:20px;}
        </style>
      </head>
      <body>
        <div class="card">
          <h2><i class="fas fa-qrcode"></i> Scan QRIS untuk Membayar</h2>
          <img src="${order.qrisImage}" class="qris-img" alt="QRIS">
          <div class="total">💰 Total: Rp ${order.totalAmount.toLocaleString()}</div>
          <div class="status" id="statusText">⏳ Menunggu pembayaran...</div>
          <button class="refresh-btn" onclick="checkStatus()"><i class="fas fa-sync-alt"></i> Cek Status</button>
          <div class="info"><i class="fas fa-clock"></i> Kadaluarsa: ${new Date(order.expiredAt).toLocaleString()}<br>Setelah bayar, refresh halaman ini.</div>
        </div>
        <script>
          const orderCode = '${order.orderCode}';
          async function checkStatus() {
            const statusDiv = document.getElementById('statusText');
            statusDiv.innerHTML = '<i class="fas fa-spinner fa-pulse"></i> Mengecek...';
            try {
              const res = await fetch('/api/check-order/' + orderCode);
              const data = await res.json();
              if (data.status === 'paid') {
                statusDiv.innerHTML = '✅ Pembayaran BERHASIL! Reload...';
                setTimeout(() => location.reload(), 1500);
              } else if (data.status === 'expired') {
                statusDiv.innerHTML = '❌ QRIS kadaluarsa. Silakan order ulang.';
              } else {
                statusDiv.innerHTML = '⏳ Masih menunggu pembayaran.';
              }
            } catch(e) {}
          }
          setInterval(checkStatus, 5000);
          checkStatus();
        </script>
      </body>
      </html>
    `);
  }
});

app.get('/api/check-order/:code', async (req, res) => {
  const db = await getDB();
  const order = db.orders.find(o => o.orderCode === req.params.code);
  if (!order) return res.json({ status: 'not_found' });
  if (order.status === 'paid') return res.json({ status: 'paid' });
  if (new Date(order.expiredAt) < new Date()) return res.json({ status: 'expired' });
  res.json({ status: 'pending' });
});

// ========== API PRODUK ==========
app.get('/api/products', async (req, res) => {
  const db = await getDB();
  res.json({ success: true, products: db.products });
});

// ========== API ADMIN (Tanpa upload file) ==========
app.post('/api/admin/product', async (req, res) => {
  const { name, description, price, stock, itemType, itemContent, bonusType, bonusContent, adminKey } = req.body;
  if (adminKey !== ADMIN_KEY) return res.status(401).json({ error: 'Unauthorized' });
  if (!name || !price || price <= 0) return res.status(400).json({ error: 'Nama dan harga wajib' });
  if (!itemContent && itemType !== 'none') return res.status(400).json({ error: 'Konten item wajib diisi' });

  const db = await getDB();
  db.products.push({
    id: Date.now(),
    name,
    description: description || '',
    price: parseInt(price),
    stock: parseInt(stock) || 1,
    itemType: itemType || 'text',
    itemContent: itemContent || '',
    bonusType: bonusType || 'none',
    bonusContent: bonusContent || '',
    createdAt: new Date().toISOString()
  });
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

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>]/g, m => m === '&' ? '&amp;' : m === '<' ? '&lt;' : '&gt;');
}

module.exports = app;
