// auth.js – Versione FINALE DEFINITIVA (funziona ovunque, anche in admin)

const ADMIN_EMAILS = [
    'andrea.orimoto@gmail.com',
    'akikocristina.orimoto@gmail.com'
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
    window.currentUser = { name: payload.name, email: payload.email, picture: payload.picture };
    localStorage.setItem('sgUser', JSON.stringify(window.currentUser));

    // Questo ora funziona perché hai firebase-auth-compat.js
    const credential = firebase.auth.GoogleAuthProvider.credential(response.credential);
    firebase.auth().signInWithCredential(credential)
        .then(() => console.log("Firebase Auth OK"))
        .catch(err => console.error("Firebase Auth error:", err));

    window.updateAuthUI?.();
    if (window.loadPreferiti) window.loadPreferiti();
}

window.logout = function () {
    window.currentUser = null;
    localStorage.removeItem('sgUser');
    google.accounts.id.disableAutoSelect();

    if (typeof firebase !== 'undefined' && firebase.auth) {
        firebase.auth().signOut().catch(() => { });
    }

    window.updateAuthUI?.();
    window.location.href = 'index.html';
};

window.updateAuthUI = function () {
    const hasUser = !!window.currentUser;
    const userInfo = document.getElementById('userInfo');
    const userPhoto = document.getElementById('userPhoto');
    const logoutBtn = document.getElementById('logoutBtn');
    const signInDiv = document.getElementById('googleSignInButton');
    const adminBtn = document.getElementById('adminBtn');
    const preferitiBtn = document.getElementById('preferitiToggle');

    if (preferitiBtn) {
        hasUser ? preferitiBtn.classList.remove('hidden') : preferitiBtn.classList.add('hidden');
    }

    if (hasUser) {
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

// Inizializza Google Sign-In
window.onload = function () {
    google.accounts.id.initialize({
        client_id: '1049409960184-lt0jqecoman6nmnfgc94ntss04vemur2.apps.googleusercontent.com',
        callback: handleCredentialResponse
    });

    const isAdminPage = window.location.pathname.includes('admin.html');

    // Controllo admin
    if (isAdminPage) {
        if (!window.currentUser) {
            window.location.href = 'index.html';
            return;
        }
        if (!window.isAdmin(window.currentUser)) {
            alert('Accesso negato: non sei admin');
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

    if (window.loadPreferiti && window.currentUser) {
        window.loadPreferiti();
    }

    // FORZA Firebase Auth in admin.html — aspetta che tutto sia pronto
    if (isAdminPage) {
        const checkAndForceAuth = () => {
            if (firebase?.auth && window.currentUser && !firebase.auth().currentUser) {
                console.log("Admin: forzo autenticazione Firebase...");
                google.accounts.id.prompt();
            }
        };
        // Prova subito e poi ogni 500ms per 3 secondi
        checkAndForceAuth();
        const interval = setInterval(checkAndForceAuth, 500);
        setTimeout(() => clearInterval(interval), 3000);
    }
};