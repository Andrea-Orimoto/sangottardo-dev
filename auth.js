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
    window.currentUser = {
        name: payload.name,
        email: payload.email,
        picture: payload.picture
    };
    localStorage.setItem('sgUser', JSON.stringify(window.currentUser));

    // FORZA FIREBASE AUTH SEMPRE (anche se l'utente è già loggato)
    if (typeof firebase !== 'undefined' && firebase.auth) {
        firebase.auth().onAuthStateChanged((user) => {
            if (user) {
                console.log("Firebase Auth già attivo:", user.email);
            } else {
                console.log("Firebase Auth non attivo — forzo con token");
                const credential = firebase.auth.GoogleAuthProvider.credential(response.credential);
                firebase.auth().signInWithCredential(credential)
                    .then((userCred) => {
                        console.log("Firebase Auth SUCCESS:", userCred.user.email);
                    })
                    .catch((err) => {
                        console.error("Firebase Auth FAILED:", err.message);
                    });
            }
        });
    }

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

// FORZA FIREBASE AUTH SE L'UTENTE È LOGGATO MA FIREBASE NO
setTimeout(() => {
    if (window.currentUser && firebase?.auth && !firebase.auth().currentUser) {
        console.log("Forzo Firebase Auth...");
        google.accounts.id.prompt((notification) => {
            if (notification.isNotDisplayed()) {
                console.warn("Prompt bloccato — riprovo manualmente");
                // Fallback: usa il token dalla sessione locale
                const credential = firebase.auth.GoogleAuthProvider.credential(
                    response.credential // usa l'ultimo response
                );
                firebase.auth().signInWithCredential(credential);
            }
        });
    }
}, 2000);

// === BADGE AMBIENTE — solo su -dev ===
// Funziona su index.html, admin.html e qualsiasi altra pagina
(function () {
    const isDev = window.location.hostname === 'andrea-orimoto.github.io' &&
        window.location.pathname.includes('sangottardo-dev');

    if (!isDev) return;

    // Crea il badge solo se non esiste già
    if (document.getElementById('env-badge')) return;

    const badge = document.createElement('div');
    badge.id = 'env-badge';
    badge.textContent = 'DEV';
    badge.style.cssText = `
        position: fixed;
        top: 12px;
        right: 12px;
        background: #f59e0b;
        color: white;
        font-size: 11px;
        font-weight: 800;
        letter-spacing: 0.5px;
        padding: 4px 8px;
        border-radius: 6px;
        box-shadow: 0 2px 8px rgba(0,0,0,0.2);
        z-index: 9999;
        text-transform: uppercase;
        pointer-events: none;
        opacity: 0;
        transition: opacity 0.4s ease;
    `;

    document.body.appendChild(badge);

    // Piccola animazione di entrata
    requestAnimationFrame(() => {
        badge.style.opacity = '1';
    });
})();