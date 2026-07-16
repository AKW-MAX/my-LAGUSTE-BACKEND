require("dotenv").config();

const mongoose = require("mongoose");
const bcrypt = require("bcrypt");

const Admin = require("./models/admin");

async function seedAdmin() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI);

    console.log("✅ MongoDB Connected");

    // Check if Super Admin already exists
    const existingAdmin = await Admin.findOne({
      role: "superadmin",
    });

    if (existingAdmin) {
      console.log("⚠️ Super Admin already exists.");
      process.exit();
    }

    // Hash password
    const hashedPassword = await bcrypt.hash("Admin@123", 10);

    // Create Super Admin
    const admin = await Admin.create({
      first_name: "Agnes",
      last_name: "Wanini",
      username: "superadmin",
      email: "agneskaris26@gmail.com",
      password: hashedPassword,
      role: "superadmin",
      approved: true,
    });

    console.log("✅ Super Admin created successfully!");
    console.log(admin);

    process.exit();

  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

seedAdmin();