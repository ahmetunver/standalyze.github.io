/* ============================================================
   Standalyze — AWS Cognito kimlik doğrulama (no-build / saf JS)
   ------------------------------------------------------------
   Gerekli: index.html ve KORUNAN her sayfada şu iki script,
   bu dosyadan ÖNCE yüklenmeli:
     <script src="https://cdn.jsdelivr.net/npm/amazon-cognito-identity-js@6.3.16/dist/amazon-cognito-identity.min.js"></script>
     <script src="auth.js"></script>

   ⚠️  Aşağıdaki iki değeri kendi Cognito User Pool bilgilerinle doldur.
       Bunlar GİZLİ DEĞİLDİR (zaten tarayıcıda görünürler) — şifre içermezler.
       Asıl güvenlik, doğrulamanın Cognito'da (sunucuda) yapılmasıdır.
   ============================================================ */
const COGNITO = {
  UserPoolId: 'eu-central-1_W0TIdAQH2',           // ← konsoldan birebir doğrula (0/O, I/l karışmasın)
  ClientId:   'uevft0cbh6kdc0ujiapffaleh',        // ← App integration > App clients > Client ID (buraya yapıştır)
};

const _pool = new AmazonCognitoIdentity.CognitoUserPool({
  UserPoolId: COGNITO.UserPoolId,
  ClientId:   COGNITO.ClientId,
});

// İlk girişte şifre değişimi bekleyen kullanıcı (geçici olarak tutulur)
let _pending = null;

