// auth.js  –  shared by index.html and admin.html
const ADMIN_EMAILS = [
    'andrea.orimoto@gmail.com'
    // add more admins here in the future
];

window.isAdmin = function (user) {
    return user && ADMIN_EMAILS.includes(user.email);
};

window.currentUser = null;

// Restore saved session
const saved = localStorage.getItem('sgUser');
if (saved) window.currentUser = JSON.parse(saved);

function handleCredentialResponse(response) {
    const payload = JSON.parse(atob(response.credential.split('.')[1]));
    window.currentUser = {
        name: payload.name,
        email: payload.email,
        picture: payload.picture
    };
    localStorage.setItem('sgUser', JSON.stringify(window.currentUser));
    window.updateAuthUI?.();

    // RELOAD FAVORITES AFTER LOGIN
    if (window.loadPreferiti) {
        window.loadPreferiti();   // ← This triggers the correct hearts/count
    }
}

window.logout = function () {
    window.currentUser = null;
    localStorage.removeItem('sgUser');
    google.accounts.id.disableAutoSelect();
    window.updateAuthUI?.();

    // Redirect to home after logout — works on both pages!
    window.location.href = 'index.html';
};

// This function will be called from each page
window.updateAuthUI = function () {
    const hasUser = !!window.currentUser;
    const userInfo = document.getElementById('userInfo');
    const userPhoto = document.getElementById('userPhoto');
    const userName = document.getElementById('userName');
    const logoutBtn = document.getElementById('logoutBtn');
    const signInDiv = document.getElementById('googleSignInButton');
    const adminBtn = document.getElementById('adminBtn');
    const preferitiBtn = document.getElementById('preferitiToggle');
    if (preferitiBtn) {
        if (window.currentUser) {
            preferitiBtn.classList.remove('hidden');
        } else {
            preferitiBtn.classList.add('hidden');
        }
    }

    if (hasUser) {
        if (userName) userName.textContent = window.currentUser.name.split(' ')[0];
        if (userPhoto) userPhoto.src = window.currentUser.picture;
        userInfo?.classList.remove('hidden');
        logoutBtn?.classList.remove('hidden');
        signInDiv && (signInDiv.innerHTML = '', signInDiv.classList.add('hidden'));
        if (adminBtn && window.isAdmin(window.currentUser)) adminBtn.classList.remove('hidden');
    } else {
        userInfo?.classList.add('hidden');
        logoutBtn?.classList.add('hidden');
        if (adminBtn) adminBtn.classList.add('hidden');
        if (signInDiv) {
            signInDiv.classList.remove('hidden');
            signInDiv.innerHTML = '';
            google.accounts.id.renderButton(signInDiv, {
                theme: 'outline', size: 'large', text: 'signin_with',
                shape: 'rectangular', logo_alignment: 'left'
            });
        }
    }
};

// Initialize Google Sign-In (runs on every page)
window.onload = function () {
    google.accounts.id.initialize({
        client_id: '1049409960184-lt0jqecoman6nmnfgc94ntss04vemur2.apps.googleusercontent.com',  // ← your real ID
        callback: handleCredentialResponse
    });

    // Page-specific protection for admin.html
    if (window.location.pathname.includes('admin.html')) {
        if (!window.currentUser || !window.isAdmin(window.currentUser)) {
            //alert('Accesso negato. Solo gli amministratori possono accedere.');
            window.location.href = 'index.html';
            return;
        }
    }

    window.updateAuthUI();
    google.accounts.id.prompt();

    document.getElementById('logoutBtn')?.addEventListener('click', window.logout);
    document.getElementById('adminBtn')?.addEventListener('click', () => {
        window.location.href = 'admin.html';
    });
    // CRITICAL: Load favorites AFTER user is known — NO await, NO error
    if (window.loadPreferiti && window.currentUser) {
        window.loadPreferiti();   // ← This is now sync-safe (loadPreferiti is async but fire-and-forget)
    }
};