const mongoose = require("mongoose");
require("dotenv").config();

const Product = require("./models/Products");
const productsData = require("./models/productsData");

async function seedProducts() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI);

    console.log("MongoDB connected");

    // Remove old products to avoid duplicates
    await Product.deleteMany();

    console.log("Old products removed");

    // Insert new products
    await Product.insertMany(productsData);

    console.log("Products successfully added to MongoDB");

    process.exit();
  } catch (error) {
    console.error("Error seeding products:", error);
    process.exit(1);
  }
}

seedProducts();