const Auth = {
  /* Giriş yap.
     - Başarılı: { status:'OK', role, name }
     - İlk giriş (geçici şifre): { status:'NEW_PASSWORD' }  → setNewPassword çağrılmalı
     - Hatalı: reject(err) */
  signIn(username, password) {
    return new Promise((resolve, reject) => {
      const user = new AmazonCognitoIdentity.CognitoUser({
        Username: username.toLowerCase().trim(),
        Pool: _pool,
      });
      const details = new AmazonCognitoIdentity.AuthenticationDetails({
        Username: username.toLowerCase().trim(),
        Password: password,
      });
      _pending = null;
      user.authenticateUser(details, {
        onSuccess: (session) => resolve(Object.assign({ status: 'OK' }, Auth._apply(user, session))),
        onFailure: (err) => reject(err),
        newPasswordRequired: (userAttributes) => {
          // email gibi zorunlu attribute'ları saklıyoruz, setNewPassword'de kullanacağız
          // sub ve email_verified gönderilmemeli — Cognito hata verir
          delete userAttributes.email_verified;
          delete userAttributes.phone_number_verified;
          delete userAttributes.sub;
          _pending = user;
          _pending._requiredAttrs = userAttributes;
          resolve({ status: 'NEW_PASSWORD' });
        },
      });
    });
  },

  /* İlk girişte yeni kalıcı şifreyi belirler. signIn 'NEW_PASSWORD' döndükten sonra çağrılır.
     Başarılı: { status:'OK', role, name } */
  setNewPassword(newPassword) {
    return new Promise((resolve, reject) => {
      if (!_pending) return reject({ code: 'NoPendingUser' });
      // Cognito'nun verdiği attribute'lardan değiştirilemez olanları çıkar
      const skip = ['email', 'email_verified', 'phone_number_verified', 'sub'];
      const raw = _pending._requiredAttrs || {};
      const attrs = {};
      Object.keys(raw).forEach(k => {
        if (!skip.includes(k) && raw[k] !== '' && raw[k] != null) attrs[k] = raw[k];
      });
      _pending.completeNewPasswordChallenge(newPassword, attrs, {
        onSuccess: (session) => { const u = _pending; _pending = null; resolve(Object.assign({ status: 'OK' }, Auth._apply(u, session))); },
        onFailure: (err) => reject(err),
      });
    });
  },

  /* Token'dan rol ve isim çıkarır, eski sayfalarla uyumluluk için
     sessionStorage'ı doldurur. */
  _apply(user, session) {
    const p = session.getIdToken().decodePayload();
    const groups = p['cognito:groups'] || [];
    const role = groups.includes('admin')
      ? 'admin'
      : groups.includes('employee')
        ? 'employee'
        : null;
    const name = (p['cognito:username'] || user.getUsername() || '').toLowerCase();

    // Eski sayfalar bu değerleri okuyor — yalnızca KOLAYLIK içindir,
    // gerçek kontrol her sayfada requireAuth() ile token üzerinden yapılır.
    sessionStorage.setItem('role', role || '');
    if (role === 'employee') sessionStorage.setItem('user', name);
    else sessionStorage.removeItem('user');

    return { role, name };
  },

  /* KORUNAN sayfaların EN BAŞINDA çağrılır.
     Geçerli Cognito oturumu yoksa veya rol uymuyorsa index.html'e atar.
     requiredRole: 'admin' | 'employee' | null (sadece girişli olması yeterli) */
  requireAuth(requiredRole) {
    const user = _pool.getCurrentUser();
    if (!user) { location.replace('index.html'); return; }
    user.getSession((err, session) => {
      if (err || !session || !session.isValid()) {
        location.replace('index.html');
        return;
      }
      const info = Auth._apply(user, session);
      if (!info.role) { location.replace('index.html'); return; }
      if (requiredRole && info.role !== requiredRole) {
        location.replace('index.html');
      }
    });
  },

  /* Şu anki kullanıcının bilgisini senkron döndürür (giriş sonrası set edilmiş olur). */
  current() {
    return {
      role: sessionStorage.getItem('role') || null,
      name: sessionStorage.getItem('user') || null,
    };
  },

  /* Cognito'dan kullanıcı adını ağ çağrısı olmadan, senkron döndürür.
     (Sayfa yeni sekmede doğrudan açılsa bile çalışan adını verir.) */
  usernameSync() {
    const u = _pool.getCurrentUser();
    return u ? (u.getUsername() || '').toLowerCase() : null;
  },

  /* Giriş yapmış kullanıcının ID token'ını (JWT) döndürür.
     Korumalı API çağrılarında Authorization: Bearer <token> olarak gönderilir. */
  idToken() {
    return new Promise((resolve, reject) => {
      const u = _pool.getCurrentUser();
      if (!u) return reject(new Error('Oturum yok'));
      u.getSession((err, s) => {
        if (err || !s || !s.isValid()) return reject(err || new Error('Geçersiz oturum'));
        resolve(s.getIdToken().getJwtToken());
      });
    });
  },

  /* "Şifremi unuttum" — kullanıcının e-postasına doğrulama kodu gönderir.
     E-postanın Cognito'da DOĞRULANMIŞ (email_verified=true) olması gerekir. */
  forgotPassword(username) {
    return new Promise((resolve, reject) => {
      const user = new AmazonCognitoIdentity.CognitoUser({
        Username: username.toLowerCase().trim(),
        Pool: _pool,
      });
      user.forgotPassword({
        onSuccess: () => resolve({ status: 'DONE' }),
        inputVerificationCode: (data) => resolve({ status: 'CODE_SENT', data }),
        onFailure: (err) => reject(err),
      });
    });
  },

  /* Gelen kod + yeni şifre ile sıfırlamayı tamamlar. */
  confirmForgotPassword(username, code, newPassword) {
    return new Promise((resolve, reject) => {
      const user = new AmazonCognitoIdentity.CognitoUser({
        Username: username.toLowerCase().trim(),
        Pool: _pool,
      });
      user.confirmPassword(code, newPassword, {
        onSuccess: () => resolve({ status: 'OK' }),
        onFailure: (err) => reject(err),
      });
    });
  },

  /* Giriş yapmış kullanıcı için şifre değiştirme (settings.html'de kullan). */
  changePassword(oldPass, newPass) {
    return new Promise((resolve, reject) => {
      const user = _pool.getCurrentUser();
      if (!user) return reject({ code: 'NotAuthenticated' });
      user.getSession((err) => {
        if (err) return reject(err);
        user.changePassword(oldPass, newPass, (e, res) => e ? reject(e) : resolve(res));
      });
    });
  },

  /* Çıkış. */
  logout() {    const user = _pool.getCurrentUser();
    if (user) user.signOut();
    sessionStorage.clear();
    location.replace('index.html');
  },
};