import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";
import MarkdownIt from "markdown-it";
import sanitizeHtml from "sanitize-html";
import { put } from "@vercel/blob";

const md = new MarkdownIt({ html: false, breaks: true, typographer: true });

export default async function handler(req, res) {
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });

  const {
    title = "Без названия",
    body = "",
    handle = "@anon",
    pageNo = "1/1",
    width = 1080,
    height = 1350,
    filename
  } = req.body || {};

  try {
    const browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: { width, height, deviceScaleFactor: 2 },
      executablePath: await chromium.executablePath(),
      headless: chromium.headless
    });

    const page = await browser.newPage();

    const safeHtml = sanitizeHtml(md.render(body));
    const safeTitle = sanitizeHtml(title);

    const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"/>
      <style>
        body { margin:0; width:${width}px; height:${height}px; background:#fbf7ea;
               font-family:-apple-system, Inter, system-ui, Segoe UI, Roboto, sans-serif; display:flex; }
        .canvas { padding:64px; width:100%; display:flex; flex-direction:column; justify-content:space-between; }
        .header { font-size:24px; color:#666; }
        .title { font-size:64px; font-weight:800; margin:20px 0 16px; line-height:1.08; letter-spacing:-.5px; }
        .content { font-size:36px; line-height:1.28; }
        .content blockquote { border-left:5px solid #111; padding-left:20px; color:#2b2b2b; margin:18px 0; font-style:italic; }
        .footer { border-top:2px solid rgba(0,0,0,.12); padding-top:16px; font-size:24px; color:#666; display:flex; justify-content:space-between; }
      </style></head>
      <body><div class="canvas">
        <div>
          <div class="header">${handle} • ${pageNo}</div>
          ${safeTitle ? `<div class="title">${safeTitle}</div>` : ""}
          <div class="content">${safeHtml}</div>
        </div>
        <div class="footer"><div>сохранить</div><div>поделиться</div></div>
      </div></body></html>`;

    await page.setContent(html, { waitUntil: "networkidle0" });
    const buffer = await page.screenshot({ type: "png" });
    await browser.close();

    // Пытаемся сохранить в Vercel Blob
    const baseName =
      (filename && String(filename).replace(/[^\w.-]/g, "_")) ||
      `note_${Date.now()}.png`;

    try {
      const blob = await put(baseName, buffer, {
        access: "public",
        contentType: "image/png",
        addRandomSuffix: true
      });

      return res.status(200).json({
        ok: true,
        mode: "blob",
        url: blob.url,          // ← публичная ссылка
        filename: baseName
      });
    } catch (blobErr) {
      // Фолбэк: data URL (всегда работает)
      const dataUrl = `data:image/png;base64,${buffer.toString("base64")}`;
      return res.status(200).json({
        ok: true,
        mode: "data-url",
        url: dataUrl,           // ← кликабельная data-ссылка
        filename: baseName,
        note: "Blob недоступен, вернули data URL"
      });
    }

  } catch (err) {
    console.error("Renderer error:", err);
    return res.status(500).json({ error: "Failed to render image", detail: String(err) });
  }
}
