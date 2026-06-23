let transactionLogState = [];
const KIOSK_IDENTIFIER = 'AURORA-K101';

const form = document.getElementById('transaction-entry-form');
const bookInput = document.getElementById('book-title-input');
const patronInput = document.getElementById('patron-id-input');
const errorDiv = document.getElementById('validation-errors');
const notificationDiv = document.getElementById('status-notifications');

// Internal Audit Log Setup (Moved to top so it can be used everywhere)
let auditLogState = JSON.parse(localStorage.getItem('aurora_kiosk_audit_trail')) || [];
function logAudit(eventType, details) {
    auditLogState.push({ timestamp: new Date().toISOString(), eventType: eventType, details: details });
    localStorage.setItem('aurora_kiosk_audit_trail', JSON.stringify(auditLogState));
}

// PHASE 0: State Initialization
document.addEventListener('DOMContentLoaded', () => {
    const savedData = localStorage.getItem('aurora_kiosk_transactions');
    if (savedData) {
        try {
            transactionLogState = JSON.parse(savedData);
        } catch (error) {
            console.error("Data parse error", error);
            transactionLogState = [];
        }
    }
    
    // Log app loaded event
    logAudit('APP_LOADED', { message: 'Kiosk application started' }); 
    
    renderTransactionLogTable();
});

// PHASE 1: Form Handling & Validation
form.addEventListener('submit', async function(e) {
    e.preventDefault();
    
    errorDiv.innerHTML = '';
    notificationDiv.innerHTML = '';
    
    let bookTitle = bookInput.value.trim();
    let patronId = patronInput.value.trim();
    
    // Client-side Validation
    if (bookTitle.length < 3) {
        errorDiv.innerHTML = "Book Title min length is 3.";
        return; 
    }
    
    const patronRegex = /^P[0-9]{5}$/; 
    if (!patronRegex.test(patronId)) {
        errorDiv.innerHTML = "Invalid Patron ID. Format: P12345";
        return; 
    }

    errorDiv.innerHTML = "Validating Patron ID...";
    errorDiv.style.color = "blue";
    
    try {
        let cleanId = parseInt(patronId.substring(1), 10); 
        const response = await fetch(`https://jsonplaceholder.typicode.com/users?id=${cleanId}`);
        const users = await response.json();
        
        if (users.length === 0) {
            errorDiv.style.color = "red";
            errorDiv.innerHTML = "Patron ID not found or invalid. Please verify.";
            return; 
        }
        
        errorDiv.innerHTML = '';
        
        // Transaction Object Creation
        const newEntry = {
            transactionId: crypto.randomUUID(),
            kioskId: KIOSK_IDENTIFIER, 
            bookTitle: bookTitle, 
            patronId: patronId, 
            checkoutTimestamp: new Date().toISOString(),
            returnTimestamp: null, 
            syncStatus: 'PENDING',
            remoteTransactionId: null, 
            retryCount: 0 
        };
        
        transactionLogState.push(newEntry);
        localStorage.setItem('aurora_kiosk_transactions', JSON.stringify(transactionLogState));
        
        // NEW ADDITION: Log transaction submitted audit event
        logAudit('TRANSACTION_SUBMITTED', { transactionId: newEntry.transactionId, bookTitle: newEntry.bookTitle, patronId: newEntry.patronId });

        form.reset();
        notificationDiv.innerHTML = "Transaction Logged Successfully!";
        notificationDiv.style.color = "green";
        
        setTimeout(() => {
            notificationDiv.innerHTML = ""; 
        }, 4000);

        renderTransactionLogTable();

    } catch (err) {
        console.error("API error", err);
        errorDiv.style.color = "red";
        errorDiv.innerHTML = "Network error during validation.";
    }
});

