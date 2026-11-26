// ---------------------------------------------------------------------------
// Family database settings
// ---------------------------------------------------------------------------
// Leave this as-is to try the site in "demo mode" (everything is saved only
// on the phone or computer you're using).
//
// To share the lists with the whole family, follow "Step 2" in README.md and
// paste the settings Firebase gives you over the placeholder values below.
// ---------------------------------------------------------------------------

export const FIREBASE_CONFIG = {
  apiKey: "PASTE_API_KEY_HERE",
  authDomain: "",
  projectId: "",
  storageBucket: "",
  messagingSenderId: "",
  appId: "",
};

// The names the site starts with the very first time it's opened.
// After that, names are added, edited and removed from inside the site.
export const STARTING_NAMES = [
  "Bill", "Claire", "Greg", "Brian", "Matt", "Tim",
  "Ellen", "Emma", "Luke", "Amanda", "Thomas", "Winifred",
];
