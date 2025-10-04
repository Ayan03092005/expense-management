// --- Configuration ---
const API_BASE_URL = 'http://localhost:3000/api';

// --- Global State ---
let currentUser = null;
let allUsers = [];
let allExpenses = [];
let companySettings = {};
let currentView = 'home';
let authMode = 'login';
let isReady = false;

// Mock data (for utility functions only, actual data comes from API)
const MOCK_CURRENCIES = [
    { code: "USD", symbol: "$", name: "US Dollar" },
    { code: "EUR", symbol: "€", name: "Euro" },
    { code: "GBP", symbol: "£", name: "British Pound" },
    { code: "JPY", symbol: "¥", name: "Japanese Yen" },
    { code: "INR", symbol: "₹", name: "Indian Rupee" },
    { code: "CAD", symbol: "C$", name: "Canadian Dollar" },
];
const EXPENSE_CATEGORIES = ["Travel", "Meals", "Software", "Office Supplies", "Marketing", "Other"];


// --- API Handlers ---

async function apiFetch(endpoint, options = {}) {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            // Add Authorization header here in a real application
            ...options.headers,
        },
    });
    
    // Check for non-JSON content if status is not OK (e.g., plain text error)
    const contentType = response.headers.get("content-type");
    let data = {};
    if (contentType && contentType.indexOf("application/json") !== -1) {
        data = await response.json();
    } else {
        const text = await response.text();
        data = { message: text };
    }

    if (!response.ok) {
        throw new Error(data.message || `API Error: ${response.status} ${response.statusText}`);
    }
    return data;
}

// Refactored to return data for explicit control in setupApp
async function fetchAllData() {
    try {
        const [usersData, expensesData, settingsData] = await Promise.all([
            apiFetch('/users'),
            apiFetch('/expenses/all'), 
            apiFetch('/settings'),
        ]);

        // Normalize expensesData (backend sometimes returns { expense: [...] } structure)
        const normalizedExpenses = Array.isArray(expensesData) ? expensesData : (expensesData.expense || []); 
        
        isReady = true;
        return { users: usersData, expenses: normalizedExpenses, settings: settingsData };

    } catch (error) {
        // DO NOT show modal here; handled by the retry loop in setupApp
        isReady = false;
        throw error; 
    }
}

// --- State Management ---

// Helper function for exponential backoff delay
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

/** Initializes the application or refreshes data */
async function setupApp() {
    showSpinner(true, 'Connecting to Backend...');

    const MAX_RETRIES = 5;
    let data = null;
    let success = false;

    for (let i = 0; i < MAX_RETRIES; i++) {
        try {
            data = await fetchAllData();
            success = true;
            break; 
        } catch (error) {
            console.warn(`Connection attempt ${i + 1} failed. Retrying in ${2 ** i}s...`);
            showSpinner(true, `Connecting to Backend... (Attempt ${i + 2}/${MAX_RETRIES})`);
            if (i < MAX_RETRIES - 1) {
                // Wait for an exponentially increasing delay
                await delay(2 ** i * 1000); 
            } else {
                // Last attempt failed
                showSpinner(false);
                showModal('Connection Error', `Could not connect to the backend server at ${API_BASE_URL} after ${MAX_RETRIES} attempts. Please ensure 'npm start' is running and MongoDB is connected.`, [{ text: 'Reload', isPrimary: true, callback: () => window.location.reload() }]);
                return;
            }
        }
    }

    if (!success || !data) {
        showSpinner(false);
        return;
    }

    // Update Global State with fetched data
    allUsers = data.users;
    allExpenses = data.expenses;
    companySettings = data.settings;

    // Attempt to retrieve a stored user session ID (simulated session persistence)
    const storedUserId = localStorage.getItem('userId');
    
    // Set current user based on session
    if (storedUserId) {
        currentUser = allUsers.find(u => u.id === storedUserId);
        if (!currentUser) {
            // Stored ID is invalid, clear session
            localStorage.removeItem('userId');
        }
    }
    
    // --- Rendering Decision ---
    
    // Check if the initial company admin needs to be created
    if (allUsers.length === 0) {
        showModal('First Time Setup', 'Welcome to Expensify! Please sign up to create your first **Admin** account to manage the system.', [
            { text: 'Go to Signup', isPrimary: true, callback: () => { 
                authMode = 'signup'; 
                renderAuthView(); 
            }}
        ]);
        return;
    }
    
    // Final UI Render based on state
    if (currentUser) {
        // Re-sync current user in case their role/manager changed
        const updatedUser = allUsers.find(u => u.id === currentUser.id);
        if (updatedUser) {
            currentUser = updatedUser;
        }
        updateAuthenticatedUI(currentUser.role);
    } else {
        renderAuthView();
    }
}

/** Updates the global state variables and refreshes UI components */
function updateState() {
    // This function is now mainly used by sign-in/out and action handlers to trigger UI refresh.
    if (!currentUser) {
        renderAuthView();
        return;
    }
    
    // Re-sync current user in case their role/manager changed
    const updatedUser = allUsers.find(u => u.id === currentUser.id);
    if (updatedUser) {
        currentUser = updatedUser;
    }

    renderUserSelector(); 
    updateAuthenticatedUI(currentUser.role);
}

/** Function to simulate user switching (for easy testing) */
window.switchUser = (newUserId) => {
    const userToSwitch = allUsers.find(u => u.id === newUserId);
    if (userToSwitch) {
        currentUser = userToSwitch;
        localStorage.setItem('userId', currentUser.id);
        updateState();
        renderView('home');
    }
};

/** Sign out and clear session */
window.signOutApp = () => {
    localStorage.removeItem('userId');
    currentUser = null;
    updateState();
    renderAuthView();
    // In a real app, this would involve a backend token invalidation
};

// --- Utility Functions ---

