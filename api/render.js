// api/render.js
import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";
import MarkdownIt from "markdown-it";
import sanitizeHtml from "sanitize-html";

const md = new MarkdownIt({
  html: false,
  breaks: true,
  linkify: false,
  typographer: true,
});

const safe = (s) => String(s ?? "");

// ============================
// Helpers
// ============================

// Dropbox/Drive → raw
function normalizeImageUrl(u = "") {
  try {
    const url = new URL(u);
    if (url.hostname.includes("dropbox.com")) {
      url.hostname = "dl.dropboxusercontent.com";
      url.searchParams.set("raw", "1");
      url.searchParams.delete("dl");
      return url.toString();
    }
    if (url.hostname.includes("drive.google.com")) {
      const m = u.match(/\/d\/([^/]+)\//);
      if (m && m[1]) return `https://drive.google.com/uc?export=download&id=${m[1]}`;
    }
    return u;
  } catch {
    return u;
  }
}

// Качаем картинку → data:
async function fetchToDataUrl(url) {
  if (!url) return null;
  const norm = normalizeImageUrl(url);
  const resp = await fetch(norm, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
    },
    redirect: "follow",
    cache: "no-store",
  });
  if (!resp.ok) throw new Error(`IMG ${resp.status} ${resp.statusText}`);
  const buf = Buffer.from(await resp.arrayBuffer());
  const ct =
    resp.headers.get("content-type") ||
    (/\.(png)(\?|$)/i.test(norm) ? "image/png"
      : /\.(webp)(\?|$)/i.test(norm) ? "image/webp"
      : "image/jpeg");
  return `data:${ct};base64,${buf.toString("base64")}`;
}

