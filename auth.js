const ADMIN_EMAILS = [
    'andrea.orimoto@gmail.com',
    'akikocristina.orimoto@gmail.com'
];

window.isAdmin = function (user) {
    return !!(user && ADMIN_EMAILS.includes(user.email));
};

window.currentUser = null;

const saved = localStorage.getItem('sgUser');
if (saved) {
    try {
        window.currentUser = JSON.parse(saved);
    } catch {
        localStorage.removeItem('sgUser');
    }
}

function firebaseUser() {
    return typeof firebase !== 'undefined' && firebase.auth ? firebase.auth().currentUser : null;
}

window.hasFirebaseAdminAuth = function () {
    const fbUser = firebaseUser();
    return !!(fbUser && window.isAdmin({ email: fbUser.email }));
};

window.waitForFirebaseAdminAuth = function (timeoutMs = 3000) {
    if (window.hasFirebaseAdminAuth()) return Promise.resolve(true);
    if (typeof firebase === 'undefined' || !firebase.auth) return Promise.resolve(false);

    return new Promise(resolve => {
        let done = false;
        const finish = value => {
            if (done) return;
            done = true;
            unsubscribe?.();
            clearTimeout(timer);
            resolve(value);
        };

        const unsubscribe = firebase.auth().onAuthStateChanged(user => {
            finish(!!(user && window.isAdmin({ email: user.email })));
        });
        const timer = setTimeout(() => finish(window.hasFirebaseAdminAuth()), timeoutMs);
    });
};

function isAdminPage() {
    return window.location.pathname.includes('admin.html');
}

function renderGoogleButton(signInDiv, text = 'signin_with') {
    if (!signInDiv || !window.google?.accounts?.id) return;
    signInDiv.innerHTML = '';
    google.accounts.id.renderButton(signInDiv, {
        theme: 'outline',
        size: 'large',
        text,
        shape: 'rectangular',
        logo_alignment: 'left'
    });
}

function closeUserMenu() {
    const userMenuDialog = document.getElementById('userMenuDialog');
    const userMenuButton = document.getElementById('userMenuButton');

    userMenuDialog?.classList.add('hidden');
    userMenuButton?.setAttribute('aria-expanded', 'false');
}

function toggleUserMenu() {
    const userMenuDialog = document.getElementById('userMenuDialog');
    const userMenuButton = document.getElementById('userMenuButton');
    if (!userMenuDialog || !userMenuButton) return;

    const isOpen = !userMenuDialog.classList.contains('hidden');
    userMenuDialog.classList.toggle('hidden', isOpen);
    userMenuButton.setAttribute('aria-expanded', String(!isOpen));
}

function handleCredentialResponse(response) {
    const payload = JSON.parse(atob(response.credential.split('.')[1]));
    window.currentUser = {
        name: payload.name,
        email: payload.email,
        picture: payload.picture
    };
    localStorage.setItem('sgUser', JSON.stringify(window.currentUser));

    if (typeof firebase !== 'undefined' && firebase.auth) {
        const credential = firebase.auth.GoogleAuthProvider.credential(response.credential);
        firebase.auth().signInWithCredential(credential)
            .then((userCred) => {
                console.log('Firebase Auth SUCCESS:', userCred.user.email);
                window.updateAuthUI?.();
                window.dispatchEvent(new CustomEvent('firebase-auth-ready'));
            })
            .catch((err) => {
                console.error('Firebase Auth FAILED:', err.message);
                window.updateAuthUI?.();
            });
    }

    window.updateAuthUI?.();
    if (window.reloadStatusForCurrentUser) {
        Promise.resolve(window.reloadStatusForCurrentUser())
            .finally(() => window.loadPreferiti?.());
    } else if (window.loadPreferiti) {
        window.loadPreferiti();
    }
}

window.logout = function () {
    window.currentUser = null;
    localStorage.removeItem('sgUser');
    window.google?.accounts?.id?.disableAutoSelect();

    if (typeof firebase !== 'undefined' && firebase.auth) {
        firebase.auth().signOut().catch(() => { });
    }

    window.updateAuthUI?.();
    window.location.href = 'index.html';
};

window.updateAuthUI = function () {
    const hasUser = !!window.currentUser;
    const fbUser = firebaseUser();
    const userInfo = document.getElementById('userInfo');
    const userPhoto = document.getElementById('userPhoto');
    const userEmail = document.getElementById('userEmail');
    const logoutBtn = document.getElementById('logoutBtn');
    const signInDiv = document.getElementById('googleSignInButton');
    const adminBtn = document.getElementById('adminBtn');
    const preferitiBtn = document.getElementById('preferitiToggle');
    const needsFirebaseReconnect = hasUser && window.isAdmin(window.currentUser) && !fbUser;

    if (preferitiBtn) {
        hasUser ? preferitiBtn.classList.remove('hidden') : preferitiBtn.classList.add('hidden');
    }

    if (hasUser) {
        if (userPhoto) userPhoto.src = window.currentUser.picture || '';
        if (userEmail) {
            userEmail.textContent = window.currentUser.email || '';
            userEmail.title = window.currentUser.email || '';
        }
        userInfo?.classList.remove('hidden');
        logoutBtn?.classList.remove('hidden');
        if (adminBtn && window.isAdmin(window.currentUser)) adminBtn.classList.remove('hidden');

        if (signInDiv) {
            if (needsFirebaseReconnect) {
                signInDiv.classList.remove('hidden');
                renderGoogleButton(signInDiv, 'continue_with');
            } else {
                signInDiv.innerHTML = '';
                signInDiv.classList.add('hidden');
            }
        }
    } else {
        userInfo?.classList.add('hidden');
        if (userEmail) {
            userEmail.textContent = '';
            userEmail.removeAttribute('title');
        }
        logoutBtn?.classList.add('hidden');
        closeUserMenu();
        if (adminBtn) adminBtn.classList.add('hidden');
        if (signInDiv) {
            signInDiv.classList.remove('hidden');
            renderGoogleButton(signInDiv);
        }
    }

    window.dispatchEvent(new CustomEvent('san-gottardo-auth-changed'));
};

window.requireFirebaseAdminAuth = function () {
    const fbUser = firebaseUser();
    if (fbUser && window.isAdmin({ email: fbUser.email })) return true;

    window.updateAuthUI?.();
    alert('Devi riconnettere Google/Firebase prima di salvare. Usa il pulsante Google in alto a destra, poi riprova.');
    return false;
};

window.onload = function () {
    google.accounts.id.initialize({
        client_id: '1049409960184-lt0jqecoman6nmnfgc94ntss04vemur2.apps.googleusercontent.com',
        callback: handleCredentialResponse
    });

    if (isAdminPage()) {
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

    if (typeof firebase !== 'undefined' && firebase.auth) {
        firebase.auth().onAuthStateChanged(() => window.updateAuthUI());
    }

    window.updateAuthUI();
    google.accounts.id.prompt();

    document.getElementById('logoutBtn')?.addEventListener('click', window.logout);
    document.getElementById('userMenuButton')?.addEventListener('click', event => {
        event.stopPropagation();
        toggleUserMenu();
    });
    document.getElementById('userMenuDialog')?.addEventListener('click', event => {
        event.stopPropagation();
    });
    document.addEventListener('click', closeUserMenu);
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape') closeUserMenu();
    });
    document.getElementById('adminBtn')?.addEventListener('click', () => {
        window.location.href = 'admin.html';
    });

    if (window.loadPreferiti && window.currentUser) {
        window.loadPreferiti();
    }
};
