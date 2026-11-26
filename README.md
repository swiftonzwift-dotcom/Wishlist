# Family Wish Lists

A simple, phone-friendly wish list site for the family. There are no accounts or passwords: everyone taps their name and starts.

## What it does

**Two families, one site**
- There's a **Smith** list and a **Mitchell** list. Everyone opens on their own family, and a dropdown at the top shows the other family, or both, for anyone shopping across both. Tim and Ellen, who are on both lists, open on the Mitchell list.
- Someone can be in both families (Tim and Ellen are). They have **one** wish list that both families see, so purchases are never doubled up across families.
- In-laws are on the right list even with a different last name: each person is ticked into their family, rather than matched by surname.

**For everyone**
- **Family password.** The first time on each phone, enter the family password, then tap your name. The phone remembers both.
- **Add, rename or remove names.** Anyone can add a name, fix a spelling, or change which family someone is in. To remove a name, you have to type **APPROVE** in capital letters, so nobody does it by accident. Removed names can be brought back.

**My wish list (your own list)**
- **Add a wish:** paste a link from any store and the site tries to fetch the item's picture and name automatically. If a store blocks that, you just type the name. You can also add a wish with no link, like "warm socks, size M".
- Add a price, details (size, color…) and how much you want it: Nice to have, Really want, or Most wanted.
- Edit or delete your wishes at any time.
- **No spoilers:** you never see what has been bought for you or any secret ideas about you.

**Someone else's list**
- **I bought this** turns the item green with a black **Purchased** label and who bought it, so nobody doubles up. If two people tap at the same moment, the second person is told someone beat them to it.
- **Undo** a mistaken mark.
- **Secret gift ideas:** add an idea to someone's list. Everyone except that person can see it.
- **Gifts I'm giving:** one page listing everything you've marked as bought.

**Backups and admin tools (Tim only)**
- The first time anyone opens the site each day, a full copy of every list is saved. Copies older than 30 days are cleared out automatically.
- Tim sees **Backups and admin tools** at the bottom of the home screen. From there he can put every list back to the start of any of the last 30 days. A copy of the lists as they are just before a restore is saved first, so a restore can be undone. Restoring asks for **APPROVE**.
- Starting next year's lists early is also only on that page.
- Who counts as the admin is set by `ADMIN_NAMES` in `js/config.js`. Like choosing your name, it's on trust: it hides the tools from everyone else but isn't a separate password.
- Backups are only made on days someone opens the site. On days nobody visits, nothing changes, so there's nothing new to save.

**Every new year**
- On **January 1**, the old year's lists are automatically saved under **Past years** (read-only) and everyone gets a fresh list.
- Anything you wished for last year that nobody bought can be brought back with one tap.
- Tim can start the new year early from the admin page (it also asks for **APPROVE**).
- The Past years tile only appears once there are past years.

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
5. Click the gear icon (top left) → **Project settings**. Under **Your apps**, click the **`</>`** (web) button, give it a nickname and click **Register app**. (Skip "Firebase Hosting".)
6. Firebase shows a block of code with `const firebaseConfig = { apiKey: "...", ... }`. Copy those values into [`js/config.js`](js/config.js), replacing the placeholders, and save/commit the file.
7. **Set the family password.** In the left menu choose **Build → Authentication → Get started**, pick **Email/Password**, switch on the first toggle (**Email/Password**) and click **Save**.
8. Open the **Users** tab → **Add user**. Email: `family@example.com`. Password: the family password (see the tips below). Click **Add user**.
9. Still in Authentication, open **Settings → User actions** and **untick "Enable create (sign-up)"**, then **Save**. This stops anyone from making their own account.
10. Open your site. It asks for the family password. Enter it, and the starting names appear. Send the link to the family with the **Send this site to family** button.

The free Firebase plan is far more than a family needs.

### The family password

- **Choose three or four ordinary words with dashes**, e.g. `maple-sleigh-pancake-otter`. It's easy to text, easy to type on a phone, and very hard to guess. Avoid names, birthdays or anything posted online.
- **Text it separately from the link**, or tell people in person.
- **It isn't anywhere in this code.** Firebase stores it (scrambled), so someone reading the GitHub repository can't find it. The repository shows only the login name `family@example.com`, which is useless without the password. Firebase also slows down anyone who keeps guessing.
- **Each phone enters it once** and stays signed in. **Sign out on this phone** (at the bottom of the home screen) is there for shared computers.
- **To change it:** Firebase → Authentication → Users → the `⋮` menu next to `family@example.com` → **Reset password**. That only sends an email, which won't arrive at this made-up address. Instead, delete the user and add it again with the new password. Everyone then enters the new password once.

### Keeping the site out of search engines

The site tells search engines not to list it (a `noindex` tag and a `robots.txt` file), and the address is only known to people you send it to. The lists themselves are protected by the password, not by the address being secret.

### Good to know

- **Link pictures** come from the free [microlink.io](https://microlink.io) preview service (about 50 lookups per day without an account). Some stores, sometimes Amazon, block previews; the item still saves fine without a picture.
- **Changing the starting names** only matters before the first visit. Edit `FAMILIES` in `js/config.js`. After that, manage names inside the site.

## For tinkerers

Plain HTML, CSS and JavaScript (ES modules) with no build step.

| File | What it is |
| --- | --- |
| `index.html` | Page shell |
| `DESIGN.md` | The design system: colours, type, components and rules |
| `css/styles.css` | All styling, built from the design system's tokens |
| `js/app.js` | Screens, dialogs and actions |
| `js/store.js` | Data storage: Firebase Firestore, or this-device-only demo mode |
| `js/preview.js` | Link cleanup and picture/name lookup |
| `js/config.js` | Firebase settings and starting names |
| `firestore.rules` | Database rules to paste into Firebase |

To run it locally: `python3 -m http.server` in this folder, then open <http://localhost:8000>.

Items are never moved when a year is archived. Each item stores its `year`, and the site shows the items whose year matches `meta/settings.currentYear`. That makes archiving instant and safe.
