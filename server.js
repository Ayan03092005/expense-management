const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
// const bcrypt = require('bcryptjs'); // REMOVED: bcryptjs
const dotenv = require('dotenv');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/expensify';

// --- Middleware & CORS Configuration ---
app.use(cors()); 
app.use(express.json());

// --- FIX: Add static file serving for CSS, JS, etc. ---
// This tells Express to look inside the 'public' folder for files requested via the root path.
app.use(express.static(path.join(__dirname, 'public')));


// --- MongoDB Connection ---
mongoose.connect(MONGO_URI)
    .then(() => console.log('MongoDB connected successfully.'))
    .catch(err => console.error('MongoDB connection error:', err));

// --- Mongoose Schemas ---

const UserSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    role: { type: String, enum: ['Admin', 'Manager', 'Employee'], default: 'Employee' },
    managerId: { type: String, default: null },
}, { 
    timestamps: true,
    // Enable virtuals to convert _id to id when JSON is sent to frontend
    toJSON: { 
        virtuals: true,
        transform: (doc, ret) => {
            ret.id = ret._id.toString(); // Ensure consistent string conversion
            delete ret._id;
            delete ret.password;
        }
    }
});

// Create a virtual 'id' field based on '_id'
UserSchema.virtual('id').get(function() {
    return this._id.toString(); // Use toString() for safety
});

// REMOVED: Pre-save hook for password hashing (using plain text passwords now)

const ExpenseSchema = new mongoose.Schema({
    id: { type: String, default: uuidv4, unique: true }, 
    userId: { type: String, required: true, ref: 'User' },
    userName: { type: String, required: true },
    submittedAt: { type: Date, default: Date.now },
    amount: { type: Number, required: true },
    currency: { type: String, required: true },
    baseAmount: { type: Number, required: true },
    baseCurrency: { type: String, required: true },
    category: { type: String },
    description: { type: String },
    date: { type: String },
    receiptUrl: { type: String },
    status: { type: String, enum: ['Pending', 'Approved', 'Rejected'], default: 'Pending' },
    currentApproverIndex: { type: Number, default: 0 },
    approvalChain: [{
        stepName: String,
        approverId: String,
        status: { type: String, enum: ['Pending', 'Approved', 'Rejected'], default: 'Pending' },
        comment: String,
        approvedAt: Date,
    }],
}, { timestamps: true });

const CompanySchema = new mongoose.Schema({
    id: { type: String, default: 'settings', unique: true },
    baseCurrency: { type: String, default: 'USD' },
    approvalRules: {
        sequentialChain: [{ role: String, name: String }],
        percentageRule: { enabled: Boolean, threshold: Number },
        hybridRule: { enabled: Boolean, approverId: String },
    }
}, { versionKey: false });


const User = mongoose.model('User', UserSchema);
const Expense = mongoose.model('Expense', ExpenseSchema);
const Company = mongoose.model('Company', CompanySchema);


// --- Controllers (Simplified for inline structure) ---

const companyController = {
    // Check if settings exist, if not, create default settings
    getSettings: async (req, res) => {
        try {
            let settings = await Company.findOne({ id: 'settings' });
            if (!settings) {
                settings = new Company({
                    id: 'settings',
                    baseCurrency: 'USD',
                    approvalRules: {
                        sequentialChain: [
                            { role: 'Manager', name: 'Direct Manager' },
                            { role: 'Finance', name: 'Finance Reviewer' },
                            { role: 'Director', name: 'Director/CFO' },
                        ],
                        percentageRule: { enabled: true, threshold: 60 },
                        hybridRule: { enabled: false, approverId: null }
                    }
                });
                await settings.save();
                console.log('Creating initial company settings...');
            }
            res.status(200).json(settings);
        } catch (error) {
            console.error('Error in getSettings controller (Server Crash point):', error.message, error.stack); 
            res.status(500).json({ message: 'Internal Server Error during initial setup or fetching settings.', error: error.message });
        }
    },
    // Update company settings (Admin only, assumed)
    updateSettings: async (req, res) => {
        try {
            const settings = await Company.findOneAndUpdate({ id: 'settings' }, req.body, { new: true, upsert: true });
            res.status(200).json(settings);
        } catch (error) {
            res.status(500).json({ message: 'Error updating settings', error: error.message });
        }
    }
};

