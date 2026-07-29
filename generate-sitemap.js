const fs = require('fs');
const path = require('path');

const DOMAIN = 'https://calcpaycheck.com';
const states = require('./data/states.json');

const today = new Date().toISOString().split('T')[0];

let urls = [];

urls.push({ loc: `${DOMAIN}/`, lastmod: today, changefreq: 'monthly', priority: '1.0' });
urls.push({ loc: `${DOMAIN}/about/`, lastmod: today, changefreq: 'yearly', priority: '0.3' });
urls.push({ loc: `${DOMAIN}/privacy/`, lastmod: today, changefreq: 'yearly', priority: '0.3' });
urls.push({ loc: `${DOMAIN}/changelog/`, lastmod: today, changefreq: 'weekly', priority: '0.4' });
urls.push({ loc: `${DOMAIN}/compare/`, lastmod: today, changefreq: 'monthly', priority: '0.7' });

Object.values(states).forEach(state => {
  if (!fs.existsSync(path.join(__dirname, state.slug, 'index.html'))) return;
  urls.push({
    loc: `${DOMAIN}/${state.slug}/`,
    lastmod: state.last_verified,
    changefreq: 'monthly',
    priority: '0.9'
  });

  if (fs.existsSync(path.join(__dirname, state.slug, 'hourly', 'index.html'))) {
    urls.push({
      loc: `${DOMAIN}/${state.slug}/hourly/`,
      lastmod: state.last_verified,
      changefreq: 'monthly',
      priority: '0.8'
    });
  }

  if (fs.existsSync(path.join(__dirname, state.slug, 'bonus', 'index.html'))) {
    urls.push({
      loc: `${DOMAIN}/${state.slug}/bonus/`,
      lastmod: state.last_verified,
      changefreq: 'monthly',
      priority: '0.7'
    });
  }
});

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url><loc>${u.loc}</loc><lastmod>${u.lastmod}</lastmod><changefreq>${u.changefreq}</changefreq><priority>${u.priority}</priority></url>`).join('\n')}
</urlset>
`;

fs.writeFileSync(path.join(__dirname, 'sitemap.xml'), xml, 'utf8');
console.log(`sitemap.xml written: ${urls.length} URLs (only states actually present in data/)`);
