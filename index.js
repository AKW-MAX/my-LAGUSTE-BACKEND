const express = require('express');
const cors = require('cors');
const bcrypt = require('bcrypt');
const mongoose = require('mongoose');
require('dotenv').config();
const Products = require('./models/Products');
const Customer = require('./models/customers');

const app = express();
app.use(express.json());
app.use(cors());

const mongoUri = process.env.MONGO_URI;

const ports = process.env.PORT || 5000;

const startServer = async () => {
  try {
    await mongoose.connect(mongoUri);
    console.log('MongoDB connected');
    app.listen(ports, () => {
      console.log(`Server is running on port ${ports}`);
    });
  } catch (err) {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  }
};

app.get('/Products', (req, res) => {
  res.send(Products);
});


// Registration endpoint
app.post('/register', async (req, res) => {
  const { first_name, last_name, email, password } = req.body;
  if (!first_name || !last_name || !email || !password) {
    return res.status(400).json({ message: 'first_name, last_name, email and password are required' });
  }

  try {
    const existingCustomer = await Customer.findOne({ email });
    if (existingCustomer) {
      return res.status(409).json({ message: 'User already exists, kindly login' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const newCustomer = await Customer.create({ first_name, last_name, email, password: hashedPassword });
    return res.status(201).json({ message: 'Registered successfully', customer: newCustomer });
  } catch (err) {
    console.error('Registration error:', err);
    return res.status(500).json({ message: 'Registration failed', error: err.message });
  }
});

// Login endpoint
app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ message: 'email and password required' });
  }

  try {
    const customer = await Customer.findOne({ email });
    if (!customer) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    let match = false;
    if (customer.password) {
      match = await bcrypt.compare(password, customer.password);
    }

    // Legacy fallback for records saved before password hashing was added
    if (!match && customer.password === password) {
      match = true;
      customer.password = await bcrypt.hash(password, 10);
      await customer.save();
    }

    if (!match) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    console.log('Login request:', { email });
    return res.status(200).json({ message: 'Login successful' });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ message: 'Login failed', error: err.message });
  }
});

startServer();