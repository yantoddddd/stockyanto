const API_TOKEN = 'YOUR_API_TOKEN';
const API_URL = 'https://api.qrispy.id';

async function generateQRIS(amount, paymentRef = null, returnUrl = null) {
  const body = { amount };
  if (paymentRef) body.payment_reference = paymentRef;
  if (returnUrl) body.return_url = returnUrl;

  const response = await fetch(`https://api.qrispy.id/api/payment/qris/generate`, {
    method: 'POST',
    headers: {
      'X-API-Token': API_TOKEN,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  
  const data = await response.json();
  return data;
}

async function checkPaymentStatus(qrisId) {
  const response = await fetch(`https://api.qrispy.id/api/payment/qris/${qrisId}/status`, {
    headers: { 'X-API-Token': API_TOKEN }
  });
  return await response.json();
}

async function cancelQRIS(qrisId) {
  const response = await fetch(`https://api.qrispy.id/api/payment/qris/${qrisId}/cancel`, {
    method: 'POST',
    headers: { 'X-API-Token': API_TOKEN }
  });
  return await response.json();
}

// Usage Example
const result = await generateQRIS(50000, 'Order-123', 'https://yoursite.com/thanks');
console.log('QRIS URL:', result.data.qris_image_url);
