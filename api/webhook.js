const crypto = require('crypto');

const WEBHOOK_SECRET = 'whsec_AVu3fFLUBVMLjo6OdCWq7I3qdQ2CJ6e2';
const QRISPY_TOKEN = 'cki_IBpAYezwDHbfrMuENZMFvFw5mI94M11dAT146N0Ar4HrOWKi';
const QRISPY_API_URL = 'https://api.qrispy.id';

// Konfigurasi GitHub
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = process.env.GITHUB_REPO || 'yantoddddd/stockyanto';
const GITHUB_PATH = 'database.json';

async function getDB() {
  const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/${GITHUB_PATH}`, {
    headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json' }
  });
  if (!res.ok) return { products: [], orders: [], sha: null };
  const data = await res.json();
  const content = Buffer.from(data.content, 'base64').toString('utf8');
  return { ...JSON.parse(content), sha: data.sha };
}

async function setDB(products, orders, oldSha) {
  const content = { products, orders, updatedAt: new Date().toISOString() };
  const updatedContent = Buffer.from(JSON.stringify(content, null, 2)).toString('base64');
  const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/${GITHUB_PATH}`, {
    method: 'PUT',
    headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'Update db via webhook', content: updatedContent, sha: oldSha })
  });
  return res.ok;
}

module.exports = async (req, res) => {
  // Hanya menerima POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Verifikasi signature
  const signature = req.headers['x-qrispy-signature'];
  const payload = JSON.stringify(req.body);
  const expected = crypto.createHmac('sha256', WEBHOOK_SECRET).update(payload).digest('hex');
  
  if (signature !== expected) {
    console.log('Invalid signature');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  // Proses webhook
  try {
    const { event, data } = req.body;
    if (event === 'payment.received') {
      const db = await getDB();
      const order = db.orders.find(o => o.qrisId === data.qris_id);
      if (!order || order.status === 'paid') {
        return res.status(200).end();
      }
      
      const product = db.products.find(p => p.id == order.productId);
      if (product && product.stock > 0) product.stock -= 1;
      order.status = 'paid';
      order.paidAt = data.paid_at || new Date().toISOString();
      await setDB(db.products, db.orders, db.sha);
      
      console.log(`✅ Webhook: Order ${order.orderCode} paid`);
    }
    
    res.status(200).end();
  } catch (err) {
    console.error('Webhook error:', err);
    res.status(500).json({ error: err.message });
  }
};