// PHASE 2: Dynamic Reporting
function renderTransactionLogTable() {
    const tbody = document.getElementById('transaction-records-body');
    const footer = document.getElementById('summary-footer');
    
    tbody.innerHTML = ''; 
    
    let total = transactionLogState.length;
    let pendingCount = transactionLogState.filter(t => t.syncStatus === 'PENDING').length;
    let syncedCount = transactionLogState.filter(t => t.syncStatus === 'SYNCED').length;

    transactionLogState.forEach(transaction => {
        const tr = document.createElement('tr');
        
        let pillClass = 'pill-pending'; 
        if (transaction.syncStatus === 'SYNCED') pillClass = 'pill-synced';
        if (transaction.syncStatus === 'FAILED') pillClass = 'pill-failed';
        if (transaction.syncStatus === 'PENDING_RETURN_SYNC') pillClass = 'pill-returned';

        let dateObj = new Date(transaction.checkoutTimestamp);
        let formattedTime = `${dateObj.toLocaleDateString()} ${dateObj.toLocaleTimeString()}`;

        tr.innerHTML = `
            <td>${transaction.transactionId}</td> 
            <td>${transaction.bookTitle}</td>
            <td>${transaction.patronId}</td>
            <td>${formattedTime}</td>
            <td><span class="status-pill ${pillClass}">${transaction.syncStatus}</span></td>
            <td>
                <button class="remove-record-btn" data-transaction-id="${transaction.transactionId}">Remove</button>
                <button class="mark-returned-btn" data-transaction-id="${transaction.transactionId}" ${transaction.syncStatus !== 'SYNCED' ? 'disabled' : ''}>Mark Returned</button>
            </td>
        `;
        
        tbody.appendChild(tr);
    });

    footer.innerHTML = `
        <tr>
            <td colspan="6" style="text-align: center; font-weight: bold;">
                Total Transactions: ${total} | Pending Sync: ${pendingCount} | Synced: ${syncedCount}
            </td>
        </tr>
    `;
}

// Event Delegation for Table Actions
const recordsTable = document.getElementById('transaction-records-table');

recordsTable.addEventListener('click', function(e) {
    if (e.target.classList.contains('remove-record-btn')) {
        const transactionId = e.target.getAttribute('data-transaction-id');
        const isConfirmed = window.confirm("Are you sure you want to permanently remove this transaction? This action is irreversible offline and will not be synced.");
        
        if (isConfirmed) {
            transactionLogState = transactionLogState.filter(t => t.transactionId !== transactionId);
            localStorage.setItem('aurora_kiosk_transactions', JSON.stringify(transactionLogState));
            
            // NEW ADDITION: Log record deleted audit event
            logAudit('RECORD_DELETED', { transactionId: transactionId });

            renderTransactionLogTable();
        }
    }

    if (e.target.classList.contains('mark-returned-btn')) {
        const transactionId = e.target.getAttribute('data-transaction-id');
        let transaction = transactionLogState.find(t => t.transactionId === transactionId);
        
        if (transaction && transaction.syncStatus === 'SYNCED') {
            transaction.returnTimestamp = new Date().toISOString();
            transaction.syncStatus = 'PENDING_RETURN_SYNC';
            
            localStorage.setItem('aurora_kiosk_transactions', JSON.stringify(transactionLogState));
            renderTransactionLogTable();
        }
    }
});

// PHASE 3: Enterprise-Grade Synchronization & Audit Trails
const syncBtn = document.getElementById('sync-all-transactions-btn');
const offlineIndicator = document.getElementById('offline-indicator');
const lastSyncTimeSpan = document.getElementById('last-sync-time');

