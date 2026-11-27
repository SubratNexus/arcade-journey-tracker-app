/* Netlify Identity browser adapter for private, multi-device Arcade cloud sync. */
import { signup, login, logout, getUser, handleAuthCallback, onAuthChange } from "https://esm.run/@netlify/identity@2.0.1";

let ready = false;
let currentUser = null;
function announce(name, detail) {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

async function initialise() {
  try {
    await handleAuthCallback();
    currentUser = await getUser();
    ready = true;
    window.arcadeIdentity = {
      signup: (email, password) => signup(email, password, { full_name: String(email || "").split("@")[0].slice(0, 60) }),
      login,
      logout,
      getUser
    };
    announce("arcade-identity-ready", { user: currentUser, error: null });
    onAuthChange((event, user) => {
      currentUser = user || null;
      announce("arcade-identity-change", { event, user: currentUser });
    });
  } catch (error) {
    ready = true;
    currentUser = null;
    window.arcadeIdentity = null;
    announce("arcade-identity-ready", { user: null, error: String(error?.message || "Netlify Identity is not enabled on this site.").slice(0, 180) });
  }
}

initialise();
