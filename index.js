const express = require('express');
const cors = require('cors');
const bcrypt = require('bcrypt');
const mongoose = require('mongoose');
require('dotenv').config();

const Products = require('./models/Products');
const Customer = require('./models/customers');
const Order = require('./models/orders'); // FIXED NAME


const app = express();
app.use(express.json());
app.use(cors());

const mongoUri = process.env.MONGO_URI;
const ports = process.env.PORT || 5000;

/* ---------------- CONNECT DB ---------------- */
const startServer = async () => {
  try {
    await mongoose.connect(mongoUri);
    console.log('MongoDB connected');

    app.listen(ports, () => {
      console.log(`Server is running on port ${ports}`);
    });
  } catch (err) {
    console.error(err);
  }
};


/* ---------------- PRODUCTS ---------------- */
app.get("/Products", async (req, res) => {
  try {
    const products = await Products.find();
    res.json(products);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

/* ---------------- REGISTER ---------------- */
app.post('/register', async (req, res) => {
  try {
    const { first_name, last_name, email, password } = req.body;

    const existing = await Customer.findOne({ email });
    if (existing) return res.status(409).json({ message: "User exists" });

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await Customer.create({
      first_name,
      last_name,
      email,
      password: hashedPassword,
    });

    res.status(201).json({ message: "Registered", user });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ---------------- LOGIN ---------------- */
app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    const customer = await Customer.findOne({ email });
    if (!customer) return res.status(401).json({ message: "Invalid login" });

    const match = await bcrypt.compare(password, customer.password);
    if (!match) return res.status(401).json({ message: "Invalid login" });

    res.status(200).json({ message: "Login successful" });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ---------------- ORDERS (FIXED) ---------------- */
app.post("/api/orders", async (req, res) => {
  try {
    const { customer, orderItems, totalAmount } = req.body;

    const newOrder = new Order({
      customer,
      orderItems,
      totalAmount,
    });

    await newOrder.save();

    res.status(201).json({
      success: true,
      message: "Order placed successfully",
      order: newOrder,
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/* ---------------- START SERVER ---------------- */
startServer();