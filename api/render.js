import puppeteer from "puppeteer";
import MarkdownIt from "markdown-it";
import sanitizeHtml from "sanitize-html";

const md = new MarkdownIt({ html: false, breaks: true, typographer: true });

function toHtml(title, body, handle, pageNo, width, height) {
  const mdBody = md.render(body || "");
  const safeBody = sanitizeHtml(mdBody);
  const safeTitle = sanitizeHtml(title);

  return `
  <!doctype html>
  <html>
  <head>
    <meta charset="utf-8"/>
    <style>
      body {
        margin:0;
        width:${width}px;
        height:${height}px;
        background:#fbf7ea;
        font-family: -apple-system, Inter, sans-serif;
        display:flex;
      }
      .canvas {
        padding:64px;
        width:100%;
        display:flex;
        flex-direction:column;
        justify-content:space-between;
      }
      .header { font-size:24px; color:#666; }
      .title { font-size:64px; font-weight:700; margin:20px 0; }
      .content { font-size:36px; line-height:1.3; }
      .content blockquote {
        border-left:4px solid #000;
        padding-left:20px;
        color:#333;
      }
      .footer {
        border-top:2px solid #ccc;
        padding-top:16px;
        font-size:24px;
        color:#666;
        display:flex;
        justify-content:space-between;
      }
    </style>
  </head>
  <body>
    <div class="canvas">
      <div>
        <div class="header">${handle} ${pageNo ? `• ${pageNo}` : ""}</div>
        <div class="title">${safeTitle}</div>
        <div class="content">${safeBody}</div>
      </div>
      <div class="footer"><div>сохранить</div><div>поделиться</div></div>
    </div>
  </body>
  </html>`;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { title, body, handle="@dobfox", pageNo="1/1", width=1080, height=1350 } = req.body;
    const html = toHtml(title, body, handle, pageNo, width, height);

    const browser = await puppeteer.launch({
      headless: "new",
      args: ["--no-sandbox", "--disable-setuid-sandbox"]
    });
    const page = await browser.newPage();
    await page.setViewport({ width, height, deviceScaleFactor: 2 });
    await page.setContent(html, { waitUntil: "networkidle0" });

    const buffer = await page.screenshot({ type: "png" });
    await browser.close();

    res.setHeader("Content-Type", "image/png");
    res.send(buffer);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
}
