const fs = require('fs');
const path = require('path');

module.exports = async (req, res) => {
  const { slug } = req.query;
  
  const fileName = `${Array.isArray(slug) ? slug[0] : slug}.txt`;
  const filePath = path.join(process.cwd(), 'api', 'scripts', fileName);

  try {
    if (!fs.existsSync(filePath)) {
      return res.status(404).send("Script nicht gefunden, Cheffe!");
    }

    const fileContent = fs.readFileSync(filePath, 'utf8');

    res.setHeader('Content-Type', 'text/plain');
    res.status(200).send(fileContent);
  } catch (error) {
    res.status(500).send("Fehler beim Laden des Scripts.");
  }
};
