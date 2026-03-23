const express = require('express');
const cors = require('cors');
const Razorpay = require('razorpay');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// YOUR NEW TEST KEYS
const RAZORPAY_KEY_ID = 'rzp_test_SUmcms7LAkSvYj';
const RAZORPAY_KEY_SECRET = 'CgkKdn1z3dVGNIOyvs3gb007';

const razorpay = new Razorpay({
  key_id: RAZORPAY_KEY_ID,
  key_secret: RAZORPAY_KEY_SECRET
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Backend running!' });
});

app.post('/api/create-order', async (req, res) => {
  try {
    console.log('Creating order for amount:', req.body.amount);
    const { amount } = req.body;
    
    const options = {
      amount: Math.round(amount * 100),
      currency: 'INR',
      receipt: `receipt_${Date.now()}`
    };
    
    const order = await razorpay.orders.create(options);
    console.log('Order created:', order.id);
    res.json({ success: true, orderId: order.id, amount: order.amount });
  } catch (error) {
    console.error('Order error:', error);
    res.status(500).json({ success: false, error: error.error?.description || error.message });
  }
});

app.post('/api/verify-payment', async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
    const body = razorpay_order_id + '|' + razorpay_payment_id;
    const expectedSignature = crypto
      .createHmac('sha256', RAZORPAY_KEY_SECRET)
      .update(body.toString())
      .digest('hex');
    
    if (expectedSignature === razorpay_signature) {
      res.json({ success: true });
    } else {
      res.status(400).json({ success: false, error: 'Invalid signature' });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Backend running on port ${PORT}`);
  console.log(`Using Razorpay Key: ${RAZORPAY_KEY_ID}`);
});
