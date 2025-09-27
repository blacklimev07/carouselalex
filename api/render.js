// render.js
import express from "express";
import bodyParser from "body-parser";
import puppeteer from "puppeteer";

const app = express();
app.use(bodyParser.json());

app.post("/render", async (req, res) => {
  const { style, imageUrl, caption, handle, pageNo } = req.body;

  try {
    const browser = await puppeteer.launch({
      headless: "new", // новая headless-мода
      args: ["--no-sandbox", "--disable-setuid-sandbox"]
    });
    const page = await browser.newPage();

    // HTML-шаблон для рендера
    const html = `
      <html>
        <head>
          <meta charset="utf-8" />
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
              background: #f9f6ef;
              margin: 0;
              padding: 20px;
              display: flex;
              flex-direction: column;
              align-items: center;
              justify-content: center;
            }
            .card {
              width: 700px;
              background: #fff;
              border-radius: 20px;
              box-shadow: 0 4px 10px rgba(0,0,0,0.1);
              overflow: hidden;
              display: flex;
              flex-direction: column;
            }
            .photo {
              width: 100%;
              height: 400px;
              background: #eee url('${imageUrl}') center/cover no-repeat;
            }
            .caption {
              padding: 20px;
              font-size: 28px;
              font-weight: bold;
              text-align: center;
              line-height: 1.4;
            }
            .footer {
              display: flex;
              justify-content: space-between;
              padding: 10px 20px;
              font-size: 16px;
              color: #555;
            }
          </style>
        </head>
        <body>
          <div class="card">
            <div class="photo"></div>
            <div class="caption">${caption}</div>
            <div class="footer">
              <span>${handle}</span>
              <span>${pageNo}</span>
            </div>
          </div>
        </body>
      </html>
    `;

    await page.setContent(html, { waitUntil: "networkidle0" });
    const buffer = await page.screenshot({ type: "png" });
    await browser.close();

    // отдаем как base64 dataURL
    const base64 = buffer.toString("base64");
    res.json({ 
      image: `data:image/png;base64,${base64}`
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(3000, () => {
  console.log("Renderer running on http://localhost:3000");
});