syncBtn.addEventListener('click', async () => {
    syncBtn.disabled = true; 
    syncBtn.innerText = "Syncing...";
    
    let pendingRecords = transactionLogState.filter(t => (t.syncStatus === 'PENDING' || t.syncStatus === 'FAILED') && t.retryCount < 3);
    
    let successCount = 0;
    let failCount = 0;

    logAudit('SYNC_INITIATED', { totalPending: pendingRecords.length });

    for (let record of pendingRecords) { 
        try {
            await new Promise(resolve => setTimeout(resolve, 500));

            let response = await fetch('https://jsonplaceholder.typicode.com/posts', {
                method: 'POST',
                body: JSON.stringify({ bookTitle: record.bookTitle, patronId: record.patronId }),
                headers: { 'Content-type': 'application/json; charset=UTF-8' },
            });

            if (response.ok) { 
                let data = await response.json();
                record.syncStatus = 'SYNCED';
                record.remoteTransactionId = data.id.toString();
                record.retryCount = 0;
                successCount++;
                logAudit('SYNC_RECORD_SUCCESS', { transactionId: record.transactionId });
            } else {
                throw new Error('Sync failed');
            }
        } catch (error) { 
            record.syncStatus = 'FAILED';
            record.retryCount++;
            failCount++;
            logAudit('SYNC_RECORD_FAILED', { transactionId: record.transactionId, error: error.message });
        }
    }

    syncBtn.disabled = false;
    syncBtn.innerText = "Sync Now";
    
    let now = new Date().toLocaleString();
    lastSyncTimeSpan.innerText = `Last Sync: ${now}`;
    
    localStorage.setItem('aurora_kiosk_transactions', JSON.stringify(transactionLogState));
    renderTransactionLogTable();

    notificationDiv.innerHTML = `Sync Complete: ${successCount} successful, ${failCount} failed.`;
    notificationDiv.style.color = successCount > 0 ? "green" : "red";
    setTimeout(() => notificationDiv.innerHTML = "", 5000);
});

// Offline Status Indicator
window.addEventListener('online', () => {
    offlineIndicator.innerText = "ONLINE";
    offlineIndicator.style.color = "green"; 
    syncBtn.disabled = false;
    syncBtn.title = "";
});

window.addEventListener('offline', () => {
    offlineIndicator.innerText = "OFFLINE";
    offlineIndicator.style.color = "red"; 
    syncBtn.disabled = true;
    syncBtn.title = "System Offline - Sync Unavailable";
});

// Book Title Auto-Suggestion
const suggestionsDropdown = document.getElementById('book-suggestions-dropdown');
let debounceTimer;

bookInput.addEventListener('input', function() {
    clearTimeout(debounceTimer); 
    let query = bookInput.value.trim();

    if (query.length < 3) { 
        suggestionsDropdown.style.display = 'none';
        suggestionsDropdown.innerHTML = '';
        return;
    }

    debounceTimer = setTimeout(async () => {
        try {
            const response = await fetch(`https://jsonplaceholder.typicode.com/posts?title_like=${query}`);
            const posts = await response.json();

            const top5Posts = posts.slice(0, 5);

            if (top5Posts.length > 0) {
                suggestionsDropdown.innerHTML = '';
                
                top5Posts.forEach(post => {
                    let div = document.createElement('div');
                    div.innerText = post.title; 
                    div.style.padding = '8px';
                    div.style.cursor = 'pointer';
                    div.style.borderBottom = '1px solid #ddd';
                    
                    div.addEventListener('click', () => {
                        bookInput.value = post.title; 
                        suggestionsDropdown.style.display = 'none';
                    });
                    
                    suggestionsDropdown.appendChild(div);
                });
                
                suggestionsDropdown.style.display = 'block';
                suggestionsDropdown.style.border = '1px solid #ccc';
                suggestionsDropdown.style.backgroundColor = 'white';
                suggestionsDropdown.style.position = 'absolute'; 
                suggestionsDropdown.style.zIndex = '1000';
                suggestionsDropdown.style.width = bookInput.offsetWidth + 'px'; 
                suggestionsDropdown.style.boxShadow = '0px 4px 6px rgba(0,0,0,0.1)';
            } else {
                suggestionsDropdown.style.display = 'none';
            }
        } catch (err) {
            console.error("Suggestions error", err);
        }
    }, 300);
});