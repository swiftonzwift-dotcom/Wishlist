# 🎁 Family Wish Lists

A simple, phone-friendly wish list site for the family. There are no accounts or passwords: everyone taps their name and starts.

## What it does

**Two families, one site**
- There's a **Smith** list and a **Mitchell** list. A switch at the top (**Smiths · Mitchells · Both**) picks which family you're looking at. Each phone remembers its choice, and it starts on your own family.
- Someone can be in both families (Tim and Ellen are). They have **one** wish list that both families see, so purchases are never doubled up across families.
- In-laws are on the right list even with a different last name: each person is ticked into their family, rather than matched by surname.

**For everyone**
- **Tap your name** the first time. The phone remembers you, and you can switch any time from the top corner.
- **Add, rename or remove names.** Anyone can add a name, fix a spelling, or change which family someone is in. To remove a name, you have to type **APPROVE** in capital letters, so nobody does it by accident. Removed names can be brought back.

**My wish list (your own list)**
- **＋ Add a wish:** paste a link from any store and the site tries to fetch the item's picture and name automatically. If a store blocks that, you just type the name. You can also add a wish with no link, like "warm socks, size M".
- Add a price, details (size, color…) and how much you want it: ★ Nice to have, ★★ Really want, ★★★ Most wanted.
- Edit or delete your wishes at any time.
- **No spoilers:** you never see what has been bought for you or any secret ideas about you.

**Someone else's list**
- **✓ I bought this** marks the item with a big green **PURCHASED** banner and a ✓ badge, plus who bought it, so nobody doubles up. If two people tap at the same moment, the second person is told someone beat them to it.
- **Undo** a mistaken mark.
- **Secret gift ideas:** add an idea to someone's list. Everyone except that person can see it.
- **Gifts I'm giving:** one page listing everything you've marked as bought.

**Every new year**
- On **January 1**, the old year's lists are automatically saved under **Past years** (read-only) and everyone gets a fresh list.
- Anything you wished for last year that nobody bought can be brought back with one tap.
- If you want to start early, the Past years page has a button (it also asks for **APPROVE**).

**Also:** a "How it works" help page, a button to send the site link to family, dark mode, and you can add it to your phone's home screen like an app.

---

## Setting it up (about 20 minutes, one time)

You'll do two things: (1) make the site public with GitHub Pages, and (2) connect a free Google Firebase database so everyone shares the same lists.

> Until step 2 is done, the site runs in **demo mode**: it works, but lists are saved only on the device you're using. That's handy for trying it out.

### Step 1: Put the site online (GitHub Pages)

1. Merge this code into the repository's main branch.
2. On GitHub, open the repository, then **Settings → Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**, pick **main** and **/ (root)**, then click **Save**.
4. After a minute or two the page shows your link, something like `https://<your-username>.github.io/Wishlist/`.

> GitHub Pages on a **free** account requires the repository to be **public**. The code holds nothing private (the Firebase settings in step 2 are designed to be public). Your family's lists live in Firebase, not in the repository.

### Step 2: Connect the family database (Firebase, free)

1. Go to <https://console.firebase.google.com> and sign in with a Google account.
2. Click **Create a project**, name it (e.g. `family-wishlist`) and click through. You can turn Google Analytics off.
3. In the left menu choose **Build → Firestore Database → Create database**. Pick a location near you and choose **Start in production mode**.
4. Open the **Rules** tab, delete what's there, paste in everything from [`firestore.rules`](firestore.rules) and click **Publish**.
5. Click the ⚙️ gear (top left) → **Project settings**. Under **Your apps**, click the **`</>`** (web) button, give it a nickname and click **Register app**. (Skip "Firebase Hosting".)
6. Firebase shows a block of code with `const firebaseConfig = { apiKey: "...", ... }`. Copy those values into [`js/config.js`](js/config.js), replacing the placeholders, and save/commit the file.
7. Open your site. The blue "Demo mode" message should be gone, and the starting names appear. Send the link to the family with the **📤 Send this site to family** button.

The free Firebase plan is far more than a family needs.

### Good to know

- **Privacy:** there are no passwords, so anyone who has the link can see and edit the lists. Only share the link with family.
- **Link pictures** come from the free [microlink.io](https://microlink.io) preview service (about 50 lookups per day without an account). Some stores, sometimes Amazon, block previews; the item still saves fine with a gift-box picture.
- **Changing the starting names** only matters before the first visit. Edit `FAMILIES` in `js/config.js`. After that, manage names inside the site.

## For tinkerers

Plain HTML, CSS and JavaScript (ES modules) with no build step.

| File | What it is |
| --- | --- |
| `index.html` | Page shell |
| `css/styles.css` | All styling (mobile-first, light and dark) |
| `js/app.js` | Screens, dialogs and actions |
| `js/store.js` | Data storage: Firebase Firestore, or this-device-only demo mode |
| `js/preview.js` | Link cleanup and picture/name lookup |
| `js/config.js` | Firebase settings and starting names |
| `firestore.rules` | Database rules to paste into Firebase |

To run it locally: `python3 -m http.server` in this folder, then open <http://localhost:8000>.

Items are never moved when a year is archived. Each item stores its `year`, and the site shows the items whose year matches `meta/settings.currentYear`. That makes archiving instant and safe.
