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

// ---- Dropbox / Drive → raw ----
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

// ---- Скачиваем изображение на сервере → data: (обход CORS/hotlink) ----
async function fetchToDataUrl(url) {
  if (!url) return null;
  const norm = normalizeImageUrl(url);
  const resp = await fetch(norm, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
      Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
    },
    redirect: "follow",
    cache: "no-store",
  });
  if (!resp.ok) throw new Error(`IMG ${resp.status} ${resp.statusText}`);
  const buf = Buffer.from(await resp.arrayBuffer());
  const ct =
    resp.headers.get("content-type") ||
    (/\.(png)(\?|$)/i.test(norm)
      ? "image/png"
      : /\.(webp)(\?|$)/i.test(norm)
      ? "image/webp"
      : "image/jpeg");
  return `data:${ct};base64,${buf.toString("base64")}`;
}

// ---- Общая «рамка» страницы ----
function pageShell(inner, { width = 1080, height = 1350 } = {}) {
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"/>
  <style>
    *{box-sizing:border-box} html,body{margin:0;padding:0}
    body{
      width:${width}px;height:${height}px;background:#F7F3E8;
      font-family:-apple-system, Inter, Segoe UI, Roboto, sans-serif; color:#111; display:flex
    }
    .wrap{padding:48px;width:100%;display:flex;flex-direction:column;gap:24px}
    .card{background:#fff;border-radius:32px;box-shadow:0 16px 40px rgba(0,0,0,.06)}
    .footer{display:flex;justify-content:space-between;align-items:center;
            color:#444;font-size:28px;padding:0 6px;margin-top:auto}
  </style></head><body>${inner}</body></html>`;
}

// =====================
// 1) Фото + хук (photo_caption)
// =====================
function buildPhotoHTML({
  imgSrc,
  hook,
  handle,
  pageNo,
  fit = "cover",
  width = 1080,
  height = 1350,
}) {
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
        <div style="font-size:60px;line-height:1.16;font-weight:800;letter-spacing:-0.4px;text-align:center">
          ${safe(hook)}
        </div>
      </div>

      <div class="footer"><div>${safe(handle)}</div><div>${safe(pageNo)}</div></div>
    </div>`;
  return pageShell(inner, { width, height });
}

// =====================
// 2) Заметка с Markdown (note_markdown)
//     - поддерживает **жирный**, *курсив*, > цитаты
// =====================
function buildNoteMarkdownHTML({
  title = "",
  markdown = "",
  handle = "@do3",
  pageNo = "1/5",
  width = 1080,
  height = 1350,
}) {
  const rendered = md.render(markdown || "");
  const safeHtml = sanitizeHtml(rendered, {
    allowedTags: [
      "p","strong","em","u","s","ul","ol","li","blockquote","code","pre","br","hr",
      "h1","h2","h3","h4","h5","h6","a"
    ],
    allowedAttributes: { a: ["href","title","target","rel"] },
    allowedSchemes: ["http","https","mailto","tel"],
  });

  const esc = (s) => String(s || "").replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));

  const inner = `
    <div class="wrap" style="gap:18px">
      <div style="color:#6a6a6a;font-size:24px">${esc(handle)} • ${esc(pageNo)}</div>

      ${title ? `
        <div style="font-size:72px;line-height:1.08;font-weight:800;letter-spacing:-.6px;margin:6px 0 4px">
          ${esc(title)}
        </div>` : ""}

      <div class="card" style="padding:40px 44px">
        <div style="font-size:38px;line-height:1.34">
          <style>
            blockquote{border-left:6px solid #111;margin:18px 0;padding-left:20px;color:#2b2b2b;font-style:italic}
            ul,ol{margin:0 0 0 1.2em}
            h1,h2,h3{margin:8px 0 10px}
          </style>
          ${safeHtml}
        </div>
      </div>

      <div class="footer" style="border-top:2px solid rgba(0,0,0,.12);padding-top:16px;margin-top:8px">
        <div>сохранить</div><div>поделиться</div>
      </div>
    </div>`;
  return pageShell(inner, { width, height });
}

// =====================
// Handler
// =====================
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const {
    style = "photo_caption",  // "photo_caption" | "note_markdown"
    // photo_caption:
    imageUrl = "",
    caption = "",
    fit = "cover",
    // note_markdown:
    title = "",
    body = "",
    // common:
    handle = "@do3",
    pageNo = "1/5",
    width = 1080,
    height = 1350,
    return: retMode           // "binary" | "dataUrl"
  } = req.body || {};

  const binary = retMode === "binary" || req.query.binary === "1";

  try {
    let html;

    if (style === "note_markdown") {
      html = buildNoteMarkdownHTML({
        title: safe(title),
        markdown: safe(body),
        handle: safe(handle),
        pageNo: safe(pageNo),
        width, height,
      });
    } else {
      // photo_caption по умолчанию
      const imgData = imageUrl ? await fetchToDataUrl(imageUrl) : null;
      html = buildPhotoHTML({
        imgSrc: imgData || normalizeImageUrl(imageUrl),
        hook: safe(caption),
        handle: safe(handle),
        pageNo: safe(pageNo),
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

    // Дожидаемся загрузки изображения только для photo_caption
    if (style !== "note_markdown") {
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

    return res
      .status(200)
      .json({ ok: true, width, height, dataUrl: `data:image/png;base64,${png.toString("base64")}` });
  } catch (e) {
    console.error("render error:", e);
    return res.status(500).json({ ok: false, error: "Failed to render", detail: String(e?.message || e) });
  }
}
