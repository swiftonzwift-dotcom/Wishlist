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

// The login name for the shared family password (README, Step 2). This is
// only a label, not a real inbox, and it's fine for it to be public: the
// password itself lives only in Firebase, never in this code.
export const FAMILY_ACCOUNT_EMAIL = "family@example.com";

// The families, and the names each one starts with the very first time the
// site is opened. Someone can belong to more than one family (they then have
// ONE wish list that both families see). After the first visit, names are
// added, edited and removed from inside the site.
export const FAMILIES = [
  {
    id: "smith",
    name: "Smith",
    members: [
      "Bill Smith", "Claire Smith", "Greg Smith", "Brian Smith", "Matt Smith", "Tim Smith",
      "Ellen Smith", "Emma Smith", "Luke Smith", "Amanda Lyons", "Thomas Lyons", "Winifred Lyons",
    ],
  },
  {
    id: "mitchell",
    name: "Mitchell",
    members: [
      "Joel Mitchell", "Peggy Mitchell", "Anna Mitchell", "Tristan Lunde",
      "Peter Mitchell", "Jess Sabota", "Ellen Smith", "Tim Smith",
    ],
  },
];

// People on more than one family list open to this family by default.
// Everyone else opens to the only family they're in.
export const HOME_FAMILY = {
  "Tim Smith": "mitchell",
  "Ellen Smith": "mitchell",
};

// Who sees the admin tools (backups and restore, starting next year early).
// Only the site looks at this: there are no separate admin passwords.
export const ADMIN_NAMES = ["Tim Smith"];