/** Shows a custom modal */
function showModal(title, message, actions) {
    const modalContainer = document.getElementById('modal-container');
    const modal = document.getElementById('custom-modal');
    const actionsDiv = document.getElementById('modal-actions');

    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-message').innerHTML = message;
    actionsDiv.innerHTML = '';
    
    actions.forEach(action => {
        const button = document.createElement('button');
        button.textContent = action.text;
        
        let classes = action.style || 'py-2 px-4 rounded-lg font-semibold transition duration-150';
        classes += ' ' + (action.isPrimary 
            ? 'bg-primary hover:bg-emerald-600 text-white shadow-md shadow-primary/50' 
            : 'bg-gray-600 hover:bg-gray-700 text-white');
        
        button.className = classes; 
        
        button.onclick = () => {
            modalContainer.classList.add('hidden');
            modal.classList.remove('scale-100', 'opacity-100');
            if (action.callback) action.callback();
        };
        actionsDiv.appendChild(button);
    });

    modalContainer.classList.remove('hidden');
    modalContainer.classList.add('flex');
    setTimeout(() => {
        modal.classList.add('scale-100', 'opacity-100');
        modal.classList.remove('scale-95', 'opacity-0');
    }, 10);
}

/** Formats a number into the company's base currency format */
function formatCurrency(amount, currencyCode = companySettings?.baseCurrency || 'USD') {
    try {
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: currencyCode,
            minimumFractionDigits: 2,
        }).format(amount);
    } catch (e) {
        return `${currencyCode} ${amount.toFixed(2)}`;
    }
}

/** Mocks the OCR API call */
async function mockOCRScan(file) {
    showSpinner(true, 'Scanning receipt with OCR...');
    await new Promise(resolve => setTimeout(resolve, 1000)); 
    showSpinner(false);
    
    if (!file || file.size === 0) {
        showModal('Error', 'Please upload a valid receipt image.', [{ text: 'Close', isPrimary: true }]);
        return null;
    }

    // Mock data extraction 
    const mockData = {
        amount: Math.round(Math.random() * 500) + 50,
        currency: ['EUR', 'GBP', 'INR', 'USD'][Math.floor(Math.random() * 4)],
        description: `OCR Scan: ${file.name}`,
        category: EXPENSE_CATEGORIES[Math.floor(Math.random() * EXPENSE_CATEGORIES.length)],
        date: new Date().toISOString().substring(0, 10),
        vendor: ['Starbucks', 'Amazon AWS', 'Conrad Hotel', 'Local Cafe'][Math.floor(Math.random() * 4)],
    };
    
    return mockData;
}

/** Display/Hide the loading spinner */
function showSpinner(show, message = 'Loading...') {
    const spinner = document.getElementById('loading-spinner');
    const messageElement = spinner.querySelector('p');
    messageElement.textContent = message;
    spinner.classList.toggle('hidden', !show);
    spinner.classList.toggle('flex', show);
}

function getManagerName(managerId) {
    const manager = allUsers.find(u => u.id === managerId);
    return manager ? manager.name : 'N/A (No Manager)';
}


// --- Authentication UI Logic ---

window.handleSignup = async (e) => {
    e.preventDefault();
    const form = document.getElementById('auth-form');
    const name = form.elements['name'].value;
    const email = form.elements['email'].value;
    const password = form.elements['password'].value;
    // Role is now explicitly 'Admin' from the hidden input field in renderAuthView
    const role = 'Admin';

    
    showSpinner(true, 'Creating account...');
    try {
        // Since this is the initial setup, we send role: Admin
        await apiFetch('/auth/signup', { method: 'POST', body: JSON.stringify({ name, email, password, role }) });
        
        showSpinner(false);
        showModal('Signup Successful!', `Account created successfully as **${role}**. Please log in now.`, [{ text: 'Go to Login', isPrimary: true, callback: () => window.toggleAuthMode('login') }]);
        form.reset();
        await setupApp(); // Re-fetch user list and settings

    } catch (error) {
        showSpinner(false);
        showModal('Signup Error', error.message, [{ text: 'OK', isPrimary: true }]);
    }
};

