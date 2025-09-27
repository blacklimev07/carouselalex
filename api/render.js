import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";
import MarkdownIt from "markdown-it";
import sanitizeHtml from "sanitize-html";
import { put } from "@vercel/blob";

const md = new MarkdownIt({ html: false, breaks: true, typographer: true });
const esc = (s) => sanitizeHtml(String(s || ""));
const mdSafe = (s) => sanitizeHtml(md.render(String(s || "")));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function cssBase({ width, height, fontScale = 1 }) {
  return `
    :root { --pad:64px; --radius:28px; --muted:#666; --ink:#111; --sep:rgba(0,0,0,.12); }
    *{box-sizing:border-box} html,body{margin:0;padding:0}
    body{width:${width}px;height:${height}px;background:#fbf7ea;font-family:-apple-system,Inter,system-ui,Segoe UI,Roboto,sans-serif;color:var(--ink);display:flex}
    .wrap{padding:var(--pad);width:100%;display:flex;flex-direction:column;justify-content:space-between}
    .header{font-size:${24*fontScale}px;color:var(--muted)}
    .title{font-size:${64*fontScale}px;font-weight:800;margin:20px 0 16px;line-height:1.08;letter-spacing:-.5px}
    .content{font-size:${36*fontScale}px;line-height:1.28}
    blockquote{border-left:5px solid var(--ink);padding-left:20px;color:#2b2b2b;margin:18px 0;font-style:italic}
    .footer{border-top:2px solid var(--sep);padding-top:16px;font-size:${24*fontScale}px;color:var(--muted);display:flex;justify-content:space-between}
    .btn{display:inline-block;padding:${18*fontScale}px ${26*fontScale}px;border-radius:16px;background:#111;color:#fff;font-weight:700;text-decoration:none;font-size:${28*fontScale}px}
    .card{background:#fff;border-radius:var(--radius);padding:${28*fontScale}px;box-shadow:0 8px 30px rgba(0,0,0,.06)}
    img{max-width:100%;display:block}
  `;
}

// ——— Вьюшки
const viewPhotoCaption = ({ imageUrl, captionHtml, handle, pageNo }) => ({
  width: 1080,
  height: 1080,
  html: `
  <div class="wrap" style="gap:24px">
    <div class="card" style="padding:0;overflow:hidden">
      ${
        imageUrl
          ? `<img src="${esc(imageUrl)}" alt="" style="width:100%;aspect-ratio:1/1;object-fit:cover">`
          : `<div style="width:100%;aspect-ratio:1/1;display:grid;place-items:center;color:#999">no image</div>`
      }
    </div>
    <div class="card"><div class="content">${captionHtml}</div></div>
    <div class="footer"><div>${esc(handle)}</div><div>${esc(pageNo)}</div></div>
  </div>`
});

const viewQuote = ({ titleHtml, bodyHtml, handle, pageNo }) => ({
  width: 1080,
  height: 1350,
  html: `
  <div class="wrap">
    <div>
      <div class="header">${esc(handle)} • ${esc(pageNo)}</div>
      ${titleHtml ? `<div class="title">${titleHtml}</div>` : ""}
      <div class="content">${bodyHtml}</div>
    </div>
    <div class="footer"><div>сохранить</div><div>поделиться</div></div>
  </div>`
});

const viewCTA = ({ titleHtml, bodyHtml, buttonText, buttonUrl, handle }) => ({
  width: 1080,
  height: 1350,
  html: `
  <div class="wrap" style="justify-content:center;align-items:center;text-align:center;gap:24px">
    ${titleHtml ? `<div class="title" style="margin-bottom:8px">${titleHtml}</div>` : ""}
    <div class="content" style="max-width:820px;margin:0 auto">${bodyHtml}</div>
    ${
      buttonText
        ? `<div style="margin-top:24px"><a class="btn" href="${esc(buttonUrl||'#')}" target="_blank" rel="noopener">${esc(buttonText)}</a></div>`
        : ""
    }
    <div style="margin-top:36px;color:#666">${esc(handle)}</div>
  </div>`
});

// ——— Автовыбор стиля
function pickStyle({ style, imageUrl, body, caption, ctaButtonText, ctaUrl }) {
  if (style && style !== "auto") return style;
  // эвристики:
  // 1) если есть кнопка — это CTA
  if (ctaButtonText && ctaButtonText.trim().length > 0) return "cta";
  // 2) если есть картинка — это фото+подпись
  if (imageUrl && imageUrl.trim().length > 4) return "photo_caption";
  // 3) если в тексте есть цитаты или он короткий — «quote»
  const txt = String(caption || body || "");
  if (txt.includes("> ") || txt.split(/\s+/).length < 40) return "quote";
  // 4) по умолчанию — «quote»
  return "quote";
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const {
    style = "auto",       // "auto" | "photo_caption" | "quote" | "cta"
    title = "",
    body = "",
    handle = "@anon",
    pageNo = "1/1",
    imageUrl,
    caption,
    ctaText,
    ctaButtonText,
    ctaUrl,
    width,
    height,
    fontScale = 1,
    filename
  } = req.body || {};

  try {
    const chosen = pickStyle({ style, imageUrl, body, caption, ctaButtonText, ctaUrl });

    let view;
    if (chosen === "photo_caption") {
      view = viewPhotoCaption({
        imageUrl,
        captionHtml: mdSafe(caption ?? body),
        handle, pageNo
      });
    } else if (chosen === "cta") {
      view = viewCTA({
        titleHtml: esc(title),
        bodyHtml: mdSafe(ctaText ?? body),
        buttonText: ctaButtonText,
        buttonUrl: ctaUrl,
        handle
      });
    } else {
      view = viewQuote({
        titleHtml: esc(title),
        bodyHtml: mdSafe(body),
        handle, pageNo
      });
    }

    const W = clamp(Number(width || view.width), 600, 2000);
    const H = clamp(Number(height || view.height), 600, 2000);
    const F = clamp(Number(fontScale || 1), 0.6, 1.4);

    const html = `<!doctype html><html><head><meta charset="utf-8">
      <style>${cssBase({ width: W, height: H, fontScale: F })}</style></head>
      <body>${view.html}</body></html>`;

    const browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: { width: W, height: H, deviceScaleFactor: 2 },
      executablePath: await chromium.executablePath(),
      headless: chromium.headless
    });

    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });

    const png = await page.screenshot({ type: "png" });
    await browser.close();

    // пробуем сохранить в Blob (вернём короткую ссылку), иначе — data URL
    const baseName = (filename && String(filename).replace(/[^\w.-]/g, "_")) || `slide_${Date.now()}.png`;

    try {
      const blob = await put(baseName, png, {
        access: "public",
        contentType: "image/png",
        addRandomSuffix: true
      });
      return res.status(200).json({ ok: true, style: chosen, mode: "blob", url: blob.url, filename: baseName });
    } catch {
      const dataUrl = `data:image/png;base64,${png.toString("base64")}`;
      return res.status(200).json({ ok: true, style: chosen, mode: "data-url", url: dataUrl, filename: baseName });
    }
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: "Failed to render", detail: String(err) });
  }
}