// Общая рамка
function pageShell(inner, { width = 1080, height = 1350 } = {}) {
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"/>
  <style>
    *{box-sizing:border-box} html,body{margin:0;padding:0}
    body{
      width:${width}px;height:${height}px;background:#F7F3E8;
      font-family:-apple-system, Inter, Segoe UI, Roboto, sans-serif;
      color:#111;display:flex
    }
    .wrap{padding:48px;width:100%;display:flex;flex-direction:column;gap:24px}
    .card{background:#fff;border-radius:32px;box-shadow:0 16px 40px rgba(0,0,0,.06)}
    .footer{display:flex;justify-content:space-between;align-items:center;
            color:#444;font-size:28px;padding:0 6px;margin-top:auto}
  </style></head><body>${inner}</body></html>`;
}

// ============================
// Styles
// ============================

// 1) Фото + хук
function buildPhotoHTML({ imgSrc, hook, handle, pageNo, fit = "cover", width = 1080, height = 1350 }) {
  const objectFit = fit === "contain" ? "contain" : "cover";
  const inner = `
    <div class="wrap">
      <div class="card" style="overflow:hidden">
        <div style="width:100%;aspect-ratio:1/1;border-radius:32px;overflow:hidden;background:#eee">
          <img class="photo" src="${imgSrc || ""}" alt=""
               style="width:100%;height:100%;object-fit:${objectFit};display:block"/>
        </div>
      </div>

      <div class="card" style="padding:40px">
        <div style="font-size:60px;line-height:1.16;font-weight:800;text-align:center">
          ${safe(hook)}
        </div>
      </div>

      <div class="footer"><div>${safe(handle)}</div><div>${safe(pageNo)}</div></div>
    </div>`;
  return pageShell(inner, { width, height });
}

// 2) Заметка (markdown или heading/quote/text)
function buildNoteMarkdownHTML({
  title = "",
  heading = "",
  quote = "",
  text = "",
  body = "",
  handle = "@do3",
  pageNo = "1/5",
  width = 1080,
  height = 1350,
}) {
  let content = "";

  if (body) {
    const rendered = md.render(body);
    content = sanitizeHtml(rendered, {
      allowedTags: ["p","strong","em","blockquote","ul","ol","li","br"],
    });
  } else {
    if (heading) {
      content += `<p style="font-weight:700;font-size:42px;line-height:1.3;margin:0 0 20px">${heading}</p>`;
    }
    if (quote) {
      content += `<blockquote style="border-left:6px solid #111;padding-left:20px;color:#2b2b2b;font-style:italic;margin:0 0 20px">${quote}</blockquote>`;
    }
    if (text) {
      content += `<p style="font-size:36px;line-height:1.34;margin:0">${text}</p>`;
    }
  }

  const inner = `
    <div class="wrap" style="gap:18px">
      <div style="color:#6a6a6a;font-size:24px">${handle} • ${pageNo}</div>
      ${title ? `<div style="font-size:72px;font-weight:800;margin:6px 0">${title}</div>` : ""}
      <div class="card" style="padding:40px 44px;font-size:38px;line-height:1.34">
        ${content}
      </div>
      <div class="footer" style="border-top:2px solid rgba(0,0,0,.12);padding-top:16px;margin-top:8px">
        <div>сохранить</div><div>поделиться</div>
      </div>
    </div>`;
  return pageShell(inner, { width, height });
}

// 3) Только заголовок
function buildTitleOnlyHTML({
  heading = "",
  handle = "@do3",
  pageNo = "1/5",
  width = 1080,
  height = 1350,
}) {
  const inner = `
    <div class="wrap" style="justify-content:center;align-items:center;text-align:center">
      <div style="font-size:96px;font-weight:900;line-height:1.1">${safe(heading)}</div>
      <div class="footer" style="margin-top:auto"><div>${safe(handle)}</div><div>${safe(pageNo)}</div></div>
    </div>`;
  return pageShell(inner, { width, height });
}

// ============================
// Handler
// ============================
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const {
    style = "photo_caption", // photo_caption | note_markdown | title_only
    // photo_caption
    imageUrl = "",
    caption = "",
    fit = "cover",
    // note_markdown
    title = "",
    heading = "",
    quote = "",
    text = "",
    body = "",
    // title_only
    // (берём heading)
    // common
    handle = "@do3",
    pageNo = "1/5",
    width = 1080,
    height = 1350,
    return: retMode,
  } = req.body || {};

  const binary = retMode === "binary" || req.query.binary === "1";

  try {
    let html;

    if (style === "note_markdown") {
      html = buildNoteMarkdownHTML({ title, heading, quote, text, body, handle, pageNo, width, height });
    } else if (style === "title_only") {
      html = buildTitleOnlyHTML({ heading: caption || heading, handle, pageNo, width, height });
    } else {
      const imgData = imageUrl ? await fetchToDataUrl(imageUrl) : null;
      html = buildPhotoHTML({
        imgSrc: imgData || normalizeImageUrl(imageUrl),
        hook: caption,
        handle,
        pageNo,
        fit, width, height,
      });
    }

    const browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: { width, height, deviceScaleFactor: 2 },
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });

    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });

    if (style === "photo_caption") {
      await page.waitForSelector("img.photo", { timeout: 6000 }).catch(() => {});
      await page.evaluate(() => new Promise((resolve) => {
        const img = document.querySelector("img.photo");
        if (!img) return resolve();
        const done = () => requestAnimationFrame(() => requestAnimationFrame(resolve));
        if (img.complete) return done();
        img.addEventListener("load", done, { once: true });
        img.addEventListener("error", done, { once: true });
      }));
    }

    const png = await page.screenshot({ type: "png" });
    await browser.close();

    if (binary) {
      res.setHeader("Content-Type", "image/png");
      res.setHeader("Content-Disposition", 'attachment; filename="slide.png"');
      return res.send(png);
    }

    return res.status(200).json({
      ok: true,
      width, height,
      dataUrl: `data:image/png;base64,${png.toString("base64")}`,
    });
  } catch (e) {
    console.error("render error:", e);
    return res.status(500).json({ ok: false, error: "Failed to render", detail: String(e?.message || e) });
  }
}