window.handleLogin = async (e) => {
    e.preventDefault();
    const form = document.getElementById('auth-form');
    const email = form.elements['email'].value;
    const password = form.elements['password'].value;

    showSpinner(true, 'Logging in...');
    try {
        const result = await apiFetch('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
        
        // FIX 1: Fetch all data again to ensure the global 'allUsers' list is up-to-date 
        // with the user that was just authenticated.
        const data = await fetchAllData(); 
        allUsers = data.users;
        allExpenses = data.expenses;
        companySettings = data.settings;
        
        // Set the current user from the now-fresh global list
        currentUser = allUsers.find(u => u.email === result.user.email); 
        
        if (!currentUser) {
            throw new Error("User data mismatch after login.");
        }

        localStorage.setItem('userId', currentUser.id);
        
        showSpinner(false);
        showModal('Login Successful!', `Welcome back, **${currentUser.name}**! You are logged in as **${currentUser.role}**.`, [{ text: 'Go to Dashboard', isPrimary: true }]);
        
        // Final UI render
        updateAuthenticatedUI(currentUser.role);
        
    } catch (error) {
        showSpinner(false);
        showModal('Login Failed', error.message, [{ text: 'Try Again', isPrimary: true }]);
    }
};

window.toggleAuthMode = (mode) => {
    authMode = mode;
    renderAuthView();
};

function renderAuthView() {
    showSpinner(false); 
    document.getElementById('sidebar').classList.add('hidden');
    const isLogin = authMode === 'login';
    
    const authContent = `
        <div class="flex items-center justify-center min-h-screen-minus-padding">
            <div class="card p-8 md:p-10 rounded-xl shadow-main w-full max-w-md">
                <h1 class="text-3xl font-bold mb-2 text-center text-accent-gold">${isLogin ? 'Log In' : 'Sign Up'}</h1>
                <p class="text-gray-400 mb-8 text-center">${isLogin ? 'Access your expense management system.' : 'Register as the initial Admin.'}</p>
                
                <form id="auth-form" onsubmit="window.handle${isLogin ? 'Login' : 'Signup'}(event)">
                    ${!isLogin ? `
                        <div class="mb-4">
                            <label for="name" class="block text-sm font-medium text-gray-300 mb-1">Full Name</label>
                            <input type="text" id="name" required class="w-full p-3 rounded-lg bg-slate-700 border-gray-600 text-white focus:ring-primary focus:border-primary">
                        </div>
                    ` : ''}

                    <div class="mb-4">
                        <label for="email" class="block text-sm font-medium text-gray-300 mb-1">Email</label>
                        <input type="email" id="email" required class="w-full p-3 rounded-lg bg-slate-700 border-gray-600 text-white focus:ring-primary focus:border-primary">
                    </div>

                    <div class="mb-6">
                        <label for="password" class="block text-sm font-medium text-gray-300 mb-1">Password</label>
                        <input type="password" id="password" required class="w-full p-3 rounded-lg bg-slate-700 border-gray-600 text-white focus:ring-primary focus:border-primary">
                    </div>
                    
                    ${!isLogin ? `
                        <!-- Hidden input for Admin role, enforcing policy -->
                        <input type="hidden" id="role" name="role" value="Admin">
                        <p class="text-sm text-gray-400 mb-4 text-center">**You will be registered as the Admin.**</p>
                    ` : ''}

                    <button type="submit" class="w-full py-3 bg-primary hover:bg-emerald-600 text-white text-lg font-semibold rounded-lg transition duration-150 shadow-md shadow-primary/50">
                        ${isLogin ? 'Login' : 'Sign Up'}
                    </button>
                </form>

                <p class="text-center text-sm mt-6 text-gray-400">
                    ${isLogin ? "Don't have an account?" : "Already registered?"}
                    <button onclick="window.toggleAuthMode('${isLogin ? 'signup' : 'login'}')" class="text-primary hover:text-emerald-400 font-semibold ml-1">
                        ${isLogin ? 'Sign Up' : 'Log In'}
                    </button>
                </p>
            </div>
        </div>
    `;
    document.getElementById('main-content').innerHTML = authContent;
}


// --- UI Renderers ---

function renderUserSelector() {
    const selectEl = document.getElementById('current-user-select');
    if (!selectEl) return; 

    selectEl.onchange = (e) => window.switchUser(e.target.value);
    
    // Only show user selector if multiple users exist (for testing convenience)
    if (allUsers.length > 1) {
        document.getElementById('user-selector').classList.remove('hidden');
        selectEl.innerHTML = allUsers.map(u => 
            `<option value="${u.id}" ${u.id === currentUser.id ? 'selected' : ''}>${u.name} (${u.role})</option>`
        ).join('');
    } else {
        document.getElementById('user-selector').classList.add('hidden');
    }
}

function updateAuthenticatedUI(role) {
    showSpinner(false);
    document.getElementById('sidebar').classList.remove('hidden');
    document.getElementById('user-role-display').textContent = role;
    document.getElementById('user-id-display').textContent = currentUser.id.substring(0, 8);
    
    let navHtml = '';
    if (role === 'Admin') {
        navHtml = `
            <div class="nav-item active" id="nav-home" onclick="window.renderView('home')"><i class="ph-gauge text-xl mr-3"></i> Admin Dashboard</div>
            <div class="nav-item" id="nav-users" onclick="window.renderView('users')"><i class="ph-users text-xl mr-3"></i> User Management</div>
            <div class="nav-item" id="nav-rules" onclick="window.renderView('rules')"><i class="ph-gear-six text-xl mr-3"></i> Approval Rules</div>
            <div class="nav-item" id="nav-expenses" onclick="window.renderView('history')"><i class="ph-wallet text-xl mr-3"></i> All Expenses</div>
        `;
    } else if (role === 'Manager') {
        navHtml = `
            <div class="nav-item active" id="nav-home" onclick="window.renderView('home')"><i class="ph-house text-xl mr-3"></i> Manager Dashboard</div>
            <div class="nav-item" id="nav-approvals" onclick="window.renderView('approvals')"><i class="ph-bell-ringing text-xl mr-3"></i> Pending Approvals</div>
            <div class="nav-item" id="nav-team" onclick="window.renderView('team')"><i class="ph-users-three text-xl mr-3"></i> Team Expenses</div>
        `;
    } else if (role === 'Employee') {
        navHtml = `
            <div class="nav-item active" id="nav-home" onclick="window.renderView('home')"><i class="ph-house text-xl mr-3"></i> Employee Dashboard</div>
            <div class="nav-item" id="nav-submit" onclick="window.renderView('submit')"><i class="ph-paper-plane-tilt text-xl mr-3"></i> Submit Expense</div>
            <div class="nav-item" id="nav-history" onclick="window.renderView('history')"><i class="ph-clock-counter-clockwise text-xl mr-3"></i> Expense History</div>
        `;
    }
    
    document.getElementById('nav-container').innerHTML = navHtml;
    window.renderView(currentView === 'home' ? 'home' : currentView); 
}

/** General purpose function to render a view */
window.renderView = (viewName) => {
    if (!currentUser) return;
    currentView = viewName;
    
    document.getElementById('main-content').innerHTML = '';
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    document.getElementById(`nav-${viewName}`)?.classList.add('active');

    let content = '';
    switch (currentUser.role) {
        case 'Admin':
            if (viewName === 'users') { content = renderUserManagement(); }
            else if (viewName === 'rules') { content = renderApprovalRulesConfig(); }
            else if (viewName === 'history') { content = renderAllExpensesHistory(); }
            else { content = renderAdminDashboard(); }
            break;
        case 'Manager':
            if (viewName === 'approvals') { content = renderPendingApprovals(); }
            else if (viewName === 'team') { content = renderTeamExpenses(); }
            else { content = renderManagerDashboard(); }
            break;
        case 'Employee':
            if (viewName === 'submit') { content = renderExpenseSubmissionForm(); }
            else if (viewName === 'history') { content = renderEmployeeHistory(); }
            else { content = renderEmployeeDashboard(); }
            break;
    }
    document.getElementById('main-content').innerHTML = content;
    attachViewEventListeners(viewName);
};

// --- Employee Dashboard Implementation ---

function renderEmployeeDashboard() {
    const myExpenses = allExpenses.filter(e => e.userId === currentUser.id);
    const pendingCount = myExpenses.filter(e => e.status === 'Pending').length;
    const approvedCount = myExpenses.filter(e => e.status === 'Approved').length;
    
    const totalClaimed = myExpenses.reduce((sum, exp) => sum + (exp.baseAmount || 0), 0);
    const totalApproved = myExpenses
        .filter(e => e.status === 'Approved')
        .reduce((sum, exp) => sum + (exp.baseAmount || 0), 0);

    return `
        <h1 class="text-3xl font-bold mb-8 text-primary">👋 Welcome, ${currentUser.name}</h1>
        
        <div class="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
            <div class="card p-6 rounded-xl shadow-main flex items-center justify-between">
                <div>
                    <p class="text-sm text-gray-400">Claims Pending Your Manager</p>
                    <p class="text-3xl font-extrabold text-yellow-400">${pendingCount}</p>
                </div>
                <i class="ph-hourglass text-4xl text-yellow-500 opacity-50"></i>
            </div>
            <div class="card p-6 rounded-xl shadow-main flex items-center justify-between">
                <div>
                    <p class="text-sm text-gray-400">Total Approved Claims (YTD)</p>
                    <p class="text-xl font-extrabold text-primary">${formatCurrency(totalApproved, companySettings.baseCurrency)}</p>
                </div>
                <i class="ph-check-circle text-4xl text-primary opacity-50"></i>
            </div>
            <div class="card p-6 rounded-xl shadow-main cursor-pointer hover:bg-slate-700 transition" onclick="window.renderView('submit')">
                <p class="text-lg font-semibold text-accent-gold">Submit New Expense</p>
                <p class="text-sm text-gray-400">Click here to start a new claim quickly.</p>
                <i class="ph-paper-plane-tilt text-2xl text-accent-gold mt-2"></i>
            </div>
        </div>
        
        <h2 class="text-2xl font-bold mb-4 text-white">Your Recent Activity</h2>
        ${renderExpenseList(myExpenses.slice(0, 5), 'Recent Submissions', false)}
    `;
}

// --- Shared Expense Rendering ---

function renderExpenseList(expenses, title, showActions = false) {
    const expenseRows = expenses.map(exp => {
        const submitter = allUsers.find(u => u.id === exp.userId)?.name || exp.userId;
        
        const currentStep = exp.approvalChain[exp.currentApproverIndex];
        const currentApprover = currentStep ? allUsers.find(u => u.id === currentStep.approverId)?.name || 'N/A' : 'N/A';
        
        let statusColor = 'bg-gray-500';
        if (exp.status === 'Approved') statusColor = 'bg-primary';
        else if (exp.status === 'Rejected') statusColor = 'bg-red-500';
        else if (exp.status === 'Pending') statusColor = 'bg-yellow-500';

        const actions = showActions && exp.status === 'Pending' && currentStep?.approverId === currentUser.id
            ? `
            <div class="flex space-x-2">
                <button onclick="window.handleApprovalAction('${exp.id}', 'Approved')" class="bg-primary text-white py-1 px-3 rounded-full text-xs font-semibold hover:bg-emerald-600 transition shadow-sm">Approve</button>
                <button onclick="window.handleApprovalAction('${exp.id}', 'Rejected')" class="bg-red-500 text-white py-1 px-3 rounded-full text-xs font-semibold hover:bg-red-600 transition shadow-sm">Reject</button>
            </div>
            `
            : '<span class="text-gray-400 text-xs">View Details</span>'; // Changed to View Details

        // FIX: Adjusted table row structure and styling for better visual appeal
        return `
            <tr class="border-b border-slate-700 hover:bg-slate-700 transition cursor-pointer" onclick="window.renderViewDetails('${exp.id}')">
                <td class="p-3 text-sm font-medium">${exp.id.substring(0, 8)}</td>
                <td class="p-3 text-sm">${submitter}</td>
                <td class="p-3 text-sm text-center">
                    <span class="inline-block py-1 px-3 text-xs font-semibold rounded-full ${statusColor} text-white min-w-[70px]">
                        ${exp.status}
                    </span>
                </td>
                <td class="p-3 text-sm">${exp.category}</td>
                <td class="p-3 text-sm font-semibold">${formatCurrency(exp.baseAmount, companySettings.baseCurrency)}</td>
                <td class="p-3 text-sm text-yellow-400">
                    ${exp.status === 'Pending' ? `Step ${exp.currentApproverIndex + 1}: ${currentApprover}` : 'Final'}
                </td>
                <td class="p-3 text-sm">
                    ${showActions ? actions : `<button onclick="window.renderViewDetails('${exp.id}')" class="text-primary hover:text-emerald-400 text-sm">Details</button>`}
                </td>
            </tr>
        `;
    }).join('');

    return `
        <div class="card p-6 rounded-xl shadow-main">
            <h2 class="text-2xl font-bold mb-6">${title} (${expenses.length})</h2>
            ${expenses.length === 0 ? '<p class="text-gray-400 text-center py-8">No expenses found.</p>' : `
                <div class="overflow-x-auto">
                    <table class="min-w-full divide-y divide-slate-700">
                        <thead>
                            <tr class="text-left text-gray-400 uppercase text-xs font-semibold tracking-wider bg-slate-700">
                                <th class="p-3">ID</th>
                                <th class="p-3">Submitter</th>
                                <th class="p-3 text-center">Status</th>
                                <th class="p-3">Category</th>
                                <th class="p-3">Amount (${companySettings.baseCurrency})</th>
                                <th class="p-3">Next Approver</th>
                                <th class="p-3">Action</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-slate-700">
                            ${expenseRows}
                        </tbody>
                    </table>
                </div>
            `}
        </div>
    `;
}

// --- Employee Views ---

function renderEmployeeHistory() {
    const employeeExpenses = allExpenses
        .filter(e => e.userId === currentUser.id)
        .sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));
    
    return `
        <h1 class="text-3xl font-bold mb-8 text-primary">My Expense History</h1>
        ${renderExpenseList(employeeExpenses, 'All My Claims')}
    `;
}

