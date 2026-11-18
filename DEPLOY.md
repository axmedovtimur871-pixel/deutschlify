# Deploy to Firebase Hosting

The site is the single page in `public/`. Keep it in sync with the root `index.html` before each deploy:

```bash
cp index.html hero.jpg "logo (1).png" public/
```

First time only (Google login and project are yours):

```bash
npm install -g firebase-tools
firebase login
firebase use --add      # choose or create your Firebase project
```

Each deploy:

```bash
firebase deploy --only hosting
```
