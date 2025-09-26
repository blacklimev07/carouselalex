export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { title, body, handle, pageNo } = req.body;

  res.status(200).json({
    ok: true,
    title,
    body,
    handle,
    pageNo
  });
}