function renderExpenseSubmissionForm() {
    const currencyOptions = MOCK_CURRENCIES.map(c => 
        `<option value="${c.code}">${c.code} (${c.symbol}) - ${c.name}</option>`
    ).join('');
    
    const categoryOptions = EXPENSE_CATEGORIES.map(cat => 
        `<option value="${cat}">${cat}</option>`
    ).join('');

    return `
        <h1 class="text-3xl font-bold mb-8 text-primary">💸 Submit New Expense Claim</h1>
        <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <!-- OCR Upload Card -->
            <div class="card p-6 rounded-xl shadow-main lg:col-span-1 h-fit sticky top-0">
                <h2 class="text-xl font-semibold mb-4 text-accent-gold">OCR Receipt Scan</h2>
                <p class="text-sm text-gray-400 mb-4">Upload a receipt image and let AI auto-fill the form fields.</p>
                <input type="file" id="receipt-upload" accept="image/*" class="w-full text-sm text-gray-300 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-emerald-50 file:text-primary hover:file:bg-emerald-100 transition duration-150">
                <button id="scan-receipt-btn" class="mt-4 w-full py-2 bg-yellow-600 hover:bg-yellow-700 text-white font-semibold rounded-lg transition duration-150 shadow-md shadow-yellow-700/50">
                    Scan and Autofill
                </button>
                <div id="ocr-preview" class="mt-4 hidden text-sm text-gray-300"></div>
            </div>

            <!-- Manual Submission Form -->
            <div class="card p-8 rounded-xl shadow-main lg:col-span-2">
                <h2 class="text-xl font-semibold mb-6">Claim Details</h2>
                <form id="expense-form" onsubmit="event.preventDefault(); window.submitExpense();">
                    <!-- Amount and Currency -->
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                        <div>
                            <label for="amount" class="block text-sm font-medium text-gray-300 mb-1">Amount</label>
                            <input type="number" id="amount" step="0.01" required placeholder="123.45" class="w-full p-3 rounded-lg bg-slate-700 border-gray-600 text-white focus:ring-primary focus:border-primary">
                        </div>
                        <div>
                            <label for="currency" class="block text-sm font-medium text-gray-300 mb-1">Currency</label>
                            <select id="currency" required class="w-full p-3 rounded-lg bg-slate-700 border-gray-600 text-white focus:ring-primary focus:border-primary">
                                ${currencyOptions}
                            </select>
                        </div>
                    </div>
                    
                    <!-- Date and Category -->
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                        <div>
                            <label for="date" class="block text-sm font-medium text-gray-300 mb-1">Date of Expense</label>
                            <input type="date" id="date" required value="${new Date().toISOString().substring(0, 10)}" class="w-full p-3 rounded-lg bg-slate-700 border-gray-600 text-white focus:ring-primary focus:border-primary">
                        </div>
                        <div>
                            <label for="category" class="block text-sm font-medium text-gray-300 mb-1">Category</label>
                            <select id="category" required class="w-full p-3 rounded-lg bg-slate-700 border-gray-600 text-white focus:ring-primary focus:border-primary">
                                ${categoryOptions}
                            </select>
                        </div>
                    </div>

                    <!-- Description -->
                    <div class="mb-4">
                        <label for="description" class="block text-sm font-medium text-gray-300 mb-1">Description</label>
                        <textarea id="description" required rows="3" placeholder="Brief explanation of the expense..." class="w-full p-3 rounded-lg bg-slate-700 border-gray-600 text-white focus:ring-primary focus:border-primary"></textarea>
                    </div>
                    
                    <!-- Receipt URL (optional, used if OCR data is mocked) -->
                    <div class="mb-6">
                        <label for="receipt-url" class="block text-sm font-medium text-gray-300 mb-1">Receipt/Vendor (Optional)</label>
                        <input type="text" id="receipt-url" placeholder="e.g., https://receipt.img/123" class="w-full p-3 rounded-lg bg-slate-700 border-gray-600 text-white focus:ring-primary focus:border-primary">
                    </div>

                    <button type="submit" class="w-full py-3 bg-primary hover:bg-emerald-600 text-white text-lg font-semibold rounded-lg transition duration-150 shadow-md shadow-primary/50">
                        Submit Expense Claim
                    </button>
                </form>
            </div>
        </div>
    `;
}

