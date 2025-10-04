Expensify: Full-Stack Expense Management System
🚀 Overview
Expensify is a robust, role-based web application designed to automate and streamline the corporate expense reimbursement process. It features multi-level, conditional approval workflows, secure user management, and mock functionality for advanced features like OCR receipt scanning and real-time currency conversion.

This project uses a classic MERN-style stack (excluding React/Vue for the frontend component) with a persistent MongoDB database to ensure data integrity and accessibility.

✨ Core Features
Role-Based Access: Dedicated dashboards and permissions for Admin, Manager, and Employee.

Secure Authentication: User signup (Admin only initially) and login with persistent sessions.

Hierarchical User Management (Admin): Create, assign roles (Manager/Employee), assign managers, and delete users.

Advanced Approval Workflow:

Sequential: Expenses route through a defined chain (Manager → Finance → Director).

Conditional/Hybrid Rules: Admin can configure rules like Percentage Approval (e.g., 60% approval is auto-approved) or Specific Approver Override.

Employee Features: Submit expense claims (with currency conversion mock), view submission history, and track status.

Manager Features: View pending approvals from direct reports/team, approve/reject claims with comments, and view team expenses.

Simulated OCR: Front-end mock functionality to auto-fill expense forms from a simulated receipt scan.

🛠️ Technology Stack
Component

Technology

Role

Frontend

HTML5, JavaScript (Vanilla), Tailwind CSS

UI rendering, state management, and API interaction.

Backend

Node.js, Express.js

REST API definition, routing, and business logic.

Database

MongoDB (via Mongoose)

Persistent storage for user credentials, company settings, and expense records.

Security

CORS, Basic Plaintext Password Storage (Dev Mode)

Handles cross-origin requests and basic user authentication.

⚙️ Local Setup Instructions
Follow these steps to get the Expensify application running on your local machine.

Prerequisites
You must have the following installed:

Node.js (v18+)

npm (Node Package Manager)

MongoDB (running instance, local or Atlas)

1. Database and Environment Configuration
Create a file named .env in the project's root directory (expense-manager/) and add your MongoDB connection string and server port:

PORT=3000
MONGO_URI=mongodb://localhost:27017/expensify

2. Install Dependencies
Navigate to the project root (expense-manager/) and install the necessary packages defined in package.json:

npm install

3. Start the Backend Server
Start the Node.js server using the start script:

npm start

You should see output confirming the server is running and connected to MongoDB:

Server running on http://localhost:3000
MongoDB connected successfully.
Creating initial company settings...

4. Access the Application
Open your web browser and navigate to the server's root address:

http://localhost:3000/

5. First-Time Use
Admin Setup: Since the database is new, the application will direct you to the Sign Up tab. Create your first Admin user.

Login: Log in with your new Admin credentials.

Create Users: Navigate to User Management to create Manager and Employee accounts. Ensure employees are assigned a Manager for the approval workflow to function.
