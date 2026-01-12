# OmniSwap SDK Website

This directory contains the static website for the OmniSwap SDK documentation.

## Structure

```
website/
├── index.html      # Main landing page
├── styles.css      # Website styles
└── README.md       # This file
```

## Running Locally

### Option 1: Simple HTTP Server

Using Python:
```bash
cd website
python -m http.server 8000
```

Using Node.js (http-server):
```bash
npm install -g http-server
cd website
http-server
```

Then open http://localhost:8000 in your browser.

### Option 2: VS Code Live Server

1. Install "Live Server" extension in VS Code
2. Right-click on `index.html`
3. Select "Open with Live Server"

## Features

The website includes:

- **Hero Section**: Introduction and quick start
- **Features Overview**: Key SDK capabilities
- **Supported Chains**: All 6 supported blockchains
- **Quick Start Code**: Interactive code example
- **Privacy Hub**: Architecture explanation
- **Documentation Links**: Links to all docs
- **Examples**: Code example showcases
- **Responsive Design**: Mobile-friendly layout

## Customization

### Colors

Edit CSS variables in `styles.css`:

```css
:root {
  --primary-color: #6366f1;
  --secondary-color: #8b5cf6;
  --dark-bg: #0f172a;
  --card-bg: #1e293b;
  /* ... */
}
```

### Content

Edit sections in `index.html` to update content.

## Deployment

### GitHub Pages

1. Push to GitHub repository
2. Go to Settings > Pages
3. Select source branch (main)
4. Set folder to `/website`
5. Save

Your site will be live at `https://username.github.io/repo-name/`

### Netlify

1. Connect GitHub repository
2. Set build command: (none for static site)
3. Set publish directory: `website`
4. Deploy

### Vercel

1. Import GitHub repository
2. Set root directory: `website`
3. Deploy

## License

MIT License - see [LICENSE](../LICENSE) file for details.