const userController = {
    // Get all users
    getAll: async (req, res) => {
        try {
            const users = await User.find({}); 
            res.status(200).json(users);
        } catch (error) {
            res.status(500).json({ message: 'Error fetching users', error: error.message });
        }
    },

    // Update user role/manager
    update: async (req, res) => {
        const { id } = req.params;
        const { role, managerId, password } = req.body;
        
        try {
            const user = await User.findById(id); 
            if (!user) return res.status(404).json({ message: 'User not found' });
            
            user.role = role;
            user.managerId = managerId;
            
            if (password) {
                // FIX: Save plain text password directly
                user.password = password; 
            }

            // Using save() writes the password as plain text
            const savedUser = await user.save();
            
            res.status(200).json(savedUser);
        } catch (error) {
            res.status(500).json({ message: 'Error updating user', error: error.message });
        }
    },
    
    // DELETE user
    delete: async (req, res) => {
        const { id } = req.params;
        try {
            const user = await User.findByIdAndDelete(id); 
            if (!user) return res.status(404).json({ message: 'User not found' });
            
            await Expense.deleteMany({ userId: id });

            res.status(200).json({ message: 'User deleted successfully' });
        } catch (error) {
            res.status(500).json({ message: 'Error deleting user', error: error.message });
        }
    }
};

const authController = {
    // Signup endpoint (Handles initial Admin and Admin-created users)
    signup: async (req, res) => {
        const { name, email, password, role, managerId, isAdminCreation } = req.body;

        if (!name || !email || !password || !role) {
            return res.status(400).json({ message: 'All fields are required.' });
        }

        try {
            const userExists = await User.findOne({ email });
            if (userExists) return res.status(400).json({ message: 'User already exists' });

            const totalUsers = await User.countDocuments();
            
            if (totalUsers === 0) {
                if (role !== 'Admin') {
                    return res.status(403).json({ message: 'First user must be an Admin.' });
                }
            } else if (!isAdminCreation) {
                return res.status(403).json({ message: 'New users must be created by an Admin.' });
            }
            
            const newUser = new User({ 
                name, 
                email, 
                password, // Saved as plain text
                role, 
                managerId: managerId || null,
            });
            await newUser.save();

            res.status(201).json({ 
                message: 'User created successfully', 
                user: { id: newUser._id.toString(), email: newUser.email, role: newUser.role }
            });
        } catch (error) {
            res.status(500).json({ message: 'Error during signup', error: error.message });
        }
    },

    // Login endpoint
    login: async (req, res) => {
        const { email, password } = req.body;

        try {
            // FIX: Select the password field explicitly for comparison
            const user = await User.findOne({ email }).select('+password'); 
            if (!user) return res.status(401).json({ message: 'Invalid credentials' });

            // FIX: Compare plain text password directly
            const isMatch = (password === user.password); 
            if (!isMatch) return res.status(401).json({ message: 'Invalid credentials' });

            res.status(200).json({ 
                message: 'Login successful',
                user: { id: user._id.toString(), email: user.email, role: user.role }
            });
        } catch (error) {
            res.status(500).json({ message: 'Error during login', error: error.message });
        }
    }
};