// --- Manager Views ---

async function fetchManagerData() {
    const [pending, team] = await Promise.all([
        apiFetch(`/expenses/pending/${currentUser.id}`),
        apiFetch(`/expenses/team/${currentUser.id}`)
    ]);
    return { pending, team };
}

function renderManagerDashboard() {
    const myTeam = allUsers.filter(u => u.managerId === currentUser.id);
    
    // Fetch and display dynamic data asynchronously
    const content = `
        <h1 class="text-3xl font-bold mb-8 text-primary">🛠️ Manager Dashboard</h1>
        <p class="text-lg text-gray-300 mb-6">Welcome, ${currentUser.name}. You manage ${myTeam.length} employees.</p>
        
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8" id="manager-stats-container">
            <!-- Team Size -->
            <div class="card p-6 rounded-xl shadow-main flex items-center justify-between">
                <div>
                    <p class="text-sm text-gray-400">Team Size</p>
                    <p class="text-3xl font-extrabold text-blue-400">${myTeam.length}</p>
                </div>
                <i class="ph-users text-4xl text-blue-500 opacity-50"></i>
            </div>
            <!-- Pending Actions (Placeholder for dynamic content) -->
            <div class="card p-6 rounded-xl shadow-main flex items-center justify-between">
                <div>
                    <p class="text-sm text-gray-400">Pending Actions</p>
                    <p class="text-3xl font-extrabold text-yellow-400" id="pending-count-display">...</p>
                </div>
                <i class="ph-bell text-4xl text-yellow-500 opacity-50"></i>
            </div>
            <!-- Action Card -->
            <div class="card p-6 rounded-xl shadow-main cursor-pointer hover:bg-slate-700 transition" onclick="window.renderView('approvals')">
                <p class="text-lg font-semibold text-accent-gold">Review Approvals</p>
                <p class="text-sm text-gray-400">Address pending expense claims.</p>
                <i class="ph-arrow-right-circle text-2xl text-accent-gold mt-2"></i>
            </div>
        </div>

        <div id="manager-recent-approvals">
            <h2 class="text-2xl font-bold mb-4 text-white">Recent Team Activity (Loading...)</h2>
        </div>
    `;

    // Fetch and render dynamic content
    fetchManagerData().then(({ pending, team }) => {
        document.getElementById('pending-count-display').textContent = pending.length;
        
        const recentActivityContent = `
            <h2 class="text-2xl font-bold mb-4 text-white">Recent Team Activity</h2>
            ${renderExpenseList(team.slice(0, 5), 'Recent Team Expenses', false)}
        `;
        document.getElementById('manager-recent-approvals').innerHTML = recentActivityContent;
    }).catch(e => {
        document.getElementById('pending-count-display').textContent = 'Error';
        console.error("Failed to load manager data:", e);
    });

    return content;
}

