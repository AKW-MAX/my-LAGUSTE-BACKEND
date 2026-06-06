Laguste Backend API
Overview

This is the backend server for the Laguste e-commerce application. It provides APIs for product retrieval, customer registration, and customer authentication using Express.js, MongoDB, and bcrypt password hashing.

Features
Product API endpoint
Customer registration
Customer login authentication
Password hashing with bcrypt
MongoDB database integration
Environment variable support
CORS enabled
Tech Stack
Node.js
Express.js
MongoDB
Mongoose
bcrypt
dotenv
cors
Installation
1. Clone the repository
git clone <repository-url>
cd backend
2. Install dependencies
npm install
3. Create Environment Variables

Create a .env file in the project root:

PORT=5000
MONGO_URI=your_mongodb_connection_string
4. Start the Server

Development:

npm run dev

Production:

npm start

The server will run on:

https://agriventure-enterprise-backend.onrender.com
API Endpoints
Get Products

Endpoint

GET /Products

Response

[
  {
    "id": 1,
    "name": "Product Name"
  }
]
Register Customer

Endpoint

POST /register

Request Body

{
  "first_name": "John",
  "last_name": "Doe",
  "email": "john@example.com",
  "password": "password123"
}

Success Response

{
  "message": "Registered successfully",
  "customer": {}
}
Login Customer

Endpoint

POST /login

Request Body

{
  "email": "john@example.com",
  "password": "password123"
}

Success Response

{
  "message": "Login successful"
}
Project Structure
backend/
│
├── models/
│   ├── Products.js
│   └── customers.js
│
├── .env
├── server.js
├── package.json
├── package-lock.json
└── README.md
Database

The application uses MongoDB Atlas and connects using Mongoose.

Example connection:

mongoose.connect(process.env.MONGO_URI);
Security
Passwords are hashed using bcrypt before storage.
Login uses bcrypt password comparison.
Legacy plaintext passwords are automatically upgraded to hashed passwords after successful login.
Future Improvements
JWT Authentication
Role-based authorization
Product CRUD operations
Shopping cart API
Order management
Payment integration
Author

Agnes Karis

Built with Node.js, Express.js, and MongoDB.
