import chromium from "@sparticuz/chrome-aws-lambda";
import puppeteer from "puppeteer-core";
import MarkdownIt from "markdown-it";
import sanitizeHtml from "sanitize-html";

const md = new MarkdownIt({
  html: false,
  breaks: true,
  typographer: true
});

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const {
    title = "Без названия",
    body = "",
    handle = "@anon",
    pageNo = "1/1",
    width = 1080,
    height = 1350
  } = req.body || {};

  try {
    const executablePath = await chromium.executablePath;

    const browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: { width, height, deviceScaleFactor: 2 },
      executablePath,
      headless: chromium.headless
    });

    const page = await browser.newPage();

    const safeHtml = sanitizeHtml(md.render(body));
    const safeTitle = sanitizeHtml(title);

    const html = `
      <!doctype html>
      <html lang="ru">
      <head>
        <meta charset="utf-8"/>
        <style>
          body {
            margin: 0;
            width: ${width}px;
            height: ${height}px;
            background: #fbf7ea;
            font-family: -apple-system, Inter, system-ui, Segoe UI, Roboto, sans-serif;
            display: flex;
          }
          .canvas {
            padding: 64px;
            width: 100%;
            display: flex;
            flex-direction: column;
            justify-content: space-between;
          }
          .header {
            font-size: 24px;
            color: #666;
          }
          .title {
            font-size: 64px;
            font-weight: 800;
            margin: 20px 0 16px;
            line-height: 1.08;
            letter-spacing: -0.5px;
          }
          .content {
            font-size: 36px;
            line-height: 1.28;
          }
          .content blockquote {
            border-left: 5px solid #111;
            padding-left: 20px;
            color: #2b2b2b;
            margin: 18px 0;
            font-style: italic;
          }
          .footer {
            border-top: 2px solid rgba(0,0,0,.12);
            padding-top: 16px;
            font-size: 24px;
            color: #666;
            display: flex;
            justify-content: space-between;
          }
        </style>
      </head>
      <body>
        <div class="canvas">
          <div>
            <div class="header">${handle} • ${pageNo}</div>
            ${safeTitle ? `<div class="title">${safeTitle}</div>` : ""}
            <div class="content">${safeHtml}</div>
          </div>
          <div class="footer">
            <div>сохранить</div>
            <div>поделиться</div>
          </div>
        </div>
      </body>
      </html>
    `;

    await page.setContent(html, { waitUntil: "networkidle0" });
    const buffer = await page.screenshot({ type: "png" });

    await browser.close();

    res.setHeader("Content-Type", "image/png");
    res.setHeader("Content-Disposition", 'inline; filename="note.png"');
    return res.send(buffer);
  } catch (err) {
    console.error("Renderer error:", err);
    res.status(500).json({
      error: "Failed to render image",
      detail: String(err)
    });
  }
}