const expenseController = {
    // Helper function to create the initial approval chain
    createApprovalChain: async (expense, companySettings, allUsers) => {
        const chain = [];
        const sequentialChain = companySettings.approvalRules.sequentialChain;
        const submittingUser = allUsers.find(u => u.id === expense.userId);
        
        if (!submittingUser) throw new Error("Submitting user not found.");

        for (const step of sequentialChain) {
            let approver = null;
            if (step.role === 'Manager') {
                approver = allUsers.find(u => u.id === submittingUser.managerId);
            } else {
                approver = allUsers.find(u => u.role === step.role);
            }
            
            if (approver) {
                chain.push({
                    stepName: step.name,
                    approverId: approver.id,
                    status: 'Pending',
                    comment: null,
                    approvedAt: null,
                });
            }
        }
        
        if (chain.length === 0) {
            throw new Error("Approval chain is empty. Check manager assignment or company rules.");
        }
        
        return chain;
    },

    // Submit a new expense
    submit: async (req, res) => {
        const expenseData = req.body;
        
        try {
            const [settings, allUsersRaw] = await Promise.all([
                Company.findOne({ id: 'settings' }),
                User.find({}) 
            ]);
            
            const allUsers = allUsersRaw.map(u => u.toJSON());
            
            if (!settings) return res.status(500).json({ message: 'Company settings not found.' });

            const newExpense = new Expense({
                ...expenseData,
                id: uuidv4(),
                baseCurrency: settings.baseCurrency,
                submittedAt: Date.now(),
            });

            newExpense.approvalChain = await expenseController.createApprovalChain(
                newExpense, 
                settings, 
                allUsers
            );

            newExpense.currentApproverIndex = 0;

            await newExpense.save();
            res.status(201).json(newExpense);
        } catch (error) {
            res.status(500).json({ message: 'Error submitting expense', error: error.message });
        }
    },
    
    // Get all expenses (Admin)
    getAll: async (req, res) => {
        try {
            const expenses = await Expense.find().sort({ submittedAt: -1 });
            res.status(200).json(expenses);
        } catch (error) {
            res.status(500).json({ message: 'Error fetching all expenses', error: error.message });
        }
    },

    // Get pending expenses for a specific approver (Manager/Finance/Director)
    getPending: async (req, res) => {
        const { approverId } = req.params;
        try {
            const pendingExpenses = await Expense.find({
                status: 'Pending',
            }).sort({ submittedAt: 1 });

            const finalPending = pendingExpenses.filter(exp => 
                exp.approvalChain[exp.currentApproverIndex]?.approverId === approverId
            );

            res.status(200).json(finalPending);
        } catch (error) {
            res.status(500).json({ message: 'Error fetching pending expenses', error: error.message });
        }
    },
    
    // Get team expenses (Manager)
    getTeam: async (req, res) => {
        const { managerId } = req.params;
        try {
            const teamUsers = await User.find({ managerId }).select('_id');
            const teamUserIds = teamUsers.map(u => u._id.toString());

            const teamExpenses = await Expense.find({ userId: { $in: teamUserIds } }).sort({ submittedAt: -1 });

            res.status(200).json(teamExpenses);
        } catch (error) {
            res.status(500).json({ message: 'Error fetching team expenses', error: error.message });
        }
    },

    // Core Approval Logic
    approve: async (req, res) => {
        const { expenseId } = req.params;
        const { action, comment, approverId } = req.body;

        try {
            const settings = await Company.findOne({ id: 'settings' });
            const expense = await Expense.findOne({ id: expenseId });

            if (!expense) return res.status(404).json({ message: 'Expense not found' });
            if (expense.status !== 'Pending') return res.status(400).json({ message: `Expense is already ${expense.status}.` });

            const currentStepIndex = expense.currentApproverIndex;
            const currentStep = expense.approvalChain[currentStepIndex];

            if (currentStep.approverId !== approverId) {
                return res.status(403).json({ message: 'Forbidden: You are not the current designated approver.' });
            }

            expense.approvalChain[currentStepIndex].status = action;
            expense.approvalChain[currentStepIndex].comment = comment;
            expense.approvalChain[currentStepIndex].approvedAt = Date.now();

            if (action === 'Rejected') {
                expense.status = 'Rejected';
            } else {
                const rule = settings.approvalRules;
                
                if (rule.hybridRule.enabled && rule.hybridRule.approverId === approverId && action === 'Approved') {
                    expense.status = 'Approved';
                } 
                
                if (expense.status === 'Pending') {
                    const nextIndex = currentStepIndex + 1;
                    if (nextIndex >= expense.approvalChain.length) {
                        expense.status = 'Approved';
                    } else {
                        expense.currentApproverIndex = nextIndex;
                    }
                }
                
                if (expense.status === 'Pending' && rule.percentageRule.enabled) {
                    const approvedCount = expense.approvalChain.filter(s => s.status === 'Approved').length;
                    const totalApproversInChain = expense.approvalChain.length;
                    
                    if (totalApproversInChain > 0) {
                        const percentageApproved = (approvedCount / totalApproversInChain) * 100;
                        
                        if (percentageApproved >= rule.percentageRule.threshold) {
                            expense.status = 'Approved';
                        }
                    }
                }
            }
            
            if (expense.status !== 'Pending') {
                 expense.currentApproverIndex = expense.approvalChain.length;
            }


            await expense.save();
            res.status(200).json({ message: 'Approval processed', expense });
        } catch (error) {
            res.status(500).json({ message: 'Error processing approval', error: error.message });
        }
    }
};


// --- API Routes ---

app.get('/api/users', userController.getAll);
app.put('/api/users/:id', userController.update);
app.delete('/api/users/:id', userController.delete); 

app.post('/api/expenses/submit', expenseController.submit);
app.get('/api/expenses/all', expenseController.getAll);
app.get('/api/expenses/pending/:approverId', expenseController.getPending);
app.get('/api/expenses/team/:managerId', expenseController.getTeam);
app.put('/api/expenses/approve/:expenseId', expenseController.approve);

app.post('/api/auth/signup', authController.signup);
app.post('/api/auth/login', authController.login);

app.get('/api/settings', companyController.getSettings);
app.put('/api/settings', companyController.updateSettings);


// --- Frontend Serving (MUST BE LAST ROUTE) ---
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});


// Start the server
app.listen(PORT, async () => {
    console.log(`Server running on http://localhost:${PORT}`);
    // Ensure initial company settings are checked/created on startup
    // We pass mock response objects to avoid using real res/req outside of a request context
    await companyController.getSettings({ status: () => ({ json: () => {} }) }, { status: () => ({ json: () => {} }) });
});