function renderPendingApprovals() {
    // We fetch the data on load here, instead of relying on global state, to ensure freshness.
    const containerId = 'pending-approvals-list';
    
    // Initial loading state
    const content = `
        <h1 class="text-3xl font-bold mb-8 text-primary">🔔 Expenses Awaiting My Approval</h1>
        <div id="${containerId}" class="card p-6 rounded-xl shadow-main">
            <p class="text-center text-gray-400 py-8">Loading pending approvals...</p>
        </div>
    `;

    fetchManagerData().then(({ pending }) => {
        document.getElementById(containerId).outerHTML = renderExpenseList(pending, 'Pending Approval Queue', true);
    }).catch(e => {
        document.getElementById(containerId).innerHTML = `<p class="text-center text-red-400 py-8">Failed to load approvals: ${e.message}</p>`;
        console.error("Failed to load pending approvals:", e);
    });
    
    return content;
}

function renderTeamExpenses() {
    const containerId = 'team-expenses-list';
    
    // Initial loading state
    const content = `
        <h1 class="text-3xl font-bold mb-8 text-primary">👥 My Team's Expense History</h1>
        <div id="${containerId}" class="card p-6 rounded-xl shadow-main">
            <p class="text-center text-gray-400 py-8">Loading team expenses...</p>
        </div>
    `;
    
    apiFetch(`/expenses/team/${currentUser.id}`).then((teamExpenses) => {
        document.getElementById(containerId).outerHTML = renderExpenseList(teamExpenses, 'All Team Claims', false);
    }).catch(e => {
        document.getElementById(containerId).innerHTML = `<p class="text-center text-red-400 py-8">Failed to load team expenses: ${e.message}</p>`;
        console.error("Failed to load team expenses:", e);
    });

    return content;
}

// --- Admin Views ---

async function fetchAdminData() {
    const [allUsersData, allExpensesData] = await Promise.all([
        apiFetch('/users'),
        apiFetch('/expenses/all')
    ]);
    return { allUsersData, allExpensesData: allExpensesData.expense ? [allExpensesData.expense] : allExpensesData };
}

function renderAdminDashboard() {
    const totalExpenses = allExpenses.length;
    const totalUsers = allUsers.length;
    const totalPending = allExpenses.filter(e => e.status === 'Pending').length;
    
    return `
        <h1 class="text-3xl font-bold mb-8 text-primary">👑 Admin Control Panel</h1>
        <p class="text-lg text-gray-300 mb-6">Welcome, ${currentUser.name}. You have full system control.</p>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
            <div class="card p-6 rounded-xl shadow-main flex items-center justify-between">
                <div>
                    <p class="text-sm text-gray-400">Total Users</p>
                    <p class="text-3xl font-extrabold text-white">${totalUsers}</p>
                </div>
                <i class="ph-users-three text-4xl text-white opacity-50"></i>
            </div>
            <div class="card p-6 rounded-xl shadow-main flex items-center justify-between">
                <div>
                    <p class="text-sm text-gray-400">Total Expenses</p>
                    <p class="text-3xl font-extrabold text-blue-400">${totalExpenses}</p>
                </div>
                <i class="ph-wallet text-4xl text-blue-500 opacity-50"></i>
            </div>
            <div class="card p-6 rounded-xl shadow-main flex items-center justify-between">
                <div>
                    <p class="text-sm text-gray-400">Pending Global</p>
                    <p class="text-3xl font-extrabold text-yellow-400">${totalPending}</p>
                </div>
                <i class="ph-warning text-4xl text-yellow-500 opacity-50"></i>
            </div>
        </div>
        ${renderExpenseList(allExpenses.sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt)).slice(0, 10), 'Recent Global Activity')}
    `;
}

function renderAllExpensesHistory() {
    const allExpensesSorted = allExpenses.sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));
    
    return `
        <h1 class="text-3xl font-bold mb-8 text-primary">Global Expense History</h1>
        ${renderExpenseList(allExpensesSorted, 'All Company Claims', false)}
    `;
}

// Function definitions for other admin pages (User Management, Rules Config, etc.)
// These functions are critical for the application's full feature set.

function renderUserManagement() {
    const userRows = allUsers.map(user => {
        const managerName = user.managerId ? getManagerName(user.managerId) : 'N/A';
        return `
            <tr class="border-b border-slate-700 hover:bg-slate-700 transition">
                <td class="p-3 text-sm font-medium">${user.name}</td>
                <td class="p-3 text-sm text-yellow-400">${user.role}</td>
                <td class="p-3 text-sm">${managerName}</td>
                <td class="p-3 text-sm flex space-x-2">
                    <button onclick="window.openUserEditModal('${user.id}')" class="text-blue-400 hover:text-blue-300 text-sm font-semibold">Edit</button>
                    ${user.id !== currentUser.id ? 
                        `<button onclick="window.confirmDeleteUser('${user.id}', '${user.name}')" class="text-red-400 hover:text-red-300 text-sm font-semibold">Delete</button>` 
                        : `<span class="text-gray-500 text-sm">Self</span>`
                    }
                </td>
            </tr>
        `;
    }).join('');

    return `
        <h1 class="text-3xl font-bold mb-8 text-primary">👥 User and Role Management</h1>
        <!-- Button to create a new employee -->
        <div class="mb-6 flex justify-end">
            <button onclick="window.openNewEmployeeModal()" class="bg-primary hover:bg-emerald-600 text-white py-2 px-4 rounded-lg font-semibold flex items-center transition duration-150 shadow-md shadow-primary/50">
                <i class="ph-user-plus mr-2"></i> Create User
            </button>
        </div>
        <div class="card p-6 rounded-xl shadow-main">
            <div class="overflow-x-auto">
                <table class="min-w-full divide-y divide-slate-700">
                    <thead>
                        <tr class="text-left text-gray-400 uppercase text-xs font-semibold tracking-wider bg-slate-700">
                            <th class="p-3">Name</th>
                            <th class="p-3">Role</th>
                            <th class="p-3">Manager</th>
                            <th class="p-3">Actions</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-slate-700" id="user-table-body">
                        ${userRows}
                    </tbody>
                </table>
            </div>
        </div>
    `;
}

