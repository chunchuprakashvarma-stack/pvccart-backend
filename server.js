const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const Razorpay = require('razorpay');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors({
  origin: ['http://localhost:5173', 'https://pvccart.dpdns.org', 'https://*.pages.dev'],
  credentials: true
}));
app.use(express.json());

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/pvccart', {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => console.log('✅ MongoDB Connected'))
  .catch(err => console.error('MongoDB connection error:', err));

// ==================== MODELS ====================

// User Model
const UserSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, unique: true },
  phone: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { type: String, enum: ['admin', 'seller', 'rider', 'customer'], default: 'customer' },
  city: String,
  createdAt: { type: Date, default: Date.now }
});
const User = mongoose.model('User', UserSchema);

// Order Model
const OrderSchema = new mongoose.Schema({
  orderId: { type: String, unique: true, required: true },
  customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  customerName: String,
  customerPhone: String,
  sellerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  riderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  items: [{
    name: String,
    quantity: Number,
    price: Number
  }],
  subtotal: Number,
  deliveryFee: Number,
  total: Number,
  paymentMethod: { type: String, enum: ['COD', 'ONLINE'], default: 'COD' },
  paymentStatus: { type: String, enum: ['pending', 'completed', 'failed'], default: 'pending' },
  razorpayPaymentId: String,
  razorpayOrderId: String,
  status: { type: String, enum: ['pending', 'confirmed', 'preparing', 'out_for_delivery', 'delivered', 'cancelled'], default: 'pending' },
  city: String,
  createdAt: { type: Date, default: Date.now }
});
const Order = mongoose.model('Order', OrderSchema);

// ==================== AUTH ROUTES ====================

// Register
app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, phone, email, password, role, city } = req.body;
    
    const existingUser = await User.findOne({ $or: [{ phone }, { email }] });
    if (existingUser) {
      return res.status(400).json({ success: false, error: 'User already exists' });
    }
    
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = new User({ name, phone, email, password: hashedPassword, role, city });
    await user.save();
    
    const token = jwt.sign({ userId: user._id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.json({ success: true, token, user: { id: user._id, name, phone, email, role } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { phone, password } = req.body;
    const user = await User.findOne({ phone });
    if (!user) {
      return res.status(400).json({ success: false, error: 'User not found' });
    }
    
    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) {
      return res.status(400).json({ success: false, error: 'Invalid password' });
    }
    
    const token = jwt.sign({ userId: user._id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.json({ success: true, token, user: { id: user._id, name: user.name, phone: user.phone, email: user.email, role: user.role } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==================== RAZORPAY PAYMENT ROUTES ====================

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});

// Create Order
app.post('/api/payments/create-order', async (req, res) => {
  try {
    const { amount, currency = 'INR', receipt, notes } = req.body;
    
    const options = {
      amount: Math.round(amount * 100),
      currency: currency,
      receipt: receipt || `receipt_${Date.now()}`,
      notes: notes || {},
      payment_capture: 1
    };
    
    const order = await razorpay.orders.create(options);
    console.log('Order created:', order.id);
    
    res.json({
      success: true,
      orderId: order.id,
      amount: order.amount,
      currency: order.currency
    });
  } catch (error) {
    console.error('Error creating order:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Verify Payment
app.post('/api/payments/verify-payment', async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
    
    const body = razorpay_order_id + '|' + razorpay_payment_id;
    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(body.toString())
      .digest('hex');
    
    if (expectedSignature === razorpay_signature) {
      console.log('Payment verified:', razorpay_payment_id);
      res.json({
        success: true,
        message: 'Payment verified successfully',
        paymentId: razorpay_payment_id,
        orderId: razorpay_order_id
      });
    } else {
      res.status(400).json({ success: false, error: 'Invalid payment signature' });
    }
  } catch (error) {
    console.error('Error verifying payment:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==================== ORDER ROUTES ====================

// Create Order
app.post('/api/orders', async (req, res) => {
  try {
    const { customerId, customerName, customerPhone, sellerId, items, subtotal, deliveryFee, total, paymentMethod, city, razorpayPaymentId, razorpayOrderId } = req.body;
    
    const orderId = `ORD${Date.now()}${Math.floor(Math.random() * 1000)}`;
    
    const order = new Order({
      orderId,
      customerId,
      customerName,
      customerPhone,
      sellerId,
      items,
      subtotal,
      deliveryFee,
      total,
      paymentMethod,
      paymentStatus: razorpayPaymentId ? 'completed' : 'pending',
      razorpayPaymentId,
      razorpayOrderId,
      city,
      status: 'pending'
    });
    
    await order.save();
    res.json({ success: true, order });
  } catch (error) {
    console.error('Error creating order:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get Orders by Customer
app.get('/api/orders/customer/:customerId', async (req, res) => {
  try {
    const orders = await Order.find({ customerId: req.params.customerId }).sort({ createdAt: -1 });
    res.json({ success: true, orders });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==================== HEALTH CHECK ====================
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'PVC Cart Backend is running!' });
});

// ==================== START SERVER ====================
app.listen(PORT, () => {
  console.log(`🚀 PVC Cart Backend running on http://localhost:${PORT}`);
  console.log(`📱 API Endpoints:`);
  console.log(`   - Health: http://localhost:${PORT}/api/health`);
  console.log(`   - Register: POST http://localhost:${PORT}/api/auth/register`);
  console.log(`   - Login: POST http://localhost:${PORT}/api/auth/login`);
  console.log(`   - Create Order: POST http://localhost:${PORT}/api/payments/create-order`);
  console.log(`   - Verify Payment: POST http://localhost:${PORT}/api/payments/verify-payment`);
});