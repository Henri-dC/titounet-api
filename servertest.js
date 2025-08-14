// test-server.js
const express = require("express");

const app = express();
const PORT = 3000;

app.get("/", (req, res) => {
  res.send("Hello depuis le serveur de test !");
});

const server = app.listen(PORT, () => {
  console.log(`✅ Serveur de test démarré sur le port ${PORT}`);
});

server.on("close", () => {
  console.log("❌ Serveur de test fermé");
});

// Empêche Node de quitter si aucun autre timer
setInterval(() => {}, 1000);