window.openUserEditModal = (targetUserId) => {
    const user = allUsers.find(u => u.id === targetUserId);
    if (!user) return;
    
    const roles = ['Employee', 'Manager', 'Admin'];
    const roleOptions = roles.map(r => 
        `<option value="${r}" ${user.role === r ? 'selected' : ''}>${r}</option>`
    ).join('');

    const managers = allUsers.filter(u => u.role === 'Manager' || u.role === 'Admin');
    const managerOptions = managers.map(m => 
        `<option value="${m.id}" ${user.managerId === m.id ? 'selected' : ''}>${m.name} (${m.role})</option>`
    ).join('');
    
    const modalContent = `
        <form id="edit-user-form">
            <div class="mb-4">
                <label class="block text-sm font-medium text-gray-300 mb-1">Role</label>
                <select id="edit-role" class="w-full p-3 rounded-lg bg-slate-700 text-white focus:ring-primary focus:border-primary">
                    ${roleOptions}
                </select>
            </div>
            <div class="mb-4">
                <label for="edit-password" class="block text-sm font-medium text-gray-300 mb-1">New Password (Leave blank to keep old)</label>
                <input type="password" id="edit-password" class="w-full p-3 rounded-lg bg-slate-700 border-gray-600 text-white focus:ring-primary focus:border-primary">
            </div>
            <div class="mb-6">
                <label class="block text-sm font-medium text-gray-300 mb-1">Assign Manager (Required for Employees)</label>
                <select id="edit-manager" class="w-full p-3 rounded-lg bg-slate-700 text-white focus:ring-primary focus:border-primary">
                    <option value="">-- No Manager --</option>
                    ${managerOptions}
                </select>
            </div>
        </form>
    `;

    showModal(`Edit User: ${user.name}`, modalContent, [
        { text: 'Cancel', style: 'bg-gray-600', isPrimary: false },
        { text: 'Save Changes', isPrimary: true, callback: async () => {
            const newRole = document.getElementById('edit-role').value;
            const newManagerId = document.getElementById('edit-manager').value || null;
            const newPassword = document.getElementById('edit-password').value; // Get the new password
            
            if (newRole === 'Employee' && !newManagerId) {
                showModal('Error', 'Employees must be assigned a manager.', [{ text: 'OK', isPrimary: true, callback: () => window.openUserEditModal(targetUserId) }]);
                return;
            }

            const updateData = { role: newRole, managerId: newManagerId };
            if (newPassword) {
                updateData.password = newPassword; // Include password if provided
            }
            
            showSpinner(true, 'Updating user role...');
            try {
                await apiFetch(`/users/${targetUserId}`, { 
                    method: 'PUT', 
                    body: JSON.stringify(updateData) 
                });
                showSpinner(false);
                showModal('Success', `User ${user.name}'s details were updated.`, [{ text: 'OK', isPrimary: true, callback: () => { setupApp(); renderView('users'); } }]);
            } catch (error) {
                showSpinner(false);
                showModal('Error', `Failed to update user: ${error.message}`, [{ text: 'Close', isPrimary: true }]);
            }
        }}
    ]);
};
        
window.openNewEmployeeModal = () => {
    const roles = ['Employee', 'Manager']; // Admin can create Employees and Managers
    const roleOptions = roles.map(r => `<option value="${r}">${r}</option>`).join('');

    const managers = allUsers.filter(u => u.role === 'Manager' || u.role === 'Admin');
    const managerOptions = managers.map(m => 
        `<option value="${m.id}">${m.name} (${m.role})</option>`
    ).join('');

    const modalContent = `
        <form id="create-employee-form">
             <div class="mb-4">
                <label class="block text-sm font-medium text-gray-300 mb-1">User Role</label>
                <select id="new-user-role" required class="w-full p-3 rounded-lg bg-slate-700 text-white focus:ring-primary focus:border-primary">
                    <option value="">-- Select Role --</option>
                    ${roleOptions}
                </select>
            </div>
            <div class="mb-4">
                <label class="block text-sm font-medium text-gray-300 mb-1">Full Name</label>
                <input type="text" id="new-user-name" required class="w-full p-3 rounded-lg bg-slate-700 text-white focus:ring-primary focus:border-primary">
            </div>
            <div class="mb-4">
                <label class="block text-sm font-medium text-gray-300 mb-1">Email</label>
                <input type="email" id="new-user-email" required class="w-full p-3 rounded-lg bg-slate-700 text-white focus:ring-primary focus:border-primary">
            </div>
            <div class="mb-4">
                <label class="block text-sm font-medium text-gray-300 mb-1">Password</label>
                <input type="password" id="new-user-password" required class="w-full p-3 rounded-lg bg-slate-700 text-white focus:ring-primary focus:border-primary">
            </div>
            <div class="mb-6">
                <label class="block text-sm font-medium text-gray-300 mb-1">Assign Manager (Required for Employees/Managers)</label>
                <select id="new-user-manager" required class="w-full p-3 rounded-lg bg-slate-700 text-white focus:ring-primary focus:border-primary">
                    <option value="">-- Select Manager --</option>
                    ${managerOptions}
                </select>
            </div>
        </form>
    `;

    showModal(`Create New User`, modalContent, [
        { text: 'Cancel', style: 'bg-gray-600', isPrimary: false },
        { text: 'Create User', isPrimary: true, callback: async () => {
            const name = document.getElementById('new-user-name').value;
            const email = document.getElementById('new-user-email').value;
            const password = document.getElementById('new-user-password').value;
            const managerId = document.getElementById('new-user-manager').value;
            const role = document.getElementById('new-user-role').value;
            
            if (!name || !email || !password || !managerId || !role) {
                 showModal('Error', 'Name, Email, Password, Role, and Manager are required.', [{ text: 'OK', isPrimary: true, callback: () => window.openNewEmployeeModal() }]);
                 return;
            }
            
            showSpinner(true, `Creating ${role}...`);
            try {
                // FIX 1: Add isAdminCreation flag to bypass the public signup check in the backend.
                await apiFetch('/auth/signup', { 
                    method: 'POST', 
                    body: JSON.stringify({ name, email, password, role, managerId, isAdminCreation: true }) 
                });
                showSpinner(false);
                showModal('Success', `New ${role} ${name} created.`, [{ text: 'OK', isPrimary: true, callback: () => { setupApp(); renderView('users'); } }]);
            } catch (error) {
                showSpinner(false);
                showModal('Error', `Failed to create user: ${error.message}`, [{ text: 'Close', isPrimary: true }]);
            }
        }}
    ]);
};

