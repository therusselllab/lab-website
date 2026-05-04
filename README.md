# Russell Lab Website

Static website for the Russell Lab at the MRC Laboratory of Medical Sciences, London.

## Structure

```
.
├── index.html          # Home
├── research.html       # Research areas
├── people.html         # Team
├── publications.html   # Live feed from Europe PMC via ORCID
├── news.html           # Lab news
├── resources.html      # Tools, datasets, protocols
├── join.html           # Open positions & fellowships
├── contact.html        # Contact form & map
├── css/style.css       # All styles
├── js/main.js          # Nav, scroll animations
├── js/publications.js  # Europe PMC API integration
└── assets/             # Images and icons
```

## Publications feed

Publications are fetched live from [Europe PMC](https://europepmc.org) using ORCID `0000-0001-5411-2807`. To update, edit `CONFIG` in `js/publications.js`.

## Contact form

The contact form uses [Formspree](https://formspree.io). Create a free account, create a form, and replace `[PLACEHOLDER: YOUR_FORMSPREE_ID]` in `contact.html` with your form ID.

## Deploying to GitHub Pages

1. Create a repo at github.com (e.g. `russelllab.github.io` or `username/lab-website`)
2. Push this directory: `git remote add origin <repo-url> && git push -u origin main`
3. In repo Settings → Pages → set Source to `main` branch, root folder
4. Site will be live at `https://username.github.io/lab-website/`

## Custom domain

1. Purchase domain (e.g. `russelllab.org`)
2. In GitHub Pages settings, add your custom domain
3. At your DNS provider, add a CNAME record pointing to `username.github.io`
