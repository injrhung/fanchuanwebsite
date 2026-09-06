import { cp, mkdir, rm, stat, writeFile } from "node:fs/promises";

const files = [
  "index.html",
  "meeting-bento.html",
  "menu.html",
  "about.html",
  "styles.css",
  "accessibility.css",
  "pages.css",
  "nav.js",
  "favicon.svg",
  "robots.txt",
  "site.webmanifest"
];

const sitemapPages = [
  { file: "index.html", loc: "https://www.fanchuan.com.tw/", changefreq: "monthly", priority: "1.0" },
  { file: "meeting-bento.html", loc: "https://www.fanchuan.com.tw/meeting-bento.html", changefreq: "monthly", priority: "0.9" },
  { file: "menu.html", loc: "https://www.fanchuan.com.tw/menu.html", changefreq: "monthly", priority: "0.9" },
  { file: "about.html", loc: "https://www.fanchuan.com.tw/about.html", changefreq: "yearly", priority: "0.7" }
];

async function buildSitemap() {
  const entries = await Promise.all(
    sitemapPages.map(async (page) => {
      const { mtime } = await stat(page.file);
      const lastmod = mtime.toISOString().slice(0, 10);
      return `  <url>\n    <loc>${page.loc}</loc>\n    <lastmod>${lastmod}</lastmod>\n    <changefreq>${page.changefreq}</changefreq>\n    <priority>${page.priority}</priority>\n  </url>`;
    })
  );
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.join("\n")}\n</urlset>\n`;
}

await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });
await Promise.all(files.map((file) => cp(file, `dist/${file}`)));
await cp("images", "dist/images", { recursive: true });
await writeFile("dist/sitemap.xml", await buildSitemap());