// FIX 2: Added function to confirm and delete a user
window.confirmDeleteUser = (userId, userName) => {
    showModal('Confirm Deletion', `Are you sure you want to delete the user **${userName}**? This action cannot be undone and will remove all associated expenses.`, [
        { text: 'Cancel', style: 'bg-gray-600', isPrimary: false },
        { text: 'Delete User', isPrimary: true, style: 'bg-red-600 hover:bg-red-700 text-white', callback: async () => {
            showSpinner(true, `Deleting user ${userName}...`);
            try {
                await apiFetch(`/users/${userId}`, { 
                    method: 'DELETE'
                });
                showSpinner(false);
                showModal('Success', `User ${userName} has been successfully deleted.`, [{ text: 'OK', isPrimary: true, callback: () => { setupApp(); renderView('users'); } }]);
            } catch (error) {
                showSpinner(false);
                showModal('Error', `Failed to delete user: ${error.message}`, [{ text: 'Close', isPrimary: true }]);
            }
        }}
    ]);
}

window.handleApprovalAction = (expenseId, action) => {
     const expense = allExpenses.find(e => e.id === expenseId);
     if (!expense) return;
     
     const submitterName = allUsers.find(u => u.id === expense.userId)?.name || 'Employee';
     const actionText = action === 'Approved' ? 'Approve' : 'Reject';
     
     const modalContent = `
        <form id="approval-comment-form">
            <p class="text-lg mb-4">Are you sure you want to <strong>${actionText}</strong> this claim of ${formatCurrency(expense.baseAmount, companySettings.baseCurrency)} submitted by ${submitterName}?</p>
            <label for="comment" class="block text-sm font-medium text-gray-300 mb-1">Comment (Optional for Approve, Required for Reject)</label>
            <textarea id="comment" rows="2" placeholder="Enter reason or comments..." class="w-full p-3 rounded-lg bg-slate-700 text-white focus:ring-primary focus:border-primary"></textarea>
        </form>
    `;
    
    showModal(`${actionText} Expense`, modalContent, [
        { text: 'Cancel', style: 'bg-gray-600', isPrimary: false },
        { text: actionText, isPrimary: true, callback: async () => {
            const comment = document.getElementById('comment').value;
            if (action === 'Rejected' && !comment.trim()) {
                showModal('Error', 'A rejection comment is required.', [{ text: 'OK', isPrimary: true, callback: () => window.handleApprovalAction(expenseId, action) }]);
                return;
            }
            
            showSpinner(true, `Submitting ${action} decision...`);
            try {
                await apiFetch(`/expenses/approve/${expenseId}`, {
                    method: 'PUT',
                    body: JSON.stringify({ action, comment, approverId: currentUser.id })
                });
                showSpinner(false);
                showModal('Decision Recorded', `The expense was successfully ${action}.`, [{ text: 'OK', isPrimary: true, callback: () => { setupApp(); renderView('approvals'); } }]);
            } catch (error) {
                showSpinner(false);
                showModal('Approval Error', `Failed to process decision: ${error.message}`, [{ text: 'Close', isPrimary: true }]);
            }
        }}
    ]);
};

window.handleSaveRules = async () => {
    const rules = {
        sequentialChain: companySettings.approvalRules.sequentialChain, // Retain fixed chain
        percentageRule: {
            enabled: document.getElementById('percentage-enabled').checked,
            threshold: parseInt(document.getElementById('percentage-threshold').value) || 0,
        },
        hybridRule: {
            enabled: document.getElementById('hybrid-enabled').checked,
            approverId: document.getElementById('hybrid-approver').value || null,
        }
    };

    if (rules.percentageRule.enabled && (rules.percentageRule.threshold < 1 || rules.percentageRule.threshold > 100)) {
        showModal('Validation Error', 'Percentage threshold must be between 1 and 100.', [{ text: 'OK', isPrimary: true }]);
        return;
    }
    if (rules.hybridRule.enabled && rules.hybridRule.enabled && !rules.hybridRule.approverId) {
        showModal('Validation Error', 'A specific approver must be selected if the hybrid rule is enabled.', [{ text: 'OK', isPrimary: true }]);
        return;
    }
    
    showSpinner(true, 'Saving approval rules...');
    try {
        await apiFetch('/settings', { 
            method: 'PUT', 
            body: JSON.stringify({ approvalRules: rules }) 
        });
        showSpinner(false);
        showModal('Rules Saved', 'The new sequential and conditional approval rules have been successfully saved.', [{ text: 'OK', isPrimary: true, callback: () => { setupApp(); renderView('rules'); } }]);
    } catch (error) {
        showSpinner(false);
        showModal('Error', `Failed to save rules: ${error.message}`, [{ text: 'Close', isPrimary: true }]);
    }
};


function attachViewEventListeners(viewName) {
    if (viewName === 'submit') {
        const scanBtn = document.getElementById('scan-receipt-btn');
        scanBtn.onclick = async () => {
            const fileInput = document.getElementById('receipt-upload');
            if (fileInput.files.length === 0) {
                showModal('Upload Required', 'Please select a file to scan first.', [{ text: 'OK', isPrimary: true }]);
                return;
            }
            const file = fileInput.files[0];
            const ocrData = await mockOCRScan(file);
            if (ocrData) {
                document.getElementById('amount').value = ocrData.amount;
                document.getElementById('currency').value = ocrData.currency;
                document.getElementById('date').value = ocrData.date;
                document.getElementById('category').value = ocrData.category;
                document.getElementById('description').value = `Vendor: ${ocrData.vendor || 'N/A'}. ${ocrData.description}`;
                document.getElementById('receipt-url').value = 'MOCK_OCR_SCANNED_FILE';
                
                document.getElementById('ocr-preview').innerHTML = `
                    <p class="text-green-400 font-semibold">Scan Complete! Data Autofilled:</p>
                    <ul class="list-disc list-inside ml-2">
                        <li>Amount: ${ocrData.amount} ${ocrData.currency}</li>
                        <li>Vendor: ${ocrData.vendor || 'N/A'}</li>
                        <li>Date: ${ocrData.date}</li>
                    </ul>
                `;
                document.getElementById('ocr-preview').classList.remove('hidden');
                showModal('OCR Success', 'Receipt data successfully extracted and autofilled into the form.', [{ text: 'OK', isPrimary: true }]);
            }
        };
    }
}


// --- Application Startup ---
setupApp();
