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
